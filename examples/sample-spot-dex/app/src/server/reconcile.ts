// The rules that keep Acme Swap's books honest against the chain. Pure
// functions over plain numbers, so they are easy to test and explain.
import type { Hex } from 'viem';

import type { PoolId } from './registry.ts';

export type Check = {
    rule: 'reserves' | 'claims' | 'routing' | 'transfer';
    poolId?: PoolId;
    guid?: Hex;
    ledger: bigint;
    onchain: bigint;
    status: 'matched' | 'drift' | 'pending';
    // Reserves only: USDG in the pool beyond what it owes, such as a direct transfer.
    surplus?: bigint;
};

export type PoolBooks = {
    // The pool's USDG balance, its quote reserve, and USDG routed to LPs and not
    // yet claimed by them.
    usdgBalance: bigint;
    quoteReserve: bigint;
    rewardsHeld: bigint;
    // USDG claimed for this pool in Acme Swap's records, against the
    // RewardsClaimed events the USDG contract emitted for the pool.
    claimedRecorded: bigint;
    claimedOnchain: bigint;
    // USDG the pool received through notifyRewards (its RewardsNotified events).
    routedOnchain: bigint;
};

export function reconcilePool(poolId: PoolId, b: PoolBooks): Check[] {
    const owed = b.quoteReserve + b.rewardsHeld;

    return [
        {
            rule: 'reserves',
            poolId,
            ledger: owed,
            onchain: b.usdgBalance,
            status: b.usdgBalance >= owed ? 'matched' : 'drift',
            surplus: b.usdgBalance - owed,
        },
        {
            rule: 'claims',
            poolId,
            ledger: b.claimedRecorded,
            onchain: b.claimedOnchain,
            status: b.claimedRecorded === b.claimedOnchain ? 'matched' : 'drift',
        },
        {
            rule: 'routing',
            poolId,
            ledger: b.claimedRecorded,
            onchain: b.routedOnchain,
            status: b.claimedRecorded === b.routedOnchain ? 'matched' : 'drift',
        },
    ];
}

// USDG burned on one chain must be minted in full on the other.
export function reconcileTransfer(t: {
    guid: Hex;
    amountSent: bigint;
    amountReceived: bigint | null;
}): Check {
    return {
        rule: 'transfer',
        guid: t.guid,
        ledger: t.amountSent,
        onchain: t.amountReceived ?? 0n,
        status:
            t.amountReceived === null
                ? 'pending'
                : t.amountReceived === t.amountSent
                  ? 'matched'
                  : 'drift',
    };
}
