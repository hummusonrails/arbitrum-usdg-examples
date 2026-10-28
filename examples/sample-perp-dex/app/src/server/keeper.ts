// Acme Perps' keeper: the backend job that pushes market prices to the oracle
// and liquidates positions the vault reports as liquidatable. It signs with its
// own key and also relays traders' signed deposits.
import { acmeOracleAbi } from '@arbitrum-usdg/perp-dex-contracts';
import { formatUnits } from 'viem';

import { submit, vaultAbi } from './chain.ts';
import type { Ctx } from './ctx.ts';
import { getKv, record, setKv } from './db.ts';
import { openPositions } from './positions.ts';
import { applyMove, feedPrice } from './prices.ts';
import { MARKET_IDS, MARKETS, PRICE_DECIMALS, type MarketId } from './registry.ts';
import { WALLET_IDS, WALLETS } from './wallets.ts';

// Well inside the oracle's 120 second limit, so a trade never meets a stale price.
const PUSH_EVERY_MS = 30_000;

export const MARKET_MOVES = [-1_000, -500, 0, 500, 1_000] as const;

export type MarketMove = (typeof MARKET_MOVES)[number];

// Fork only: how far the console has moved each market from its feed price.
export function marketMove(ctx: Ctx, id: MarketId): number {
    return Number(getKv(ctx.db, `move:${id}`) ?? 0);
}

export async function targetPrice(ctx: Ctx, id: MarketId): Promise<bigint> {
    return applyMove(
        await feedPrice(ctx.chain.client, MARKETS[id]),
        marketMove(ctx, id),
    );
}

export async function oraclePrice(ctx: Ctx, id: MarketId) {
    const [price, updatedAt] = await ctx.chain.client.readContract({
        address: ctx.config.oracle,
        abi: acmeOracleAbi,
        functionName: 'latest',
        args: [MARKETS[id].key],
    });

    return { price, updatedAt };
}

// Pushes every market's price when the last push is getting old or a price
// changed. `force` pushes regardless, such as after the clock moves.
export async function pushPrices(ctx: Ctx, force = false) {
    const lastPush = Number(getKv(ctx.db, 'last_push_ms') ?? 0);
    const targets = await Promise.all(MARKET_IDS.map((id) => targetPrice(ctx, id)));
    const current = await Promise.all(MARKET_IDS.map((id) => oraclePrice(ctx, id)));
    const changed = targets.some((t, i) => t !== current[i]!.price);

    if (!force && !changed && Date.now() - lastPush < PUSH_EVERY_MS) {
        return;
    }

    await submit(ctx.chain, 'keeper', {
        address: ctx.config.oracle,
        abi: acmeOracleAbi,
        functionName: 'setPrices',
        args: [MARKET_IDS.map((id) => MARKETS[id].key), targets],
    });
    setKv(ctx.db, 'last_push_ms', String(Date.now()));
}

// Fork only: moves a market's price from its feed price, so PnL and
// liquidations can be shown. The keeper pushes the new price at once.
export async function setMarketMove(ctx: Ctx, id: MarketId, bps: MarketMove) {
    setKv(ctx.db, `move:${id}`, String(bps));
    await pushPrices(ctx, true);

    const { price } = await oraclePrice(ctx, id);

    record(ctx.db, {
        kind: 'market',
        who: 'keeper',
        summary: `${MARKETS[id].name} set to ${bps === 0 ? 'its fork price' : `${bps > 0 ? '+' : ''}${bps / 100}% from its fork price`}, ${formatUnits(price, PRICE_DECIMALS)} (local fork only)`,
    });
}

function traderName(ctx: Ctx, address: string): string {
    const id = WALLET_IDS.find((w) => ctx.chain.address(w) === address);

    return id ? WALLETS[id].name : address;
}

// Liquidates every position the vault reports as liquidatable.
export async function liquidateUnhealthy(ctx: Ctx) {
    for (const p of await openPositions(ctx)) {
        const key = MARKETS[p.market].key;
        const liquidatable = await ctx.chain.client.readContract({
            address: ctx.config.vault,
            abi: vaultAbi,
            functionName: 'isLiquidatable',
            args: [p.trader, key],
        });

        if (!liquidatable) {
            continue;
        }

        const receipt = await submit(ctx.chain, 'keeper', {
            address: ctx.config.vault,
            abi: vaultAbi,
            functionName: 'liquidate',
            args: [p.trader, key],
        });

        record(ctx.db, {
            kind: 'liquidate',
            who: 'keeper',
            summary: `Liquidated ${traderName(ctx, p.trader)}'s ${p.isLong ? 'long' : 'short'} ${MARKETS[p.market].name}: ${formatUnits(p.collateral, 6)} USDG of collateral to the house, vault.liquidate`,
            txHash: receipt.transactionHash,
        });
    }
}

export async function keeperPass(ctx: Ctx) {
    await pushPrices(ctx);
    await liquidateUnhealthy(ctx);
}
