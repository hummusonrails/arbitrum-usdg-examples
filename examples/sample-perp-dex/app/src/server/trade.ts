// Opening and closing positions against the vault at the oracle price.
import { formatUnits, parseEventLogs } from 'viem';

import { ActionError, submit, vaultAbi } from './chain.ts';
import type { Ctx } from './ctx.ts';
import { record } from './db.ts';
import { oraclePrice, pushPrices } from './keeper.ts';
import { checkBalance, format, readVault } from './margin.ts';
import { feeOf, liquidationPrice } from '../lib/math.ts';
import type { Position } from './positions.ts';
import { LEVERAGES, MARKETS, PRICE_DECIMALS, type MarketId } from './registry.ts';
import { WALLETS, type WalletId } from './wallets.ts';

export type Side = 'long' | 'short';
export type Leverage = (typeof LEVERAGES)[number];

// How far the price may move between the preview and the trade.
export const SLIPPAGE_BPS = 50n;

// The worst price the trader accepts: higher for a buy, lower for a sell.
export function acceptablePrice(price: bigint, buying: boolean): bigint {
    return buying
        ? (price * (10_000n + SLIPPAGE_BPS)) / 10_000n
        : (price * (10_000n - SLIPPAGE_BPS)) / 10_000n;
}

export function previewOpen(
    price: bigint,
    side: Side,
    collateral: bigint,
    leverage: Leverage,
) {
    const size = collateral * BigInt(leverage);
    const fee = feeOf(size);

    return {
        size,
        fee,
        needs: collateral + fee,
        liquidationPrice: liquidationPrice({
            isLong: side === 'long',
            size,
            collateral,
            entryPrice: price,
        }),
    };
}

function usd(price: bigint) {
    return `$${Number(formatUnits(price, PRICE_DECIMALS)).toLocaleString('en-US', { maximumFractionDigits: 2 })}`;
}

export async function open(
    ctx: Ctx,
    who: WalletId,
    id: MarketId,
    side: Side,
    collateral: bigint,
    leverage: Leverage,
) {
    const trader = ctx.chain.address(who);
    const market = MARKETS[id];
    const existing = await readVault<Position>(ctx, 'positionOf', [trader, market.key]);

    if (existing.size > 0n) {
        throw new ActionError(
            `${WALLETS[who].name} already has a position in ${market.name}. Close it before opening another.`,
        );
    }

    await pushPrices(ctx);

    const { price } = await oraclePrice(ctx, id);
    const preview = previewOpen(price, side, collateral, leverage);

    checkBalance(
        await readVault<bigint>(ctx, 'freeMargin', [trader]),
        preview.needs,
        'free margin',
    );

    const receipt = await submit(ctx.chain, who, {
        address: ctx.config.vault,
        abi: vaultAbi,
        functionName: 'openPosition',
        args: [
            market.key,
            side === 'long',
            collateral,
            preview.size,
            acceptablePrice(price, side === 'long'),
        ],
    });

    record(ctx.db, {
        kind: 'open',
        who,
        summary: `${WALLETS[who].name} opened a ${leverage}x ${side} ${market.name}, size ${format(preview.size)} at ${usd(price)}, with ${format(collateral)} of margin as collateral: vault.openPosition`,
        txHash: receipt.transactionHash,
    });
}

export async function close(ctx: Ctx, who: WalletId, id: MarketId) {
    const trader = ctx.chain.address(who);
    const market = MARKETS[id];
    const position = await readVault<Position>(ctx, 'positionOf', [trader, market.key]);

    if (position.size === 0n) {
        throw new ActionError(
            `${WALLETS[who].name} has no open position in ${market.name}.`,
        );
    }

    await pushPrices(ctx);

    const { price } = await oraclePrice(ctx, id);
    // Closing a long sells and closing a short buys.
    const receipt = await submit(ctx.chain, who, {
        address: ctx.config.vault,
        abi: vaultAbi,
        functionName: 'closePosition',
        args: [market.key, acceptablePrice(price, !position.isLong)],
    });
    const [closed] = parseEventLogs({
        abi: vaultAbi,
        eventName: 'PositionClosed',
        logs: receipt.logs,
    });
    const pnl = closed!.args.pnl!;

    record(ctx.db, {
        kind: 'close',
        who,
        summary: `${WALLETS[who].name} closed a ${position.isLong ? 'long' : 'short'} ${market.name} at ${usd(closed!.args.price!)}: PnL ${pnl < 0n ? '-' : '+'}${format(pnl < 0n ? -pnl : pnl)}, ${format(closed!.args.payout!)} back to margin, vault.closePosition`,
        txHash: receipt.transactionHash,
    });
}
