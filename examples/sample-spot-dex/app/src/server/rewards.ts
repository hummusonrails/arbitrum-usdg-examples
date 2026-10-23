// Registers each pool for USDG rewards through propose and accept, then claims
// what the pool earns and routes it to the pool's LPs.
import { acmePoolAbi } from '@arbitrum-usdg/spot-dex-contracts';
import { USDG, USDG_DECIMALS, usdgRewardsAbi } from '@arbitrum-usdg/usdg';
import { erc20Abi, parseEventLogs, zeroAddress, type Address } from 'viem';

import { ActionError, submit } from './chain.ts';
import type { Ctx } from './ctx.ts';
import { record } from './db.ts';
import { POOLS, type PoolId } from './registry.ts';
import { ensureAllowance, format } from './trade.ts';

const usdg = USDG.arbitrumOne.address;

export type RegistrationStatus = 'unregistered' | 'proposed' | 'registered';

export type Registration = {
    status: RegistrationStatus;
    groupId: number | null;
    proposer: Address | null;
};

// Read from the USDG contract every time, so the console always shows the
// chain's view of the registration.
export async function registrationOf(ctx: Ctx, id: PoolId): Promise<Registration> {
    const client = ctx.chains.clients.arbitrum;
    const pool = ctx.config.pools[id];
    const [registered, [pendingGroup, proposer]] = await Promise.all([
        client.readContract({
            address: usdg,
            abi: usdgRewardsAbi,
            functionName: 'payoutGroupIdOf',
            args: [pool],
        }),
        client.readContract({
            address: usdg,
            abi: usdgRewardsAbi,
            functionName: 'getPendingRegistration',
            args: [pool],
        }),
    ]);

    if (registered !== 0) {
        return { status: 'registered', groupId: registered, proposer: null };
    }

    if (proposer !== zeroAddress) {
        return { status: 'proposed', groupId: pendingGroup, proposer };
    }

    return { status: 'unregistered', groupId: null, proposer: null };
}

// Why a registration step cannot run now, or null when it can.
export function nextStep(
    status: RegistrationStatus,
    action: 'propose' | 'accept' | 'cancel',
): string | null {
    if (action === 'propose' && status === 'registered') {
        return 'This pool is already registered in a payout group.';
    }

    if (action === 'accept' && status !== 'proposed') {
        return status === 'registered'
            ? 'This pool is already registered in a payout group.'
            : 'Propose the pool first. USDG accepts a registration only after the payout group manager proposes it.';
    }

    if (action === 'cancel' && status !== 'proposed') {
        return 'There is no pending proposal to cancel.';
    }

    return null;
}

async function step(ctx: Ctx, id: PoolId, action: 'propose' | 'accept' | 'cancel') {
    const refusal = nextStep((await registrationOf(ctx, id)).status, action);

    if (refusal) {
        throw new ActionError(refusal);
    }
}

export async function propose(ctx: Ctx, id: PoolId) {
    await step(ctx, id, 'propose');

    const group = ctx.config.payoutGroupId;
    const receipt = await submit(ctx.chains, 'operator', 'arbitrum', {
        address: usdg,
        abi: usdgRewardsAbi,
        functionName: 'proposeRegisterRewardAddress',
        args: [group, ctx.config.pools[id]],
    });

    record(ctx.db, {
        kind: 'propose',
        who: 'operator',
        summary: `Proposed ${POOLS[id].pair} for payout group ${group}: USDG.proposeRegisterRewardAddress(${group}, pool)`,
        network: 'arbitrum',
        txHash: receipt.transactionHash,
    });
}

export async function accept(ctx: Ctx, id: PoolId) {
    await step(ctx, id, 'accept');

    const group = ctx.config.payoutGroupId;
    const receipt = await submit(ctx.chains, 'operator', 'arbitrum', {
        address: ctx.config.pools[id],
        abi: acmePoolAbi,
        functionName: 'acceptRewardsRegistration',
        args: [group],
    });

    record(ctx.db, {
        kind: 'accept',
        who: 'operator',
        summary: `${POOLS[id].pair} accepted payout group ${group}: pool.acceptRewardsRegistration calls USDG.acceptRegisterRewardAddress(${group})`,
        network: 'arbitrum',
        txHash: receipt.transactionHash,
    });
}

export async function cancel(ctx: Ctx, id: PoolId) {
    await step(ctx, id, 'cancel');

    const receipt = await submit(ctx.chains, 'operator', 'arbitrum', {
        address: usdg,
        abi: usdgRewardsAbi,
        functionName: 'cancelRegistrationProposal',
        args: [ctx.config.pools[id]],
    });

    record(ctx.db, {
        kind: 'cancel',
        who: 'operator',
        summary: `Cancelled the proposal for ${POOLS[id].pair}`,
        network: 'arbitrum',
        txHash: receipt.transactionHash,
    });
}

export function routeAmount(amount: bigint): bigint {
    if (amount === 0n) {
        throw new ActionError(
            'This pool has no USDG rewards to route yet. Rewards accrue over time once the pool is registered.',
        );
    }

    return amount;
}

export async function accruing(ctx: Ctx, id: PoolId): Promise<bigint> {
    return ctx.chains.clients.arbitrum.readContract({
        address: usdg,
        abi: usdgRewardsAbi,
        functionName: 'availableRewardsOf',
        args: [ctx.config.pools[id]],
    });
}

// What has been claimed and routed for a pool, from Acme Swap's own records.
export function rewardTotals(ctx: Ctx, id: PoolId) {
    const sum = (table: 'reward_claims' | 'reward_routes') =>
        (
            ctx.db.prepare(`SELECT amount FROM ${table} WHERE pool_id = ?`).all(id) as {
                amount: string;
            }[]
        ).reduce((total, row) => total + BigInt(row.amount), 0n);

    return { claimed: sum('reward_claims'), routed: sum('reward_routes') };
}

// Claims the pool's rewards to the operator, then routes them to the pool's
// LPs. Claiming one pool at a time makes every claimed amount attributable to
// one pool. Anything claimed earlier but not yet routed goes out first.
export async function claimAndRoute(ctx: Ctx, id: PoolId) {
    const pool = ctx.config.pools[id];
    const group = ctx.config.payoutGroupId;
    const operator = ctx.chains.address('operator');
    const available = await accruing(ctx, id);

    if (available > 0n) {
        const receipt = await submit(ctx.chains, 'operator', 'arbitrum', {
            address: usdg,
            abi: usdgRewardsAbi,
            functionName: 'claimForAddresses',
            args: [group, [pool]],
        });
        // The exact amount paid to the operator, from the USDG Transfer log.
        const claimed = parseEventLogs({
            abi: erc20Abi,
            eventName: 'Transfer',
            logs: receipt.logs,
            args: { to: operator },
        }).reduce((sum, log) => sum + log.args.value, 0n);

        ctx.db
            .prepare(
                'INSERT INTO reward_claims (pool_id, tx_hash, amount, at) VALUES (?, ?, ?, ?)',
            )
            .run(id, receipt.transactionHash, String(claimed), Date.now());
        record(ctx.db, {
            kind: 'claim',
            who: 'operator',
            summary: `Claimed ${format(claimed, USDG_DECIMALS, 'USDG')} earned by ${POOLS[id].pair}: USDG.claimForAddresses(${group}, [pool])`,
            network: 'arbitrum',
            txHash: receipt.transactionHash,
        });
    }

    const { claimed, routed } = rewardTotals(ctx, id);
    const amount = routeAmount(claimed - routed);

    await ensureAllowance(ctx, 'operator', usdg, pool, amount);

    const receipt = await submit(ctx.chains, 'operator', 'arbitrum', {
        address: pool,
        abi: acmePoolAbi,
        functionName: 'notifyRewards',
        args: [amount],
    });
    const lastClaim = ctx.db
        .prepare(
            'SELECT id FROM reward_claims WHERE pool_id = ? ORDER BY id DESC LIMIT 1',
        )
        .get(id) as { id: number };

    ctx.db
        .prepare(
            'INSERT INTO reward_routes (claim_id, pool_id, tx_hash, amount, at) VALUES (?, ?, ?, ?, ?)',
        )
        .run(lastClaim.id, id, receipt.transactionHash, String(amount), Date.now());
    record(ctx.db, {
        kind: 'route',
        who: 'operator',
        summary: `Routed ${format(amount, USDG_DECIMALS, 'USDG')} to ${POOLS[id].pair} LPs: pool.notifyRewards`,
        network: 'arbitrum',
        txHash: receipt.transactionHash,
    });
}

export const ADVANCE_DAYS = [1, 7, 30] as const;

// Fork only: moves the Arbitrum fork's clock forward so accrual shows up in a
// short demo. The USDG contract computes accrual from block time.
export async function advanceTime(ctx: Ctx, days: (typeof ADVANCE_DAYS)[number]) {
    const client = ctx.chains.clients.arbitrum;

    await client.increaseTime({ seconds: days * 86_400 });
    await client.mine({ blocks: 1 });
    record(ctx.db, {
        kind: 'advance',
        who: 'operator',
        summary: `Advanced the Arbitrum fork clock by ${days} day${days === 1 ? '' : 's'} (local fork only)`,
        network: 'arbitrum',
    });
}
