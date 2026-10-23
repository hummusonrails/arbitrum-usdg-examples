// End to end: the built app, the LayerZero relay stand in, and fresh Anvil
// forks of Arbitrum One and Ethereum, driven only through the app's HTTP API
// and the chains.
import assert from 'node:assert/strict';
import { mkdtempSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { after, before, test } from 'node:test';

import { acmePoolAbi } from '@arbitrum-usdg/spot-dex-contracts';
import { USDG, USDG_ETHEREUM, usdgRewardsAbi } from '@arbitrum-usdg/usdg';
import { erc20Abi, parseUnits, type Address } from 'viem';

import { startStack, type Stack } from '../../app/scripts/stack.ts';
import { WETH } from '../../app/src/server/registry.ts';
import type { Snapshot } from '../../app/src/server/snapshot.ts';

const usdg = USDG.arbitrumOne.address;

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

const balance = (
    client: Stack['arbitrum'] | Stack['ethereum'],
    token: Address,
    who: Address,
) =>
    client.readContract({
        address: token,
        abi: erc20Abi,
        functionName: 'balanceOf',
        args: [who],
    });

const pending = (who: Address) =>
    stack.arbitrum.readContract({
        address: stack.pools.weth,
        abi: acmePoolAbi,
        functionName: 'pendingRewards',
        args: [who],
    });

before(async () => {
    stack = await startStack({
        app: 'start',
        appPort: 3110,
        arbPort: 8645,
        ethPort: 8646,
        dbPath: join(mkdtempSync(join(tmpdir(), 'dex-e2e-')), 'dex.db'),
        loopMs: 1000,
        relayDelayMs: 1000,
        quiet: true,
    });
});

after(async () => {
    await stack?.stop();
});

test('swaps USDG for WETH', async () => {
    const priya = stack.wallets.priya;
    const amount = parseUnits('1000', 6);
    const quoted = await stack.arbitrum.readContract({
        address: stack.pools.weth,
        abi: acmePoolAbi,
        functionName: 'getAmountOut',
        args: [usdg, amount],
    });
    const [usdgBefore, wethBefore] = await Promise.all([
        balance(stack.arbitrum, usdg, priya),
        balance(stack.arbitrum, WETH, priya),
    ]);

    await ok({
        action: 'swap',
        who: 'priya',
        poolId: 'weth',
        side: 'buy',
        amount: '1000',
    });

    assert.equal(usdgBefore - (await balance(stack.arbitrum, usdg, priya)), amount);
    assert.equal((await balance(stack.arbitrum, WETH, priya)) - wethBefore, quoted);
});

test('refuses a swap larger than the balance', async () => {
    const before = await balance(stack.arbitrum, usdg, stack.wallets.priya);
    const res = await api({
        action: 'swap',
        who: 'priya',
        poolId: 'weth',
        side: 'buy',
        amount: '9999999',
    });

    assert.equal(res.status, 409);
    assert.match(res.body.message!, /wallet holds/);
    assert.equal(await balance(stack.arbitrum, usdg, stack.wallets.priya), before);
});

test('registers a pool through propose and accept', async () => {
    const refused = await api({ action: 'accept', poolId: 'weth' });

    assert.equal(refused.status, 409);
    await ok({ action: 'propose', poolId: 'weth' });
    await until('proposed', (s) => s.pools[0]!.registration.status === 'proposed');
    await ok({ action: 'accept', poolId: 'weth' });

    const group = await stack.arbitrum.readContract({
        address: usdg,
        abi: usdgRewardsAbi,
        functionName: 'payoutGroupIdOf',
        args: [stack.pools.weth],
    });

    assert.equal(group, stack.payoutGroupId);
    await until('registered', (s) => s.pools[0]!.registration.status === 'registered');
});

test('routes accrued rewards to LPs', async () => {
    const lena = stack.wallets.lena;
    const omar = stack.wallets.omar;
    const [lenaLp, omarLp] = await Promise.all([
        balance(stack.arbitrum, stack.pools.weth, lena),
        balance(stack.arbitrum, stack.pools.weth, omar),
    ]);

    await ok({ action: 'advance', days: 7 });
    await ok({ action: 'route', poolId: 'weth' });

    const [lenaPending, omarPending] = await Promise.all([
        pending(lena),
        pending(omar),
    ]);

    assert.ok(lenaPending > 0n);
    // Shared by LP balance, to within a unit of rounding.
    const expectedOmar = (lenaPending * omarLp) / lenaLp;

    assert.ok(omarPending - expectedOmar <= 1n && expectedOmar - omarPending <= 1n);

    const before = await balance(stack.arbitrum, usdg, lena);

    await ok({ action: 'claimLp', who: 'lena', poolId: 'weth' });
    assert.equal((await balance(stack.arbitrum, usdg, lena)) - before, lenaPending);
});

test('moves USDG to Ethereum and back', async () => {
    const lena = stack.wallets.lena;
    const amount = parseUnits('500', 6);
    const onEth = await balance(stack.ethereum, USDG_ETHEREUM, lena);
    const onArb = await balance(stack.arbitrum, usdg, lena);

    await ok({ action: 'move', who: 'lena', from: 'arbitrum', amount: '500' });
    assert.equal(onArb - (await balance(stack.arbitrum, usdg, lena)), amount);
    // Wait for this transfer itself: an empty list would pass an every() check.
    await until(
        'delivered to Ethereum',
        (s) => s.transfers.length === 1 && s.transfers[0]!.status === 'delivered',
    );
    assert.equal((await balance(stack.ethereum, USDG_ETHEREUM, lena)) - onEth, amount);

    await ok({ action: 'move', who: 'lena', from: 'ethereum', amount: '500' });
    await until(
        'delivered back to Arbitrum',
        (s) =>
            s.transfers.length === 2 &&
            s.transfers.every((t) => t.status === 'delivered'),
    );
    assert.equal(await balance(stack.arbitrum, usdg, lena), onArb);
    assert.equal(await balance(stack.ethereum, USDG_ETHEREUM, lena), onEth);
});

test('restores an in flight transfer after restart', async () => {
    stack.relay.pause();

    try {
        await ok({ action: 'move', who: 'omar', from: 'arbitrum', amount: '100' });
        await stack.stopApp();
        await stack.startApp();
        await until('in flight after restart', (s) =>
            s.transfers.some((t) => t.wallet === 'omar' && t.status === 'in flight'),
        );
    } finally {
        stack.relay.resume();
    }

    await until(
        'delivered after resume',
        (s) =>
            s.transfers.length === 3 &&
            s.transfers.every((t) => t.status === 'delivered'),
    );
});

test('the books reconcile', async () => {
    const s = await until('a fresh snapshot', (snap) => snap);

    for (const check of s.checks) {
        assert.equal(check.status, 'matched', JSON.stringify(check));
    }
});
