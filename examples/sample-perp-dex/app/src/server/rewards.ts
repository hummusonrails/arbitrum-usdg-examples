// Registers the margin vault for USDG rewards through propose and accept, then
// claims what the vault earns and routes it back into the vault, where it is
// shared between traders and the house.
import { USDG, usdgRewardsAbi } from '@arbitrum-usdg/usdg';
import { erc20Abi, maxUint256, parseEventLogs, zeroAddress, type Address } from 'viem';

import { ActionError, submit, vaultAbi } from './chain.ts';
import type { Ctx } from './ctx.ts';
import { record } from './db.ts';
import { pushPrices } from './keeper.ts';
import { format } from './margin.ts';

const usdg = USDG.arbitrumOne.address;

export type RegistrationStatus = 'unregistered' | 'proposed' | 'registered';

export type Registration = {
    status: RegistrationStatus;
    groupId: number | null;
    proposer: Address | null;
};

// Read from the USDG contract every time, so the console always shows the
// chain's view of the registration.
export async function registration(ctx: Ctx): Promise<Registration> {
    const client = ctx.chain.client;
    const vault = ctx.config.vault;
    const [registered, [pendingGroup, proposer]] = await Promise.all([
        client.readContract({
            address: usdg,
            abi: usdgRewardsAbi,
            functionName: 'payoutGroupIdOf',
            args: [vault],
        }),
        client.readContract({
            address: usdg,
            abi: usdgRewardsAbi,
            functionName: 'getPendingRegistration',
            args: [vault],
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
        return 'The vault is already registered in a payout group.';
    }

    if (action === 'accept' && status !== 'proposed') {
        return status === 'registered'
            ? 'The vault is already registered in a payout group.'
            : 'Propose the vault first. USDG accepts a registration only after the payout group manager proposes it.';
    }

    if (action === 'cancel' && status !== 'proposed') {
        return 'There is no pending proposal to cancel.';
    }

    return null;
}

async function step(ctx: Ctx, action: 'propose' | 'accept' | 'cancel') {
    const refusal = nextStep((await registration(ctx)).status, action);

    if (refusal) {
        throw new ActionError(refusal);
    }
}

export async function propose(ctx: Ctx) {
    await step(ctx, 'propose');

    const group = ctx.config.payoutGroupId;
    const receipt = await submit(ctx.chain, 'operator', {
        address: usdg,
        abi: usdgRewardsAbi,
        functionName: 'proposeRegisterRewardAddress',
        args: [group, ctx.config.vault],
    });

    record(ctx.db, {
        kind: 'propose',
        who: 'operator',
        summary: `Proposed the margin vault for payout group ${group}: USDG.proposeRegisterRewardAddress(${group}, vault)`,
        txHash: receipt.transactionHash,
    });
}

export async function accept(ctx: Ctx) {
    await step(ctx, 'accept');

    const group = ctx.config.payoutGroupId;
    const receipt = await submit(ctx.chain, 'operator', {
        address: ctx.config.vault,
        abi: vaultAbi,
        functionName: 'acceptRewardsRegistration',
        args: [group],
    });

    record(ctx.db, {
        kind: 'accept',
        who: 'operator',
        summary: `The vault accepted payout group ${group}: vault.acceptRewardsRegistration calls USDG.acceptRegisterRewardAddress(${group})`,
        txHash: receipt.transactionHash,
    });
}

export async function cancel(ctx: Ctx) {
    await step(ctx, 'cancel');

    const receipt = await submit(ctx.chain, 'operator', {
        address: usdg,
        abi: usdgRewardsAbi,
        functionName: 'cancelRegistrationProposal',
        args: [ctx.config.vault],
    });

    record(ctx.db, {
        kind: 'cancel',
        who: 'operator',
        summary:
            'Cancelled the proposal for the margin vault: USDG.cancelRegistrationProposal(vault)',
        txHash: receipt.transactionHash,
    });
}

export function routeAmount(amount: bigint): bigint {
    if (amount === 0n) {
        throw new ActionError(
            'The vault has no USDG rewards to route yet. Rewards accrue over time once the vault is registered.',
        );
    }

    return amount;
}

export async function accruing(ctx: Ctx): Promise<bigint> {
    return ctx.chain.client.readContract({
        address: usdg,
        abi: usdgRewardsAbi,
        functionName: 'availableRewardsOf',
        args: [ctx.config.vault],
    });
}

// What has been claimed and routed, from Acme Perps' own records.
export function rewardTotals(ctx: Ctx) {
    const sum = (table: 'reward_claims' | 'reward_routes') =>
        (
            ctx.db.prepare(`SELECT amount FROM ${table}`).all() as { amount: string }[]
        ).reduce((total, row) => total + BigInt(row.amount), 0n);

    return { claimed: sum('reward_claims'), routed: sum('reward_routes') };
}

// Claims the vault's rewards to the operator, then routes them into the vault.
// Anything claimed earlier but not yet routed goes out first.
export async function claimAndRoute(ctx: Ctx) {
    const vault = ctx.config.vault;
    const group = ctx.config.payoutGroupId;
    const operator = ctx.chain.address('operator');

    if ((await accruing(ctx)) > 0n) {
        const receipt = await submit(ctx.chain, 'operator', {
            address: usdg,
            abi: usdgRewardsAbi,
            functionName: 'claimForAddresses',
            args: [group, [vault]],
        });
        // The exact amount paid to the operator, from the USDG Transfer log.
        const claimed = parseEventLogs({
            abi: erc20Abi,
            eventName: 'Transfer',
            logs: receipt.logs,
            args: { to: operator },
        }).reduce((sum, log) => sum + log.args.value, 0n);

        ctx.db
            .prepare('INSERT INTO reward_claims (tx_hash, amount, at) VALUES (?, ?, ?)')
            .run(receipt.transactionHash, String(claimed), Date.now());
        record(ctx.db, {
            kind: 'claim',
            who: 'operator',
            summary: `Claimed ${format(claimed)} earned by the margin vault: USDG.claimForAddresses(${group}, [vault])`,
            txHash: receipt.transactionHash,
        });
    }

    const { claimed, routed } = rewardTotals(ctx);
    const amount = routeAmount(claimed - routed);
    const allowance = await ctx.chain.client.readContract({
        address: usdg,
        abi: erc20Abi,
        functionName: 'allowance',
        args: [operator, vault],
    });

    if (allowance < amount) {
        await submit(ctx.chain, 'operator', {
            address: usdg,
            abi: erc20Abi,
            functionName: 'approve',
            args: [vault, maxUint256],
        });
    }

    const receipt = await submit(ctx.chain, 'operator', {
        address: vault,
        abi: vaultAbi,
        functionName: 'notifyRewards',
        args: [amount],
    });
    const [notified] = parseEventLogs({
        abi: vaultAbi,
        eventName: 'RewardsNotified',
        logs: receipt.logs,
    });
    const lastClaim = ctx.db
        .prepare('SELECT id FROM reward_claims ORDER BY id DESC LIMIT 1')
        .get() as { id: number };

    ctx.db
        .prepare(
            'INSERT INTO reward_routes (claim_id, tx_hash, amount, at) VALUES (?, ?, ?, ?)',
        )
        .run(lastClaim.id, receipt.transactionHash, String(amount), Date.now());
    record(ctx.db, {
        kind: 'route',
        who: 'operator',
        summary: `Routed ${format(amount)} into the vault: ${format(notified!.args.toTraders!)} to traders by margin, ${format(notified!.args.toLiquidity!)} to the house, vault.notifyRewards`,
        txHash: receipt.transactionHash,
    });
}

export const ADVANCE_DAYS = [1, 7, 30] as const;

// Fork only: moves the fork's clock forward so accrual shows up in a short
// demo. The USDG contract computes accrual from block time. The oracle's
// prices are then out of date, so the keeper pushes fresh ones at once.
export async function advanceTime(ctx: Ctx, days: (typeof ADVANCE_DAYS)[number]) {
    const client = ctx.chain.client;

    await client.increaseTime({ seconds: days * 86_400 });
    await client.mine({ blocks: 1 });
    await pushPrices(ctx, true);
    record(ctx.db, {
        kind: 'advance',
        who: 'operator',
        summary: `Advanced the fork clock by ${days} day${days === 1 ? '' : 's'} (local fork only)`,
    });
}
