import assert from 'node:assert/strict';
import { mkdtempSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { test } from 'node:test';

import type { Ctx } from '../src/server/ctx.ts';
import { openDb } from '../src/server/db.ts';
import { getCustomer, getPosition, seedCustomers } from '../src/server/ledger.ts';
import type { VaultMarket } from '../src/server/market.ts';
import {
    acceptDisclosure,
    PreflightError,
    settleOpen,
    startDeposit,
    startWithdraw,
} from '../src/server/money.ts';
import type { Settlement, VaultAdapter, VaultId } from '../src/server/vaults/types.ts';
import { VAULTS } from '../src/server/vaults/registry.ts';

const USDG = (n: number) => BigInt(n) * 1_000_000n;
const SHARES = (n: number) => BigInt(n) * 10n ** 18n;

// A vault that prices one share at one USDG and settles however the test says.
function fakeVault(
    id: VaultId,
    next: { settle: () => Settlement | null },
): VaultAdapter {
    return {
        config: VAULTS[id],
        readState: async () => ({
            totalAssets: 0n,
            sharePrice: USDG(1),
            omnibusShares: 0n,
            depositsOpen: true,
            withdrawalsOpen: true,
        }),
        sharesForAssets: async (assets) => assets * 10n ** 12n,
        assetsForShares: async (shares) => shares / 10n ** 12n,
        preflight: async (_kind, assets, instantLiquidity) =>
            instantLiquidity != null && assets > instantLiquidity
                ? {
                      ok: false,
                      reason: 'Not enough liquidity right now.',
                      maxNow: instantLiquidity,
                  }
                : { ok: true },
        deposit: async (amount) => ({
            txHash: '0x01',
            mode: id === 'glv' ? 'async' : 'sync',
            amount,
            requestKey: id === 'glv' ? '0x02' : undefined,
        }),
        withdraw: async (amount) => ({ txHash: '0x03', mode: 'sync', amount }),
        settle: async () => next.settle(),
    };
}

function market(id: VaultId, instantLiquidity: bigint | null): VaultMarket {
    return {
        id,
        vaultApy: null,
        boost: null,
        tvl: null,
        instantLiquidity,
        performanceFee: null,
        withdrawalFee: null,
        updatedAt: '',
    };
}

function ctxFor(
    dbPath: string,
    adapters: Partial<Record<VaultId, VaultAdapter>>,
    liquidity: bigint | null,
): Ctx {
    const db = openDb(dbPath);

    seedCustomers(db);

    return {
        db,
        adapters: adapters as Record<VaultId, VaultAdapter>,
        markets: async () => ({
            steakhouse: market('steakhouse', liquidity),
            gauntlet: market('gauntlet', liquidity),
            glv: market('glv', null),
        }),
    } as unknown as Ctx;
}

test('withdraw above instant liquidity is refused and nothing is debited', async () => {
    const executed = {
        settle: (): Settlement => ({
            status: 'executed',
            shares: SHARES(100),
            assets: USDG(100),
        }),
    };
    const ctx = ctxFor(
        ':memory:',
        { steakhouse: fakeVault('steakhouse', executed) },
        USDG(50),
    );

    ctx.db
        .prepare('UPDATE customers SET usdg_units = ? WHERE id = ?')
        .run(USDG(100).toString(), 'maya');
    acceptDisclosure(ctx, 'maya', 'steakhouse');
    await startDeposit(ctx, 'maya', 'steakhouse', USDG(100));

    assert.equal(getPosition(ctx.db, 'maya', 'steakhouse').shares, SHARES(100));

    await assert.rejects(
        startWithdraw(ctx, 'maya', 'steakhouse', USDG(80)),
        (err: unknown) => err instanceof PreflightError && err.maxNow === USDG(50),
    );
    assert.equal(getPosition(ctx.db, 'maya', 'steakhouse').shares, SHARES(100));
    assert.equal(getCustomer(ctx.db, 'maya').usdg, 0n);
});

test('pending async action settles after restart', async () => {
    const dbPath = join(mkdtempSync(join(tmpdir(), 'earn-')), 'earn.db');
    const pending = { settle: (): Settlement | null => null };
    const first = ctxFor(dbPath, { glv: fakeVault('glv', pending) }, null);

    first.db
        .prepare('UPDATE customers SET usdg_units = ? WHERE id = ?')
        .run(USDG(300).toString(), 'diego');
    acceptDisclosure(first, 'diego', 'glv');
    await startDeposit(first, 'diego', 'glv', USDG(300));
    await settleOpen(first);

    assert.equal(getPosition(first.db, 'diego', 'glv').shares, 0n);
    assert.equal(getCustomer(first.db, 'diego').usdg, 0n);
    first.db.close();

    // The app restarts; the request executed while it was down.
    const done = {
        settle: (): Settlement => ({
            status: 'executed',
            shares: SHARES(298),
            assets: USDG(300),
        }),
    };
    const second = ctxFor(dbPath, { glv: fakeVault('glv', done) }, null);

    await settleOpen(second);
    await settleOpen(second);

    assert.equal(getPosition(second.db, 'diego', 'glv').shares, SHARES(298));
    assert.equal(getPosition(second.db, 'diego', 'glv').netDeposited, USDG(300));
});
