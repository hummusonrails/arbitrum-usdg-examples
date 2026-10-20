// End to end: the built app, the mock Paxos server, and a fresh Anvil fork of
// Arbitrum One, driven only through the app's HTTP API and the chain.
import assert from 'node:assert/strict';
import { mkdtempSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { after, before, test } from 'node:test';

import { USDG, usdgAbi } from '@arbitrum-usdg/usdg';
import {
    createPublicClient,
    createTestClient,
    http,
    parseEventLogs,
    type Address,
    type Hex,
} from 'viem';
import { arbitrum } from 'viem/chains';

import { startStack, type Stack } from '../../app/scripts/stack.ts';
import type { Snapshot } from '../../app/src/server/snapshot.ts';

let stack: Stack;
let chain: ReturnType<typeof createPublicClient>;
let anvil: ReturnType<typeof createTestClient>;
let forkBlock: bigint;

async function api(body: Record<string, unknown>) {
    const res = await fetch(`${stack.appUrl}/api/actions`, {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify(body),
    });

    return { status: res.status, body: (await res.json()) as Record<string, unknown> };
}

async function state(): Promise<Snapshot> {
    return (
        await fetch(`${stack.appUrl}/api/state?once=1`)
    ).json() as Promise<Snapshot>;
}

async function until<T>(
    what: string,
    read: (s: Snapshot) => T | undefined,
    ms = 90_000,
): Promise<T> {
    const end = Date.now() + ms;
    let last: Snapshot | undefined;

    while (Date.now() < end) {
        last = await state();

        const value = read(last);

        if (value !== undefined && value !== false) {
            return value;
        }

        await new Promise((r) => setTimeout(r, 500));
    }

    throw new Error(
        `Timed out waiting for ${what}. Last actions: ${JSON.stringify(last?.actions.slice(0, 3))} ledger: ${JSON.stringify(last?.ledger.slice(0, 3))}`,
    );
}

async function mock(path: string, body?: unknown) {
    const res = await fetch(`${stack.mockUrl}${path}`, {
        method: body === undefined ? 'GET' : 'POST',
        headers: { 'content-type': 'application/json' },
        body: body === undefined ? undefined : JSON.stringify(body),
    });

    return res.json() as Promise<Record<string, unknown>>;
}

async function walletUsdg(): Promise<bigint> {
    return chain.readContract({
        address: USDG.arbitrumOne.address,
        abi: usdgAbi,
        functionName: 'balanceOf',
        args: [stack.wallet],
    });
}

async function depositAddress(): Promise<Address> {
    const list = (await mock('/v2/transfer/deposit-addresses')) as {
        items: { address: Address }[];
    };

    return list.items[0]!.address;
}

async function setPolicy(min: string, target: string, max: string, paused: boolean) {
    assert.equal((await api({ action: 'setPolicy', min, target, max })).status, 200);
    assert.equal((await api({ action: 'pausePolicy', paused })).status, 200);
}

const action = (s: Snapshot, refId: string) =>
    s.actions.find((a) => a.ref_id === refId);
const row = (s: Snapshot, id: string) => s.ledger.find((r) => r.id === id);

before(async () => {
    stack = await startStack({
        app: 'start',
        appPort: 3107,
        mockPort: 4017,
        anvilPort: 8547,
        dbPath: join(mkdtempSync(join(tmpdir(), 'treasury-e2e-')), 'treasury.db'),
        loopMs: 1000,
        env: { POLICY_START_PAUSED: '1' },
        quiet: process.env.E2E_VERBOSE !== '1',
    });
    chain = createPublicClient({ chain: arbitrum, transport: http(stack.rpcUrl) });
    anvil = createTestClient({
        chain: arbitrum,
        mode: 'anvil',
        transport: http(stack.rpcUrl),
    });
    forkBlock = await chain.getBlockNumber();
});

after(async () => {
    await stack?.stop();
});

test('a simulated wire fires the auto mint rule and lands as a matched inflow', async () => {
    assert.equal(
        (await api({ action: 'simulateWire', amount: '2500.00' })).status,
        200,
    );

    const inflow = await until('a matched rule inflow', (s) =>
        s.ledger.find((r) => r.source === 'rule' && r.status === 'matched'),
    );

    assert.equal(inflow.amount, '2500');
    assert.equal(inflow.onchain_amount, '2500');
    assert.equal(await walletUsdg(), 2_500_000_000n);
});

test('a manual mint with a fractional amount matches the chain exactly', async () => {
    const res = await api({ action: 'mint', amount: '1234.5' });

    assert.equal(res.status, 200);

    const refId = (res.body.snapshot as Snapshot).actions[0]!.ref_id;
    const matched = await until('the mint to match', (s) =>
        action(s, refId)?.status === 'completed' && row(s, refId)?.status === 'matched'
            ? row(s, refId)
            : undefined,
    );

    assert.equal(matched.onchain_amount, '1234.5');
    assert.equal(await walletUsdg(), 3_734_500_000n);
});

test('below the minimum the policy mints back to target', async () => {
    await setPolicy('5000', '6000', '10000', false);

    const minted = await until('a policy mint to match', (s) =>
        s.actions.find(
            (a) =>
                a.kind === 'mint' &&
                a.amount === '2265.5' &&
                row(s, a.ref_id)?.status === 'matched',
        ),
    );

    assert.ok(minted);
    assert.equal(await walletUsdg(), 6_000_000_000n);
    await api({ action: 'pausePolicy', paused: true });
});

test('above the maximum the policy redeems, answers the travel rule hold, and pays the bank', async () => {
    await setPolicy('100', '1000', '2000', false);

    const redeemed = await until(
        'a policy redeem to complete',
        (s) =>
            s.actions.find(
                (a) =>
                    a.kind === 'redeem' &&
                    a.amount === '5000' &&
                    a.status === 'completed' &&
                    row(s, a.ref_id)?.status === 'matched',
            ),
        120_000,
    );

    await api({ action: 'pausePolicy', paused: true });
    assert.equal(redeemed.step, 'done');
    assert.equal(await walletUsdg(), 1_000_000_000n);

    const transfers = (await mock('/v2/transfer/transfers')) as {
        items: { type: string; crypto_tx_hash?: string; status: string }[];
    };
    const deposit = transfers.items.find(
        (t) =>
            t.type === 'CRYPTO_DEPOSIT' &&
            t.crypto_tx_hash === redeemed.deposit_tx_hash,
    );

    assert.equal(deposit?.status, 'COMPLETED');
});

test('a failed conversion becomes stuck, pauses the policy, and completes on retry', async () => {
    await mock('/mock/fail-next', { kind: 'redeem' });

    const res = await api({ action: 'redeem', amount: '10' });

    assert.equal(res.status, 200);

    const refId = (res.body.snapshot as Snapshot).actions[0]!.ref_id;

    await until('the redeem to be stuck', (s) => action(s, refId)?.status === 'stuck');
    await api({ action: 'pausePolicy', paused: false });

    const s = await until('a policy decision', (x) => (x.decision ? x : undefined));

    assert.deepEqual(s.decision, { kind: 'none', reason: 'stuck' });
    await api({ action: 'pausePolicy', paused: true });
    assert.equal((await api({ action: 'retry', refId })).status, 200);
    await until(
        'the retried redeem to complete',
        (x) => action(x, refId)?.status === 'completed',
    );
});

test('the same webhook event delivered twice and polled is applied once', async () => {
    const events = (await mock('/v2/events')) as {
        events: { id: string; type: string }[];
    };
    const event = events.events.at(-1)!;
    const post = () =>
        fetch(`${stack.appUrl}/api/webhooks/paxos`, {
            method: 'POST',
            headers: {
                'content-type': 'application/json',
                'x-api-key': 'local-webhook-key',
            },
            body: JSON.stringify({ id: event.id, type: event.type, is_test: false }),
        });

    assert.equal((await post()).status, 200);
    assert.equal((await post()).status, 200);

    const unauthorized = await fetch(`${stack.appUrl}/api/webhooks/paxos`, {
        method: 'POST',
        body: JSON.stringify({ id: event.id, type: event.type }),
    });

    assert.equal(unauthorized.status, 401);
    await new Promise((r) => setTimeout(r, 3000));

    const s = await state();

    assert.equal(s.feed.filter((l) => l.text.includes(event.id)).length, 1);
});

test('without gas the redeem preflight refuses and nothing is sent', async () => {
    const before = (await state()).actions.length;
    const balance = await chain.getBalance({ address: stack.wallet });

    await anvil.setBalance({ address: stack.wallet, value: 0n });

    const res = await api({ action: 'redeem', amount: '1' });

    await anvil.setBalance({ address: stack.wallet, value: balance });
    assert.equal(res.status, 409);
    assert.equal(res.body.reason, 'no_gas');
    assert.match(String(res.body.message), /Add ETH/);
    assert.equal((await state()).actions.length, before);
});

test('a Paxos amount that disagrees with the chain shows as a mismatch', async () => {
    await mock('/mock/tamper-next', {});

    const res = await api({ action: 'mint', amount: '7' });
    const refId = (res.body.snapshot as Snapshot).actions[0]!.ref_id;
    const mismatched = await until('a mismatch', (s) =>
        row(s, refId)?.status === 'mismatch' ? row(s, refId) : undefined,
    );

    assert.equal(mismatched.onchain_amount, '7');
});

test('restarting during a redeem neither resends USDG nor repeats the conversion', async () => {
    const res = await api({ action: 'redeem', amount: '0.000001' });
    const refId = (res.body.snapshot as Snapshot).actions[0]!.ref_id;

    await stack.stopApp();
    await stack.startApp();

    const done = await until(
        'the redeem to complete after restart',
        (s) =>
            action(s, refId)?.status === 'completed' &&
            row(s, refId)?.status === 'matched'
                ? row(s, refId)
                : undefined,
        120_000,
    );

    assert.equal(done.onchain_amount, '0.000001');

    const to = await depositAddress();
    const logs = await chain.getLogs({
        address: USDG.arbitrumOne.address,
        event: usdgAbi.find((x) => x.type === 'event' && x.name === 'Transfer')!,
        args: { from: stack.wallet, to },
        fromBlock: forkBlock,
    });
    const tiny = parseEventLogs({ abi: usdgAbi, logs, eventName: 'Transfer' }).filter(
        (l) => l.args.value === 1n,
    );

    assert.equal(tiny.length, 1);

    const converts = (await mock(
        `/v2/orchestration/orchestrations?ref_id=${encodeURIComponent(`${refId}-convert`)}`,
    )) as { items: unknown[] };

    assert.equal(converts.items.length, 1);
    assert.equal(
        action(await state(), refId)?.deposit_tx_hash,
        done.crypto_tx_hash as Hex,
    );
});
