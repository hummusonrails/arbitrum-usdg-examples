import assert from 'node:assert/strict';
import { test } from 'node:test';

import { allocate } from '../src/server/rewards.ts';

const zero = { steakhouse: 0n, gauntlet: 0n, glv: 0n };
const sumOf = (r: ReturnType<typeof allocate>, id: string) =>
    r.allocations.filter((a) => a.customerId === id).reduce((s, a) => s + a.amount, 0n);

test('splits by share-seconds', () => {
    const r = allocate({
        amountByVault: { ...zero, gauntlet: 300n },
        history: [
            { customerId: 'a', vaultId: 'gauntlet', shares: 100n, at: 0 },
            { customerId: 'b', vaultId: 'gauntlet', shares: 100n, at: 5_000 },
        ],
        from: 0,
        to: 10_000,
        carry: zero,
    });

    // a holds 100 for 10 s, b holds 100 for the last 5 s: 1000 against 500.
    assert.equal(sumOf(r, 'a'), 200n);
    assert.equal(sumOf(r, 'b'), 100n);
    assert.equal(r.carry.gauntlet, 0n);
});

test('floors and carries the remainder', () => {
    const r = allocate({
        amountByVault: { ...zero, steakhouse: 100n },
        history: ['a', 'b', 'c'].map((id) => ({
            customerId: id,
            vaultId: 'steakhouse' as const,
            shares: 10n,
            at: 0,
        })),
        from: 0,
        to: 1_000,
        carry: zero,
    });

    for (const id of ['a', 'b', 'c']) {
        assert.equal(sumOf(r, id), 33n);
    }

    assert.equal(r.carry.steakhouse, 1n);
});

test('carries everything when nobody held shares', () => {
    const r = allocate({
        amountByVault: { ...zero, gauntlet: 50n },
        history: [{ customerId: 'a', vaultId: 'gauntlet', shares: 0n, at: 0 }],
        from: 0,
        to: 1_000,
        carry: { ...zero, gauntlet: 7n },
    });

    assert.equal(r.allocations.length, 0);
    assert.equal(r.carry.gauntlet, 57n);
});

test('counts holdings from before the period and stops at withdrawals', () => {
    const r = allocate({
        amountByVault: { ...zero, steakhouse: 90n },
        history: [
            { customerId: 'a', vaultId: 'steakhouse', shares: 10n, at: -5_000 },
            { customerId: 'b', vaultId: 'steakhouse', shares: 10n, at: 0 },
            { customerId: 'b', vaultId: 'steakhouse', shares: 0n, at: 500 },
        ],
        from: 0,
        to: 1_000,
        carry: zero,
    });

    // a: 10 x 1000, b: 10 x 500.
    assert.equal(sumOf(r, 'a'), 60n);
    assert.equal(sumOf(r, 'b'), 30n);
});

test('allocated never exceeds amount plus carry', () => {
    let seed = 42;
    const rand = (n: number) => {
        seed = (seed * 1103515245 + 12345) % 2 ** 31;

        return seed % n;
    };

    for (let round = 0; round < 200; round++) {
        const history = Array.from({ length: 1 + rand(8) }, () => ({
            customerId: ['a', 'b', 'c', 'd'][rand(4)]!,
            vaultId: 'gauntlet' as const,
            shares: BigInt(rand(1_000)),
            at: rand(1_000),
        })).sort((x, y) => x.at - y.at);
        const amount = BigInt(rand(10_000));
        const carry = BigInt(rand(5));
        const r = allocate({
            amountByVault: { ...zero, gauntlet: amount },
            history,
            from: 0,
            to: 1_000,
            carry: { ...zero, gauntlet: carry },
        });
        const given = r.allocations.reduce((s, a) => s + a.amount, 0n);

        assert.ok(given >= 0n);
        assert.equal(given + r.carry.gauntlet, amount + carry);
    }
});

test('no rewards and no campaign gives zeros without throwing', async () => {
    const { readRewards } = await import('../src/server/rewards.ts');
    const { boostFor } = await import('../src/server/market.ts');
    const { openDb } = await import('../src/server/db.ts');
    const realFetch = globalThis.fetch;

    globalThis.fetch = (async () => Response.json([])) as typeof fetch;

    try {
        const ctx = {
            config: { merklApiUrl: 'http://merkl.test', mode: 'mainnet' },
            db: openDb(':memory:'),
            chain: {
                omnibus: '0x0000000000000000000000000000000000000001',
                publicClient: { readContract: async () => [0n, 0, '0x'] },
            },
        } as unknown as Parameters<typeof readRewards>[0];
        const state = await readRewards(ctx);

        assert.equal(state.accrued, 0n);
        assert.equal(state.claimable, 0n);
        assert.equal(state.allocated, 0n);
        assert.equal(
            boostFor([], '0x390c1bb01F3F627144a40617e287d4cE3D5aBCfa', 'claim'),
            null,
        );
    } finally {
        globalThis.fetch = realFetch;
    }
});
