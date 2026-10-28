// Everything the trader app and the operator console show, in one
// serializable object. Amounts are decimal strings in whole units.
import { USDG, usdgRewardsAbi } from '@arbitrum-usdg/usdg';
import { formatUnits, getAddress, type Address } from 'viem';

import { vaultAbi } from './chain.ts';
import type { Ctx } from './ctx.ts';
import { marketMove, oraclePrice, targetPrice } from './keeper.ts';
import { readVault, usdgBalance } from './margin.ts';
import {
    fromBlock,
    knownTraders,
    liquidationPrice,
    openPositions,
    pnlAt,
    type Position,
} from './positions.ts';
import { reconcileVault, type Check } from './reconcile.ts';
import {
    MARKET_IDS,
    MARKETS,
    marketByKey,
    PRICE_DECIMALS,
    type MarketId,
} from './registry.ts';
import { accruing, registration, rewardTotals, type Registration } from './rewards.ts';
import { WALLET_IDS, WALLETS, type WalletId } from './wallets.ts';

const usdg = (units: bigint) => formatUnits(units, 6);
const wei = (units: bigint) => formatUnits(units, 18);
const usd = (price: bigint) => formatUnits(price, PRICE_DECIMALS);

export type CheckView = Omit<Check, 'ledger' | 'onchain' | 'surplus'> & {
    ledger: string;
    onchain: string;
    surplus?: string;
};

export type MarketSnapshot = {
    id: MarketId;
    name: string;
    symbol: string;
    // The oracle's price, the keeper's target (feed price with the fork only
    // move), and the move in basis points.
    price: string;
    target: string;
    move: number;
    // Seconds since the keeper last pushed, in fork block time.
    age: number;
    longOi: string;
    shortOi: string;
};

export type PositionSnapshot = {
    market: MarketId;
    side: 'long' | 'short';
    size: string;
    collateral: string;
    leverage: number;
    entryPrice: string;
    markPrice: string;
    pnl: string;
    liquidationPrice: string;
};

export type TraderSnapshot = {
    id: WalletId;
    name: string;
    address: Address;
    wallet: { usdg: string; eth: string };
    freeMargin: string;
    locked: string;
    pendingRewards: string;
    positions: PositionSnapshot[];
};

export type LiquidationLine = {
    trader: string;
    market: string;
    side: 'long' | 'short';
    price: string;
    pnl: string;
    collateral: string;
    txHash: string;
};

export type FeedLine = { at: number; kind: string; text: string; txHash?: string };

export type Snapshot = {
    at: string;
    error?: string;
    // Block time on the fork, which runs ahead after "advance time".
    forkTime: string;
    payoutGroupId: number;
    operator: { address: Address; usdg: string; eth: string };
    keeper: { address: Address; eth: string };
    vault: {
        address: Address;
        oracle: Address;
        usdgBalance: string;
        freeMargin: string;
        collateral: string;
        liquidity: string;
        reserved: string;
        rewardsHeld: string;
    };
    markets: MarketSnapshot[];
    registration: Registration;
    rewards: {
        accruing: string;
        claimed: string;
        routed: string;
        toTraders: string;
        toLiquidity: string;
        addedToMargin: string;
    };
    traders: TraderSnapshot[];
    liquidations: LiquidationLine[];
    checks: CheckView[];
    activity: FeedLine[];
};

function view(c: Check): CheckView {
    return {
        ...c,
        ledger: usdg(c.ledger),
        onchain: usdg(c.onchain),
        surplus: c.surplus === undefined ? undefined : usdg(c.surplus),
    };
}

const sum = (values: bigint[]) => values.reduce((a, b) => a + b, 0n);

// The vault's reward flows as the chain records them.
async function rewardLogs(ctx: Ctx) {
    const client = ctx.chain.client;
    const vault = ctx.config.vault;
    const from = fromBlock(ctx);
    const [claimed, notified, credited] = await Promise.all([
        client.getContractEvents({
            address: USDG.arbitrumOne.address,
            abi: usdgRewardsAbi,
            eventName: 'RewardsClaimed',
            args: { account: vault },
            fromBlock: from,
        }),
        client.getContractEvents({
            address: vault,
            abi: vaultAbi,
            eventName: 'RewardsNotified',
            fromBlock: from,
        }),
        client.getContractEvents({
            address: vault,
            abi: vaultAbi,
            eventName: 'RewardsCredited',
            fromBlock: from,
        }),
    ]);

    return {
        claimed: sum(claimed.map((l) => l.args.amount ?? 0n)),
        routed: sum(notified.map((l) => l.args.amount ?? 0n)),
        toTraders: sum(notified.map((l) => l.args.toTraders ?? 0n)),
        toLiquidity: sum(notified.map((l) => l.args.toLiquidity ?? 0n)),
        addedToMargin: sum(credited.map((l) => l.args.amount ?? 0n)),
    };
}

function nameOf(ctx: Ctx, address: Address): string {
    const id = WALLET_IDS.find((w) => ctx.chain.address(w) === getAddress(address));

    return id ? WALLETS[id].name : address;
}

function positionView(p: Position, mark: bigint): PositionSnapshot {
    return {
        market: p.market,
        side: p.isLong ? 'long' : 'short',
        size: usdg(p.size),
        collateral: usdg(p.collateral),
        leverage: Number((p.size * 10n) / p.collateral) / 10,
        entryPrice: usd(p.entryPrice),
        markPrice: usd(mark),
        pnl: usdg(pnlAt(p, mark)),
        liquidationPrice: usd(liquidationPrice(p)),
    };
}

async function liquidations(ctx: Ctx): Promise<LiquidationLine[]> {
    const logs = await ctx.chain.client.getContractEvents({
        address: ctx.config.vault,
        abi: vaultAbi,
        eventName: 'PositionLiquidated',
        fromBlock: fromBlock(ctx),
    });
    const opened = await ctx.chain.client.getContractEvents({
        address: ctx.config.vault,
        abi: vaultAbi,
        eventName: 'PositionOpened',
        fromBlock: fromBlock(ctx),
    });

    return logs
        .reverse()
        .slice(0, 10)
        .map((l) => {
            // The side of the position this liquidation closed: the trader's
            // latest open in that market before it.
            const open = opened
                .filter(
                    (o) =>
                        o.args.trader === l.args.trader &&
                        o.args.market === l.args.market &&
                        o.blockNumber <= l.blockNumber,
                )
                .at(-1);

            return {
                trader: nameOf(ctx, l.args.trader!),
                market: marketByKey(l.args.market!)?.name ?? l.args.market!,
                side: open?.args.isLong ? 'long' : 'short',
                price: usd(l.args.price!),
                pnl: usdg(l.args.pnl!),
                collateral: usdg(l.args.collateral!),
                txHash: l.transactionHash,
            };
        });
}

export async function getSnapshot(ctx: Ctx): Promise<Snapshot> {
    const client = ctx.chain.client;
    const vault = ctx.config.vault;
    const operator = ctx.chain.address('operator');
    const keeper = ctx.chain.address('keeper');
    const block = await client.getBlock();
    const [
        balance,
        totalFreeMargin,
        totalCollateral,
        liquidity,
        reservedLiquidity,
        rewardsHeld,
        positions,
        traders,
        reg,
        accrued,
        logs,
        liquidated,
        opUsdg,
        opEth,
        keeperEth,
    ] = await Promise.all([
        usdgBalance(ctx, vault),
        readVault<bigint>(ctx, 'totalFreeMargin'),
        readVault<bigint>(ctx, 'totalCollateral'),
        readVault<bigint>(ctx, 'liquidity'),
        readVault<bigint>(ctx, 'reservedLiquidity'),
        readVault<bigint>(ctx, 'rewardsHeld'),
        openPositions(ctx),
        knownTraders(ctx),
        registration(ctx),
        accruing(ctx),
        rewardLogs(ctx),
        liquidations(ctx),
        usdgBalance(ctx, operator),
        client.getBalance({ address: operator }),
        client.getBalance({ address: keeper }),
    ]);
    const prices = Object.fromEntries(
        await Promise.all(
            MARKET_IDS.map(async (id) => [
                id,
                { ...(await oraclePrice(ctx, id)), target: await targetPrice(ctx, id) },
            ]),
        ),
    ) as Record<MarketId, { price: bigint; updatedAt: bigint; target: bigint }>;
    const markets = MARKET_IDS.map((id): MarketSnapshot => {
        const open = positions.filter((p) => p.market === id);

        return {
            id,
            name: MARKETS[id].name,
            symbol: MARKETS[id].symbol,
            price: usd(prices[id].price),
            target: usd(prices[id].target),
            move: marketMove(ctx, id),
            age: Math.max(0, Number(block.timestamp - prices[id].updatedAt)),
            longOi: usdg(sum(open.filter((p) => p.isLong).map((p) => p.size))),
            shortOi: usdg(sum(open.filter((p) => !p.isLong).map((p) => p.size))),
        };
    });
    const traderFree = await Promise.all(
        traders.map((t) => readVault<bigint>(ctx, 'freeMargin', [t])),
    );
    const traderViews = await Promise.all(
        WALLET_IDS.map(async (id): Promise<TraderSnapshot> => {
            const address = ctx.chain.address(id);
            const [wallet, eth, free, locked, pending] = await Promise.all([
                usdgBalance(ctx, address),
                client.getBalance({ address }),
                readVault<bigint>(ctx, 'freeMargin', [address]),
                readVault<bigint>(ctx, 'lockedMargin', [address]),
                readVault<bigint>(ctx, 'pendingRewards', [address]),
            ]);

            return {
                id,
                name: WALLETS[id].name,
                address,
                wallet: { usdg: usdg(wallet), eth: wei(eth) },
                freeMargin: usdg(free),
                locked: usdg(locked),
                pendingRewards: usdg(pending),
                positions: positions
                    .filter((p) => p.trader === address)
                    .map((p) => positionView(p, prices[p.market].price)),
            };
        }),
    );
    const recorded = rewardTotals(ctx);
    const checks = reconcileVault({
        usdgBalance: balance,
        totalFreeMargin,
        totalCollateral,
        liquidity,
        reservedLiquidity,
        rewardsHeld,
        traderFreeMargin: sum(traderFree),
        positionCollateral: sum(positions.map((p) => p.collateral)),
        claimedRecorded: recorded.claimed,
        claimedOnchain: logs.claimed,
        routedOnchain: logs.routed,
    });
    const activity = (
        ctx.db
            .prepare(
                'SELECT kind, summary, tx_hash, at FROM activity ORDER BY id DESC LIMIT 40',
            )
            .all() as {
            kind: string;
            summary: string;
            tx_hash: string | null;
            at: number;
        }[]
    ).map((row) => ({
        at: row.at,
        kind: row.kind,
        text: row.summary,
        txHash: row.tx_hash ?? undefined,
    }));

    return {
        at: new Date().toISOString(),
        forkTime: new Date(Number(block.timestamp) * 1000).toISOString(),
        payoutGroupId: ctx.config.payoutGroupId,
        operator: { address: operator, usdg: usdg(opUsdg), eth: wei(opEth) },
        keeper: { address: keeper, eth: wei(keeperEth) },
        vault: {
            address: vault,
            oracle: ctx.config.oracle,
            usdgBalance: usdg(balance),
            freeMargin: usdg(totalFreeMargin),
            collateral: usdg(totalCollateral),
            liquidity: usdg(liquidity),
            reserved: usdg(reservedLiquidity),
            rewardsHeld: usdg(rewardsHeld),
        },
        markets,
        registration: reg,
        rewards: {
            accruing: usdg(accrued),
            claimed: usdg(recorded.claimed),
            routed: usdg(recorded.routed),
            toTraders: usdg(logs.toTraders),
            toLiquidity: usdg(logs.toLiquidity),
            addedToMargin: usdg(logs.addedToMargin),
        },
        traders: traderViews,
        liquidations: liquidated,
        checks: checks.map(view),
        activity,
    };
}
