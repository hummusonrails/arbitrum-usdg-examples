// End to end: the built app, the local GMX keeper, the Merkl stand in, and a
// fresh Anvil fork of Arbitrum One, driven only through the app's HTTP API and
// the chain.
import assert from 'node:assert/strict';
import { mkdtempSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { after, before, test } from 'node:test';

import { erc20Abi, parseAbi, parseEventLogs, type Hex } from 'viem';

import { startStack, type Stack } from '../../app/scripts/stack.ts';
import type { Snapshot } from '../../app/src/server/snapshot.ts';
import { ARB_TOKEN } from '../../app/src/server/vaults/registry.ts';

const vaultEvents = parseAbi([
    'event Deposit(address indexed sender, address indexed onBehalf, uint256 assets, uint256 shares)',
]);

let stack: Stack;

async function api(body: Record<string, unknown>) {
    const res = await fetch(`${stack.appUrl}/api/actions`, {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify(body),
    });

    return {
        status: res.status,
        body: (await res.json()) as {
            ok: boolean;
            message?: string;
            actionId?: string;
        },
    };
}

async function ok(body: Record<string, unknown>) {
    const res = await api(body);

    assert.equal(res.status, 200, `${JSON.stringify(body)}: ${res.body.message}`);

    return res.body;
}

async function state(): Promise<Snapshot> {
    return (
        await fetch(`${stack.appUrl}/api/state?once=1`)
    ).json() as Promise<Snapshot>;
}

async function until<T>(
    what: string,
    read: (s: Snapshot) => T | undefined | false,
    ms = 240_000,
): Promise<T> {
    const end = Date.now() + ms;
    let last: Snapshot | undefined;

    while (Date.now() < end) {
        last = await state();

        const value = read(last);

        if (value !== undefined && value !== false) {
            return value;
        }

        await new Promise((r) => setTimeout(r, 1000));
    }

    throw new Error(
        `Timed out waiting for ${what}. Actions: ${JSON.stringify(last?.actions.slice(0, 4))}`,
    );
}

const customer = (s: Snapshot, id: string) => s.customers.find((c) => c.id === id)!;
const position = (s: Snapshot, id: string, vaultId: string) =>
    customer(s, id).positions.find((p) => p.vaultId === vaultId);
const executed = (s: Snapshot, actionId: string) =>
    s.actions.find((a) => a.id === actionId && a.status === 'executed');
const matched = (s: Snapshot) => s.checks.every((c) => c.status === 'matched');

// The shares the vault itself says it minted for the omnibus wallet in a tx.
async function mintedShares(txHash: string): Promise<bigint> {
    const receipt = await stack.client.getTransactionReceipt({ hash: txHash as Hex });
    const [event] = parseEventLogs({
        abi: vaultEvents,
        eventName: 'Deposit',
        logs: receipt.logs,
    }).filter((e) => e.args.onBehalf.toLowerCase() === stack.omnibus.toLowerCase());

    assert.ok(event, `no Deposit event in ${txHash}`);

    return event.args.shares;
}

before(async () => {
    stack = await startStack({
        app: 'start',
        appPort: 3117,
        anvilPort: 8557,
        merklPort: 4027,
        dbPath: join(mkdtempSync(join(tmpdir(), 'earn-e2e-')), 'earn.db'),
        loopMs: 1000,
        fixedApr: 0.05,
        quiet: process.env.E2E_VERBOSE !== '1',
    });

    for (const id of ['maya', 'diego', 'priya']) {
        await ok({ action: 'fund', customerId: id, amount: '1000' });

        for (const vaultId of ['steakhouse', 'gauntlet', 'glv']) {
            await ok({ action: 'accept', customerId: id, vaultId });
        }
    }
});

after(async () => {
    await stack?.stop();
});

test('morpho deposit credits exactly the minted shares', async () => {
    const { actionId } = await ok({
        action: 'deposit',
        customerId: 'maya',
        vaultId: 'steakhouse',
        amount: '500',
    });
    const s = await until('the deposit to settle', (s) => executed(s, actionId!) && s);
    const tx = s.actions.find((a) => a.id === actionId)!.txHash!;

    assert.equal(
        BigInt(position(s, 'maya', 'steakhouse')!.shares),
        await mintedShares(tx),
    );
    assert.equal(customer(s, 'maya').usdg, '500');
    assert.ok(matched(s), JSON.stringify(s.checks));
});

test('two customers back to back get their own shares', async () => {
    const [a, b] = await Promise.all([
        ok({
            action: 'deposit',
            customerId: 'diego',
            vaultId: 'gauntlet',
            amount: '200',
        }),
        ok({
            action: 'deposit',
            customerId: 'priya',
            vaultId: 'gauntlet',
            amount: '300',
        }),
    ]);
    const s = await until(
        'both deposits to settle',
        (s) => executed(s, a.actionId!) && executed(s, b.actionId!) && s,
    );
    const txOf = (id: string) => s.actions.find((x) => x.id === id)!.txHash!;

    assert.equal(
        BigInt(position(s, 'diego', 'gauntlet')!.shares),
        await mintedShares(txOf(a.actionId!)),
    );
    assert.equal(
        BigInt(position(s, 'priya', 'gauntlet')!.shares),
        await mintedShares(txOf(b.actionId!)),
    );
    assert.ok(matched(s), JSON.stringify(s.checks));
});

test('a withdrawal above what the customer holds is refused without moving anything', async () => {
    const before = await state();
    const res = await api({
        action: 'withdraw',
        customerId: 'priya',
        vaultId: 'steakhouse',
        amount: '10',
    });

    assert.equal(res.status, 409);
    assert.match(res.body.message ?? '', /nothing in Steakhouse/);
    assert.deepEqual(customer(await state(), 'priya'), customer(before, 'priya'));
});

test('morpho withdraw all returns USDG to the customer', async () => {
    const { actionId } = await ok({
        action: 'withdraw',
        customerId: 'maya',
        vaultId: 'steakhouse',
        amount: 'all',
    });
    const s = await until(
        'the withdrawal to settle',
        (s) => executed(s, actionId!) && s,
    );
    const usdg = Number(customer(s, 'maya').usdg);

    assert.equal(position(s, 'maya', 'steakhouse'), undefined);
    // 500 back, give or take vault rounding, plus whatever interest accrued.
    assert.ok(usdg > 999.99 && usdg < 1001, `maya has ${usdg}`);
    assert.ok(matched(s), JSON.stringify(s.checks));
});

test('glv deposit and withdraw settle through the keeper', async () => {
    const dep = await ok({
        action: 'deposit',
        customerId: 'diego',
        vaultId: 'glv',
        amount: '300',
    });
    // GLV settles through the keeper, not in the deposit transaction.
    const created = await until('the GLV deposit to be recorded', (s) =>
        s.actions.find((a) => a.id === dep.actionId),
    );

    assert.equal(created.mode, 'async');

    await until(
        'the GLV deposit to execute',
        (s) => executed(s, dep.actionId!) && position(s, 'diego', 'glv'),
    );

    const before = Number(customer(await state(), 'diego').usdg);
    const wd = await ok({
        action: 'withdraw',
        customerId: 'diego',
        vaultId: 'glv',
        amount: 'all',
    });
    const s = await until(
        'the GLV withdrawal to execute',
        (s) => executed(s, wd.actionId!) && s,
    );
    const back = Number(customer(s, 'diego').usdg) - before;

    assert.equal(position(s, 'diego', 'glv'), undefined);
    assert.ok(back > 300 * 0.995 && back < 300 * 1.005, `diego got back ${back}`);
    assert.ok(matched(s), JSON.stringify(s.checks));
});

test('claim shares simulated ARB with holders only', async () => {
    // Maya holds nothing in a Morpho vault now; Diego and Priya hold Gauntlet.
    await new Promise((r) => setTimeout(r, 5000));
    await stack.publishRewards();
    await until('rewards to be claimable', (s) => Number(s.rewards.claimable) > 0);

    const arbBefore = await stack.client.readContract({
        address: ARB_TOKEN,
        abi: erc20Abi,
        functionName: 'balanceOf',
        args: [stack.omnibus],
    });

    await ok({ action: 'claim' });

    const s = await until(
        'the claim to be shared',
        (s) => Number(s.rewards.allocated) > 0 && s,
    );
    const arbAfter = await stack.client.readContract({
        address: ARB_TOKEN,
        abi: erc20Abi,
        functionName: 'balanceOf',
        args: [stack.omnibus],
    });
    const arb = (id: string) => Number(customer(s, id).arbRewards);

    assert.ok(arbAfter > arbBefore, 'ARB reached the omnibus wallet');
    // Maya held Steakhouse alone for a while, so she gets its rewards.
    assert.ok(arb('maya') > 0);
    // Diego and Priya held Gauntlet over the same time, 200 against 300.
    assert.ok(arb('diego') > 0);
    assert.ok(arb('priya') > arb('diego'));
    assert.ok(matched(s), JSON.stringify(s.checks));
});
