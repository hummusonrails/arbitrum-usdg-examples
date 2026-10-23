// Everything the trader app and the operator console show, in one
// serializable object. Amounts are decimal strings in whole tokens.
import { acmePoolAbi } from '@arbitrum-usdg/spot-dex-contracts';
import { USDG, usdgRewardsAbi } from '@arbitrum-usdg/usdg';
import { formatUnits, type Address } from 'viem';

import type { Network } from './chain.ts';
import type { Ctx } from './ctx.ts';
import { getKv } from './db.ts';
import { quoteMove, readTransfers, usdgOn } from './bridge.ts';
import { reconcilePool, reconcileTransfer, type Check } from './reconcile.ts';
import { POOL_IDS, POOLS, type PoolId } from './registry.ts';
import {
    accruing,
    registrationOf,
    rewardTotals,
    type Registration,
} from './rewards.ts';
import { balanceOf, readPool, type PoolView } from './trade.ts';
import { WALLET_IDS, WALLETS, type WalletId } from './wallets.ts';

const usdg = (units: bigint) => formatUnits(units, 6);
const wei = (units: bigint) => formatUnits(units, 18);

export type CheckView = Omit<Check, 'ledger' | 'onchain' | 'surplus'> & {
    ledger: string;
    onchain: string;
    surplus?: string;
};

export type PoolSnapshot = {
    id: PoolId;
    pair: string;
    address: Address;
    baseSymbol: string;
    baseReserve: string;
    quoteReserve: string;
    price: string;
    lpSupply: string;
    registration: Registration;
    rewards: {
        accruing: string;
        claimed: string;
        routed: string;
        heldForLps: string;
        claimedByLps: string;
    };
};

export type PositionSnapshot = {
    poolId: PoolId;
    lp: string;
    share: number;
    value: string;
    pendingRewards: string;
};

export type WalletSnapshot = {
    id: WalletId;
    name: string;
    role: 'lp' | 'trader';
    address: Address;
    arbitrum: { usdg: string; eth: string; weth: string; arb: string };
    ethereum: { usdg: string; eth: string };
    positions: PositionSnapshot[];
};

export type TransferSnapshot = {
    guid: string;
    from: Network;
    to: Network;
    wallet: WalletId | null;
    amountSent: string;
    amountReceived: string | null;
    sentTx: string;
    deliveredTx: string | null;
    status: 'in flight' | 'delivered';
};

export type FeedLine = {
    at: number;
    kind: string;
    text: string;
    network: Network;
    txHash?: string;
};

export type Snapshot = {
    at: string;
    error?: string;
    // Block time on the Arbitrum fork, which runs ahead after "advance time".
    forkTime: string;
    payoutGroupId: number;
    operator: { address: Address; usdg: string; eth: string };
    pools: PoolSnapshot[];
    wallets: WalletSnapshot[];
    transfers: TransferSnapshot[];
    // The LayerZero fee and Paxos daily limit left for a send from each chain.
    lanes: Record<Network, { fee: string; canSend: string }>;
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

// The pool's reward flows as the chain records them: USDG claimed for the pool,
// USDG routed into it, and USDG its LPs claimed out.
async function rewardLogs(ctx: Ctx, pool: Address) {
    const client = ctx.chains.clients.arbitrum;
    const fromBlock = BigInt(getKv(ctx.db, 'start_block:arbitrum') ?? '0');
    const [claimed, routed, lpClaims] = await Promise.all([
        client.getContractEvents({
            address: USDG.arbitrumOne.address,
            abi: usdgRewardsAbi,
            eventName: 'RewardsClaimed',
            args: { account: pool },
            fromBlock,
        }),
        client.getContractEvents({
            address: pool,
            abi: acmePoolAbi,
            eventName: 'RewardsNotified',
            fromBlock,
        }),
        client.getContractEvents({
            address: pool,
            abi: acmePoolAbi,
            eventName: 'RewardsClaimed',
            fromBlock,
        }),
    ]);
    const total = (amounts: (bigint | undefined)[]) =>
        amounts.reduce<bigint>((sum, a) => sum + (a ?? 0n), 0n);

    return {
        claimed: total(claimed.map((l) => l.args.amount)),
        routed: total(routed.map((l) => l.args.amount)),
        lpClaimed: total(lpClaims.map((l) => l.args.amount)),
    };
}

async function poolSnapshot(ctx: Ctx, id: PoolId) {
    const pool = await readPool(ctx, id);
    const [registration, accrued, logs] = await Promise.all([
        registrationOf(ctx, id),
        accruing(ctx, id),
        rewardLogs(ctx, pool.address),
    ]);
    const recorded = rewardTotals(ctx, id);
    const checks = reconcilePool(id, {
        usdgBalance: pool.usdgBalance,
        quoteReserve: pool.quoteReserve,
        rewardsHeld: pool.rewardsHeld,
        claimedRecorded: recorded.claimed,
        claimedOnchain: logs.claimed,
        routedOnchain: logs.routed,
    });
    const snapshot: PoolSnapshot = {
        id,
        pair: pool.pair,
        address: pool.address,
        baseSymbol: pool.base.symbol,
        baseReserve: wei(pool.baseReserve),
        quoteReserve: usdg(pool.quoteReserve),
        price: usdg(pool.price),
        lpSupply: wei(pool.lpSupply),
        registration,
        rewards: {
            accruing: usdg(accrued),
            claimed: usdg(recorded.claimed),
            routed: usdg(recorded.routed),
            heldForLps: usdg(pool.rewardsHeld),
            claimedByLps: usdg(logs.lpClaimed),
        },
    };

    return { snapshot, pool, checks };
}

async function walletSnapshot(ctx: Ctx, id: WalletId, pools: PoolView[]) {
    const address = ctx.chains.address(id);
    const { arbitrum, ethereum } = ctx.chains.clients;
    const [arbUsdg, arbEth, weth, arb, ethUsdg, ethEth] = await Promise.all([
        usdgOn(ctx, 'arbitrum', address),
        arbitrum.getBalance({ address }),
        balanceOf(ctx, POOLS.weth.base.address, address),
        balanceOf(ctx, POOLS.arb.base.address, address),
        usdgOn(ctx, 'ethereum', address),
        ethereum.getBalance({ address }),
    ]);
    const positions = await Promise.all(
        pools.map(async (pool): Promise<PositionSnapshot> => {
            const [lp, pending] = await Promise.all([
                balanceOf(ctx, pool.address, address),
                arbitrum.readContract({
                    address: pool.address,
                    abi: acmePoolAbi,
                    functionName: 'pendingRewards',
                    args: [address],
                }),
            ]);
            // Both sides are worth the same at the pool price, so the position
            // is worth twice its USDG share.
            const value =
                pool.lpSupply === 0n
                    ? 0n
                    : (2n * pool.quoteReserve * lp) / pool.lpSupply;

            return {
                poolId: pool.id,
                lp: wei(lp),
                share:
                    pool.lpSupply === 0n
                        ? 0
                        : Number((lp * 1_000_000n) / pool.lpSupply) / 10_000,
                value: usdg(value),
                pendingRewards: usdg(pending),
            };
        }),
    );

    return {
        id,
        name: WALLETS[id].name,
        role: WALLETS[id].role,
        address,
        arbitrum: {
            usdg: usdg(arbUsdg),
            eth: wei(arbEth),
            weth: wei(weth),
            arb: wei(arb),
        },
        ethereum: { usdg: usdg(ethUsdg), eth: wei(ethEth) },
        positions,
    } satisfies WalletSnapshot;
}

async function lane(ctx: Ctx, from: Network) {
    const { fee, canSend } = await quoteMove(ctx, from, 1_000_000n);

    return { fee: wei(fee.nativeFee), canSend: usdg(canSend) };
}

export async function getSnapshot(ctx: Ctx): Promise<Snapshot> {
    const operator = ctx.chains.address('operator');
    const pools = await Promise.all(POOL_IDS.map((id) => poolSnapshot(ctx, id)));
    const [wallets, transfers, arbLane, ethLane, opUsdg, opEth, block] =
        await Promise.all([
            Promise.all(
                WALLET_IDS.map((id) =>
                    walletSnapshot(
                        ctx,
                        id,
                        pools.map((p) => p.pool),
                    ),
                ),
            ),
            readTransfers(ctx),
            lane(ctx, 'arbitrum'),
            lane(ctx, 'ethereum'),
            usdgOn(ctx, 'arbitrum', operator),
            ctx.chains.clients.arbitrum.getBalance({ address: operator }),
            ctx.chains.clients.arbitrum.getBlock(),
        ]);
    const activity = (
        ctx.db
            .prepare(
                'SELECT kind, summary, network, tx_hash, at FROM activity ORDER BY id DESC LIMIT 40',
            )
            .all() as {
            kind: string;
            summary: string;
            network: Network;
            tx_hash: string | null;
            at: number;
        }[]
    ).map((row) => ({
        at: row.at,
        kind: row.kind,
        text: row.summary,
        network: row.network,
        txHash: row.tx_hash ?? undefined,
    }));

    return {
        at: new Date().toISOString(),
        forkTime: new Date(Number(block.timestamp) * 1000).toISOString(),
        payoutGroupId: ctx.config.payoutGroupId,
        operator: { address: operator, usdg: usdg(opUsdg), eth: wei(opEth) },
        pools: pools.map((p) => p.snapshot),
        wallets,
        transfers: transfers.map((t) => ({
            guid: t.guid,
            from: t.from,
            to: t.to,
            wallet: t.wallet,
            amountSent: usdg(t.amountSent),
            amountReceived: t.amountReceived === null ? null : usdg(t.amountReceived),
            sentTx: t.sentTx,
            deliveredTx: t.deliveredTx,
            status: t.status,
        })),
        lanes: { arbitrum: arbLane, ethereum: ethLane },
        checks: [
            ...pools.flatMap((p) => p.checks),
            ...transfers.map(reconcileTransfer),
        ].map(view),
        activity,
    };
}
