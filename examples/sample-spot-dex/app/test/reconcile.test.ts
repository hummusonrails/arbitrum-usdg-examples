import assert from 'node:assert/strict';
import { test } from 'node:test';

import { reconcilePool, reconcileTransfer } from '../src/server/reconcile.ts';

const pool = {
    usdgBalance: 50_100_000_000n,
    quoteReserve: 50_000_000_000n,
    rewardsHeld: 40_000_000n,
    claimedRecorded: 40_000_000n,
    claimedOnchain: 40_000_000n,
    routedOnchain: 40_000_000n,
};

test('direct transfer is surplus, not drift', () => {
    const [reserves] = reconcilePool('weth', pool);

    assert.equal(reserves!.status, 'matched');
    assert.equal(reserves!.surplus, 60_000_000n);
});

test('negative surplus is drift', () => {
    const [reserves] = reconcilePool('weth', { ...pool, usdgBalance: 50_000_000_000n });

    assert.equal(reserves!.status, 'drift');
});

test('a claim not yet routed is drift', () => {
    const checks = reconcilePool('weth', { ...pool, routedOnchain: 0n });

    assert.equal(checks.find((c) => c.rule === 'routing')!.status, 'drift');
    assert.equal(checks.find((c) => c.rule === 'claims')!.status, 'matched');
});

test('an in flight transfer is pending until it lands in full', () => {
    const t = { guid: '0x01', amountSent: 5n, amountReceived: null } as const;

    assert.equal(reconcileTransfer(t).status, 'pending');
    assert.equal(reconcileTransfer({ ...t, amountReceived: 5n }).status, 'matched');
    assert.equal(reconcileTransfer({ ...t, amountReceived: 4n }).status, 'drift');
});
