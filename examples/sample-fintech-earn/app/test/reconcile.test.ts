import assert from 'node:assert/strict';
import { test } from 'node:test';

import { reconcile } from '../src/server/reconcile.ts';

const base = {
    sharesByVault: {
        steakhouse: { ledger: 100n, onchain: 100n },
        gauntlet: { ledger: 0n, onchain: 0n },
        glv: { ledger: 0n, onchain: 0n },
    },
    usdg: { balances: 500n, reserved: 0n, onchain: 600n },
    arb: { claimed: 10n, allocated: 10n, onchain: 10n },
};

const find = (checks: ReturnType<typeof reconcile>, rule: string, vaultId?: string) =>
    checks.find((c) => c.rule === rule && c.vaultId === vaultId);

test('matched when ledger shares equal onchain', () => {
    assert.equal(find(reconcile(base), 'shares', 'steakhouse')?.status, 'matched');
});

test('drift when onchain shares are lower', () => {
    const checks = reconcile({
        ...base,
        sharesByVault: {
            ...base.sharesByVault,
            steakhouse: { ledger: 100n, onchain: 99n },
        },
    });

    assert.equal(find(checks, 'shares', 'steakhouse')?.status, 'drift');
});

test('usdg drift when balances plus reserved exceed onchain', () => {
    assert.equal(find(reconcile(base), 'usdg')?.status, 'matched');
    assert.equal(
        find(
            reconcile({
                ...base,
                usdg: { balances: 500n, reserved: 200n, onchain: 600n },
            }),
            'usdg',
        )?.status,
        'drift',
    );
});

test('rewards drift when allocated exceeds claimed', () => {
    assert.equal(find(reconcile(base), 'rewards')?.status, 'matched');
    assert.equal(
        find(
            reconcile({ ...base, arb: { claimed: 10n, allocated: 11n, onchain: 20n } }),
            'rewards',
        )?.status,
        'drift',
    );
    assert.equal(
        find(
            reconcile({ ...base, arb: { claimed: 10n, allocated: 10n, onchain: 9n } }),
            'rewards',
        )?.status,
        'drift',
    );
});
