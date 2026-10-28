// Open positions, read from the vault. The vault's events say which traders
// opened in which markets; the vault's storage says what is still open.
import { getAddress, type Address } from 'viem';

import { vaultAbi } from './chain.ts';
import type { Ctx } from './ctx.ts';
import { getKv } from './db.ts';
import { marketByKey, type MarketId } from './registry.ts';

export type Position = {
    trader: Address;
    market: MarketId;
    isLong: boolean;
    // USD with 6 decimals, like USDG.
    size: bigint;
    collateral: bigint;
    // USD with 8 decimals, like the oracle.
    entryPrice: bigint;
};

export { feeOf, liquidationPrice, pnlAt } from '../lib/math.ts';

export function fromBlock(ctx: Ctx): bigint {
    return BigInt(getKv(ctx.db, 'start_block') ?? '0');
}

// Every trader who has ever deposited, from MarginDeposited events.
export async function knownTraders(ctx: Ctx): Promise<Address[]> {
    const logs = await ctx.chain.client.getContractEvents({
        address: ctx.config.vault,
        abi: vaultAbi,
        eventName: 'MarginDeposited',
        fromBlock: fromBlock(ctx),
    });

    return [...new Set(logs.map((l) => getAddress(l.args.trader!)))];
}

export async function openPositions(ctx: Ctx): Promise<Position[]> {
    const client = ctx.chain.client;
    const opened = await client.getContractEvents({
        address: ctx.config.vault,
        abi: vaultAbi,
        eventName: 'PositionOpened',
        fromBlock: fromBlock(ctx),
    });
    const pairs = new Map<string, { trader: Address; key: `0x${string}` }>();

    for (const log of opened) {
        const trader = getAddress(log.args.trader!);

        pairs.set(`${trader}:${log.args.market}`, { trader, key: log.args.market! });
    }

    const positions = await Promise.all(
        [...pairs.values()].map(async ({ trader, key }) => {
            const market = marketByKey(key);
            const p = await client.readContract({
                address: ctx.config.vault,
                abi: vaultAbi,
                functionName: 'positionOf',
                args: [trader, key],
            });

            return market && p.size > 0n ? { trader, market: market.id, ...p } : null;
        }),
    );

    return positions.filter((p): p is Position => p !== null);
}
