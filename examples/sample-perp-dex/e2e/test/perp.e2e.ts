// End to end: the built app and a fresh Anvil fork of Arbitrum One, driven
// only through the app's HTTP API and the chain.
import assert from 'node:assert/strict';
import { mkdtempSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { after, before, test } from 'node:test';

import { acmeMarginVaultAbi } from '@arbitrum-usdg/perp-dex-contracts';
import { USDG, usdgRewardsAbi } from '@arbitrum-usdg/usdg';
import { erc20Abi, parseUnits, type Address } from 'viem';

import { startStack, type Stack } from '../../app/scripts/stack.ts';
import { MARKETS } from '../../app/src/server/registry.ts';
import type { Snapshot } from '../../app/src/server/snapshot.ts';

const usdg = USDG.arbitrumOne.address;
const units = (n: string) => parseUnits(n, 6);

let stack: Stack;

async function api(body: Record<string, unknown>) {
    const res = await fetch(`${stack.appUrl}/api/actions`, {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify(body),
    });

    return {
        status: res.status,
        body: (await res.json()) as { ok: boolean; message?: string },
    };
}

async function ok(body: Record<string, unknown>) {
    const res = await api(body);

    assert.equal(res.status, 200, `${JSON.stringify(body)}: ${res.body.message}`);
}

async function state(): Promise<Snapshot> {
    return (
        await fetch(`${stack.appUrl}/api/state?once=1`)
    ).json() as Promise<Snapshot>;
}

async function until<T>(
    what: string,
    read: (s: Snapshot) => T | undefined | false,
    ms = 60_000,
) {
    const end = Date.now() + ms;

    while (Date.now() < end) {
        const value = read(await state());

        if (value !== undefined && value !== false) {
            return value;
        }

        await new Promise((r) => setTimeout(r, 1000));
    }

    throw new Error(`Timed out waiting for ${what}`);
}

const vault = <T>(functionName: string, args: readonly unknown[] = []) =>
    stack.client.readContract({
        address: stack.vault,
        abi: acmeMarginVaultAbi,
        functionName,
        args,
    } as never) as Promise<T>;

const usdgOf = (who: Address) =>
    stack.client.readContract({
        address: usdg,
        abi: erc20Abi,
        functionName: 'balanceOf',
        args: [who],
    });

// The vault's latest event of one kind.
async function lastEvents<
    E extends 'PositionClosed' | 'RewardsNotified' | 'MarginDeposited',
>(eventName: E) {
    const logs = await stack.client.getContractEvents({
        address: stack.vault,
        abi: acmeMarginVaultAbi,
        eventName,
        fromBlock: stack.startBlock,
    });

    return logs.at(-1)!;
}

before(async () => {
    stack = await startStack({
        app: 'start',
        appPort: 3120,
        arbPort: 8675,
        dbPath: join(mkdtempSync(join(tmpdir(), 'perp-e2e-')), 'perp.db'),
        loopMs: 1000,
        quiet: true,
    });
});

after(async () => {
    await stack?.stop();
});

test('deposits margin with one signature, relayed by the keeper', async () => {
    const mei = stack.wallets.mei;
    const [usdgBefore, ethBefore] = await Promise.all([
        usdgOf(mei),
        stack.client.getBalance({ address: mei }),
    ]);

    await ok({ action: 'deposit', who: 'mei', amount: '3000' });

    const deposited = await lastEvents('MarginDeposited');

    assert.equal(usdgBefore - (await usdgOf(mei)), units('3000'));
    assert.equal(await vault<bigint>('freeMargin', [mei]), units('3000'));
    assert.equal(deposited.args.relayer, stack.keeper);
    // The keeper paid the gas, so the trader's ETH did not move.
    assert.equal(await stack.client.getBalance({ address: mei }), ethBefore);
});

test('refuses a replayed deposit signature', async () => {
    const deposited = await lastEvents('MarginDeposited');
    const tx = await stack.client.getTransaction({ hash: deposited.transactionHash });
    const freeBefore = await vault<bigint>('freeMargin', [stack.wallets.mei]);

    await assert.rejects(
        stack.client.call({ account: stack.keeper, to: stack.vault, data: tx.input }),
        /DepositNotReceived|reverted/,
    );
    assert.equal(await vault<bigint>('freeMargin', [stack.wallets.mei]), freeBefore);
});

test('refuses a position larger than free margin', async () => {
    const res = await api({
        action: 'open',
        who: 'mei',
        market: 'eth',
        side: 'long',
        collateral: '5000',
        leverage: 2,
    });

    assert.equal(res.status, 409);
    assert.match(res.body.message!, /5010 USDG.*3000 USDG/);
});

test('opens and closes a position at the oracle price', async () => {
    const mei = stack.wallets.mei;

    await ok({
        action: 'open',
        who: 'mei',
        market: 'eth',
        side: 'long',
        collateral: '500',
        leverage: 5,
    });

    const position = await vault<{ size: bigint; collateral: bigint }>('positionOf', [
        mei,
        MARKETS.eth.key,
    ]);

    assert.equal(position.size, units('2500'));
    assert.equal(await vault<bigint>('freeMargin', [mei]), units('2497.5'));

    await ok({ action: 'move', market: 'eth', bps: 500 });
    await ok({ action: 'close', who: 'mei', market: 'eth' });

    const closed = await lastEvents('PositionClosed');

    // About +5% on 2,500, less the 2.5 USDG close fee.
    assert.ok(closed.args.pnl! > units('124') && closed.args.pnl! <= units('125'));
    assert.equal(closed.args.payout, units('500') + closed.args.pnl! - units('2.5'));
    assert.equal(
        await vault<bigint>('freeMargin', [mei]),
        units('2497.5') + closed.args.payout!,
    );
    await ok({ action: 'move', market: 'eth', bps: 0 });
});

test('the keeper liquidates a position after the market moves', async () => {
    const mei = stack.wallets.mei;

    await ok({
        action: 'open',
        who: 'mei',
        market: 'eth',
        side: 'long',
        collateral: '400',
        leverage: 10,
    });

    const liquidityBefore = await vault<bigint>('liquidity');

    await ok({ action: 'move', market: 'eth', bps: -1000 });
    await until('the liquidation', (s) =>
        s.liquidations.some((l) => l.trader === 'Mei'),
    );

    const position = await vault<{ size: bigint }>('positionOf', [
        mei,
        MARKETS.eth.key,
    ]);

    assert.equal(position.size, 0n);
    assert.equal(await vault<bigint>('lockedMargin', [mei]), 0n);
    assert.equal((await vault<bigint>('liquidity')) - liquidityBefore, units('400'));
    await ok({ action: 'move', market: 'eth', bps: 0 });
});

test('registers the vault through propose and accept', async () => {
    const early = await api({ action: 'accept' });

    assert.equal(early.status, 409);
    assert.match(early.body.message!, /Propose the vault first/);

    await ok({ action: 'propose' });
    await ok({ action: 'accept' });

    const group = await stack.client.readContract({
        address: usdg,
        abi: usdgRewardsAbi,
        functionName: 'payoutGroupIdOf',
        args: [stack.vault],
    });

    assert.equal(group, stack.payoutGroupId);
    await until(
        'registered on the console',
        (s) => s.registration.status === 'registered',
    );
});

test('routes accrued rewards to traders and the house', async () => {
    const ana = stack.wallets.ana;

    await ok({ action: 'advance', days: 7 });

    const opBefore = await usdgOf(stack.operator);

    await ok({ action: 'route' });

    const notified = await lastEvents('RewardsNotified');
    const { toTraders, toLiquidity, amount } = notified.args;

    assert.ok(amount! > 0n);
    assert.equal(toTraders! + toLiquidity!, amount);
    // Everything claimed went back into the vault.
    assert.equal(await usdgOf(stack.operator), opBefore);

    const pending = await Promise.all(
        Object.values(stack.wallets).map((w) => vault<bigint>('pendingRewards', [w])),
    );
    const owed = pending.reduce((a, b) => a + b, 0n);

    assert.ok(owed <= toTraders! && toTraders! - owed <= 3n, `${owed} of ${toTraders}`);

    const anaPending = await vault<bigint>('pendingRewards', [ana]);
    const freeBefore = await vault<bigint>('freeMargin', [ana]);

    await ok({ action: 'claimRewards', who: 'ana' });
    assert.equal((await vault<bigint>('freeMargin', [ana])) - freeBefore, anaPending);

    const second = await api({ action: 'claimRewards', who: 'ana' });

    assert.equal(second.status, 409);
});

test('rebuilds positions, liquidations, and rewards after a restart', async () => {
    const before = await state();

    await stack.stopApp();
    await stack.startApp();

    const after = await until('a snapshot after restart', (s) => s);

    assert.deepEqual(
        after.traders.map((t) => t.positions.length),
        before.traders.map((t) => t.positions.length),
    );
    assert.equal(after.liquidations.length, before.liquidations.length);
    assert.equal(after.rewards.claimed, before.rewards.claimed);
    assert.equal(after.rewards.routed, before.rewards.routed);
});

test('the books reconcile', async () => {
    const s = await until('a fresh snapshot', (snap) => snap);

    assert.equal(s.checks.length, 6);

    for (const check of s.checks) {
        assert.equal(check.status, 'matched', JSON.stringify(check));
    }
});
