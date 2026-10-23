// Swaps and liquidity against the Acme pools, signed by a demo wallet.
import { acmePoolAbi } from '@arbitrum-usdg/spot-dex-contracts';
import { USDG, USDG_DECIMALS } from '@arbitrum-usdg/usdg';
import { erc20Abi, formatUnits, maxUint256, type Address } from 'viem';

import { ActionError, submit } from './chain.ts';
import type { Ctx } from './ctx.ts';
import { record } from './db.ts';
import { POOLS, type PoolId } from './registry.ts';
import { WALLETS, type WalletId, type Who } from './wallets.ts';

const usdg = USDG.arbitrumOne.address;

// Buy spends USDG for the base token; sell spends the base token for USDG.
export type Side = 'buy' | 'sell';

export const DEFAULT_SLIPPAGE_BPS = 50;

export function minOut(amountOut: bigint, slippageBps: number): bigint {
    return (amountOut * BigInt(10_000 - slippageBps)) / 10_000n;
}

export function format(units: bigint, decimals: number, symbol: string): string {
    return `${formatUnits(units, decimals)} ${symbol}`;
}

export function checkBalance(
    have: bigint,
    need: bigint,
    symbol: string,
    decimals: number,
) {
    if (have < need) {
        throw new ActionError(
            `This needs ${format(need, decimals, symbol)}, and the wallet holds ${format(have, decimals, symbol)}.`,
        );
    }
}

export type PoolView = {
    id: PoolId;
    pair: string;
    address: Address;
    base: { symbol: string; decimals: number };
    baseReserve: bigint;
    quoteReserve: bigint;
    // USDG per one whole base token, in USDG base units.
    price: bigint;
    lpSupply: bigint;
    rewardsHeld: bigint;
    usdgBalance: bigint;
};

export async function readPool(ctx: Ctx, id: PoolId): Promise<PoolView> {
    const client = ctx.chains.clients.arbitrum;
    const address = ctx.config.pools[id];
    const def = POOLS[id];
    const pool = { address, abi: acmePoolAbi } as const;
    const [[baseReserve, quoteReserve], lpSupply, rewardsHeld, usdgBalance] =
        await Promise.all([
            client.readContract({ ...pool, functionName: 'getReserves' }),
            client.readContract({ ...pool, functionName: 'totalSupply' }),
            client.readContract({ ...pool, functionName: 'rewardsHeld' }),
            client.readContract({
                address: usdg,
                abi: erc20Abi,
                functionName: 'balanceOf',
                args: [address],
            }),
        ]);

    return {
        id,
        pair: def.pair,
        address,
        base: { symbol: def.base.symbol, decimals: def.base.decimals },
        baseReserve,
        quoteReserve,
        price:
            baseReserve === 0n
                ? 0n
                : (quoteReserve * 10n ** BigInt(def.base.decimals)) / baseReserve,
        lpSupply,
        rewardsHeld,
        usdgBalance,
    };
}

function tokens(id: PoolId, side: Side) {
    const base = {
        address: POOLS[id].base.address,
        symbol: POOLS[id].base.symbol,
        decimals: POOLS[id].base.decimals,
    };
    const quote = { address: usdg, symbol: 'USDG', decimals: USDG_DECIMALS };

    return side === 'buy'
        ? { tokenIn: quote, tokenOut: base }
        : { tokenIn: base, tokenOut: quote };
}

export async function balanceOf(ctx: Ctx, token: Address, who: Who | Address) {
    return ctx.chains.clients.arbitrum.readContract({
        address: token,
        abi: erc20Abi,
        functionName: 'balanceOf',
        args: [
            who.startsWith('0x') ? (who as Address) : ctx.chains.address(who as Who),
        ],
    });
}

// Approves `spender` once, only when the current allowance is short.
export async function ensureAllowance(
    ctx: Ctx,
    who: Who,
    token: Address,
    spender: Address,
    amount: bigint,
) {
    const allowance = await ctx.chains.clients.arbitrum.readContract({
        address: token,
        abi: erc20Abi,
        functionName: 'allowance',
        args: [ctx.chains.address(who), spender],
    });

    if (allowance < amount) {
        await submit(ctx.chains, who, 'arbitrum', {
            address: token,
            abi: erc20Abi,
            functionName: 'approve',
            args: [spender, maxUint256],
        });
    }
}

export async function quoteSwap(ctx: Ctx, id: PoolId, side: Side, amountIn: bigint) {
    const { tokenIn, tokenOut } = tokens(id, side);
    const amountOut = await ctx.chains.clients.arbitrum.readContract({
        address: ctx.config.pools[id],
        abi: acmePoolAbi,
        functionName: 'getAmountOut',
        args: [tokenIn.address, amountIn],
    });

    return {
        tokenIn,
        tokenOut,
        amountIn,
        amountOut,
        minOut: minOut(amountOut, DEFAULT_SLIPPAGE_BPS),
    };
}

export async function swap(
    ctx: Ctx,
    who: WalletId,
    id: PoolId,
    side: Side,
    amountIn: bigint,
    // The minimum the trader saw with their quote. The pool reverts below it.
    minAmountOut: bigint,
) {
    const pool = ctx.config.pools[id];
    const quote = await quoteSwap(ctx, id, side, amountIn);
    const { tokenIn, tokenOut } = quote;

    checkBalance(
        await balanceOf(ctx, tokenIn.address, who),
        amountIn,
        tokenIn.symbol,
        tokenIn.decimals,
    );

    if (quote.amountOut === 0n) {
        throw new ActionError(
            'That amount is too small to buy anything from the pool.',
        );
    }

    await ensureAllowance(ctx, who, tokenIn.address, pool, amountIn);

    const receipt = await submit(ctx.chains, who, 'arbitrum', {
        address: pool,
        abi: acmePoolAbi,
        functionName: 'swapExactIn',
        args: [tokenIn.address, amountIn, minAmountOut, ctx.chains.address(who)],
    });

    record(ctx.db, {
        kind: 'swap',
        who,
        summary: `${WALLETS[who].name} swapped ${format(amountIn, tokenIn.decimals, tokenIn.symbol)} for about ${format(quote.amountOut, tokenOut.decimals, tokenOut.symbol)} in ${POOLS[id].pair}`,
        network: 'arbitrum',
        txHash: receipt.transactionHash,
    });
}

// Adds `quoteAmount` USDG and the matching base token at the current price.
export async function addLiquidity(
    ctx: Ctx,
    who: WalletId,
    id: PoolId,
    quoteAmount: bigint,
) {
    const pool = await readPool(ctx, id);
    const def = POOLS[id];
    // Rounds up so the pool takes all of the USDG; the contract trims the base side.
    const baseAmount =
        (quoteAmount * pool.baseReserve + pool.quoteReserve - 1n) / pool.quoteReserve;

    checkBalance(await balanceOf(ctx, usdg, who), quoteAmount, 'USDG', USDG_DECIMALS);
    checkBalance(
        await balanceOf(ctx, def.base.address, who),
        baseAmount,
        def.base.symbol,
        def.base.decimals,
    );
    await ensureAllowance(ctx, who, usdg, pool.address, quoteAmount);
    await ensureAllowance(ctx, who, def.base.address, pool.address, baseAmount);

    const receipt = await submit(ctx.chains, who, 'arbitrum', {
        address: pool.address,
        abi: acmePoolAbi,
        functionName: 'addLiquidity',
        args: [baseAmount, quoteAmount, 1n, ctx.chains.address(who)],
    });

    record(ctx.db, {
        kind: 'add',
        who,
        summary: `${WALLETS[who].name} added ${format(quoteAmount, USDG_DECIMALS, 'USDG')} and ${format(baseAmount, def.base.decimals, def.base.symbol)} to ${def.pair}`,
        network: 'arbitrum',
        txHash: receipt.transactionHash,
    });
}

export async function removeLiquidity(
    ctx: Ctx,
    who: WalletId,
    id: PoolId,
    lpAmount: bigint | 'all',
) {
    const pool = await readPool(ctx, id);
    const held = await balanceOf(ctx, pool.address, who);
    const liquidity = lpAmount === 'all' ? held : lpAmount;

    if (liquidity === 0n) {
        throw new ActionError('This wallet has no liquidity in that pool.');
    }

    checkBalance(held, liquidity, 'LP tokens', 18);

    const baseOut = (pool.baseReserve * liquidity) / pool.lpSupply;
    const quoteOut = (pool.quoteReserve * liquidity) / pool.lpSupply;
    const receipt = await submit(ctx.chains, who, 'arbitrum', {
        address: pool.address,
        abi: acmePoolAbi,
        functionName: 'removeLiquidity',
        args: [
            liquidity,
            minOut(baseOut, DEFAULT_SLIPPAGE_BPS),
            minOut(quoteOut, DEFAULT_SLIPPAGE_BPS),
            ctx.chains.address(who),
        ],
    });

    record(ctx.db, {
        kind: 'remove',
        who,
        summary: `${WALLETS[who].name} removed about ${format(quoteOut, USDG_DECIMALS, 'USDG')} and ${format(baseOut, pool.base.decimals, pool.base.symbol)} from ${pool.pair}`,
        network: 'arbitrum',
        txHash: receipt.transactionHash,
    });
}

export async function claimLpRewards(ctx: Ctx, who: WalletId, id: PoolId) {
    const pool = ctx.config.pools[id];
    const pending = await ctx.chains.clients.arbitrum.readContract({
        address: pool,
        abi: acmePoolAbi,
        functionName: 'pendingRewards',
        args: [ctx.chains.address(who)],
    });

    if (pending === 0n) {
        throw new ActionError('There are no USDG rewards to claim in this pool yet.');
    }

    const receipt = await submit(ctx.chains, who, 'arbitrum', {
        address: pool,
        abi: acmePoolAbi,
        functionName: 'claimRewards',
        args: [ctx.chains.address(who)],
    });

    record(ctx.db, {
        kind: 'claimLp',
        who,
        summary: `${WALLETS[who].name} claimed ${format(pending, USDG_DECIMALS, 'USDG')} of LP rewards from ${POOLS[id].pair}`,
        network: 'arbitrum',
        txHash: receipt.transactionHash,
    });
}
