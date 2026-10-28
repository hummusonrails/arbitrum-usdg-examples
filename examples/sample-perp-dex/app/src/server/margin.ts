// Margin in the vault: deposits by one EIP-3009 signature that the keeper
// relays, withdrawals, and USDG rewards added to margin.
import { USDG, USDG_DECIMALS } from '@arbitrum-usdg/usdg';
import { erc20Abi, formatUnits, type Address } from 'viem';

import { depositArgs, signDeposit } from './authorize.ts';
import { ActionError, submit, vaultAbi } from './chain.ts';
import type { Ctx } from './ctx.ts';
import { record } from './db.ts';
import { WALLETS, type WalletId, type Who } from './wallets.ts';

const usdg = USDG.arbitrumOne.address;

export function format(units: bigint): string {
    return `${formatUnits(units, USDG_DECIMALS)} USDG`;
}

export function checkBalance(have: bigint, need: bigint, what: string) {
    if (have < need) {
        throw new ActionError(
            `This needs ${format(need)}, and the ${what} holds ${format(have)}.`,
        );
    }
}

export async function usdgBalance(ctx: Ctx, who: Who | Address): Promise<bigint> {
    return ctx.chain.client.readContract({
        address: usdg,
        abi: erc20Abi,
        functionName: 'balanceOf',
        args: [who.startsWith('0x') ? (who as Address) : ctx.chain.address(who as Who)],
    });
}

export async function readVault<T>(
    ctx: Ctx,
    functionName: string,
    args: readonly unknown[] = [],
) {
    return ctx.chain.client.readContract({
        address: ctx.config.vault,
        abi: vaultAbi,
        functionName,
        args,
    } as never) as Promise<T>;
}

// The trader signs a ReceiveWithAuthorization for the vault on the server
// (keys never reach the browser). The keeper submits it and pays the gas.
export async function deposit(ctx: Ctx, who: WalletId, amount: bigint) {
    checkBalance(await usdgBalance(ctx, who), amount, 'wallet');

    const { timestamp } = await ctx.chain.client.getBlock();
    const signed = await signDeposit(
        ctx.chain.account(who),
        ctx.config.vault,
        amount,
        timestamp,
    );
    const receipt = await submit(ctx.chain, 'keeper', {
        address: ctx.config.vault,
        abi: vaultAbi,
        functionName: 'depositWithAuthorization',
        args: depositArgs(signed),
    });

    record(ctx.db, {
        kind: 'deposit',
        who,
        summary: `${WALLETS[who].name} signed a ${format(amount)} deposit and the keeper relayed it: vault.depositWithAuthorization calls USDG.receiveWithAuthorization`,
        txHash: receipt.transactionHash,
    });
}

export async function withdraw(ctx: Ctx, who: WalletId, amount: bigint | 'all') {
    const free = await readVault<bigint>(ctx, 'freeMargin', [ctx.chain.address(who)]);
    const units = amount === 'all' ? free : amount;

    if (units === 0n) {
        throw new ActionError('There is no free margin to withdraw.');
    }

    checkBalance(free, units, 'free margin');

    const receipt = await submit(ctx.chain, who, {
        address: ctx.config.vault,
        abi: vaultAbi,
        functionName: 'withdraw',
        args: [units, ctx.chain.address(who)],
    });

    record(ctx.db, {
        kind: 'withdraw',
        who,
        summary: `${WALLETS[who].name} withdrew ${format(units)} of free margin: vault.withdraw`,
        txHash: receipt.transactionHash,
    });
}

export async function claimRewards(ctx: Ctx, who: WalletId) {
    const pending = await readVault<bigint>(ctx, 'pendingRewards', [
        ctx.chain.address(who),
    ]);

    if (pending === 0n) {
        throw new ActionError(
            'There are no USDG rewards to add yet. They arrive when Acme Perps routes the vault’s rewards.',
        );
    }

    const receipt = await submit(ctx.chain, who, {
        address: ctx.config.vault,
        abi: vaultAbi,
        functionName: 'claimRewards',
    });

    record(ctx.db, {
        kind: 'credit',
        who,
        summary: `${WALLETS[who].name} added ${format(pending)} of rewards to margin: vault.claimRewards`,
        txHash: receipt.transactionHash,
    });
}
