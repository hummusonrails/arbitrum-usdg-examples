// Runs each Paxos call the treasury app depends on against the sandbox,
// prints PASS or FAIL per check, and saves sanitized responses as fixtures
// for the local mock server.
import { mkdir, writeFile } from 'node:fs/promises';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

import {
    PAXOS_ENV,
    PAXOS_SCOPES,
    createPaxosClient,
    type PaxosClient,
} from '@arbitrum-usdg/paxos-client';
import { USDG, usdgAbi } from '@arbitrum-usdg/usdg';
import {
    createPublicClient,
    createWalletClient,
    http,
    parseEventLogs,
    type Hex,
} from 'viem';
import { privateKeyToAccount } from 'viem/accounts';

const FIXTURES = join(
    dirname(fileURLToPath(import.meta.url)),
    '../../mock-paxos/fixtures',
);

function env(name: string): string {
    const value = process.env[name];

    if (!value) {
        throw new Error(`Set ${name} in examples/sample-business-treasury/app/.env`);
    }

    return value;
}

const network = USDG.arbitrumSepolia;
const account = privateKeyToAccount(env('TREASURY_PRIVATE_KEY') as Hex);
const rpc = http(process.env.RPC_URL ?? 'https://sepolia-rollup.arbitrum.io/rpc');
const chain = createPublicClient({ chain: network.chain, transport: rpc });
const wallet = createWalletClient({ account, chain: network.chain, transport: rpc });
const profileId = env('PAXOS_PROFILE_ID');
const paxos: PaxosClient = createPaxosClient({
    apiUrl: PAXOS_ENV.sandbox.api,
    oauthUrl: PAXOS_ENV.sandbox.oauth,
    clientId: env('PAXOS_CLIENT_ID'),
    clientSecret: env('PAXOS_CLIENT_SECRET'),
    scopes: PAXOS_SCOPES,
});

const UUID = /[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}/gi;

// Replaces ids, addresses, hashes and emails with stable placeholders so the
// fixtures keep their shape without carrying account data.
function sanitize(value: unknown): unknown {
    const seen = new Map<string, string>();
    const text = JSON.stringify(value)
        .replace(UUID, (m) => {
            if (!seen.has(m)) {
                seen.set(
                    m,
                    `00000000-0000-4000-8000-${String(seen.size + 1).padStart(12, '0')}`,
                );
            }

            return seen.get(m)!;
        })
        .replace(/0x[0-9a-fA-F]{64}/g, `0x${'ab'.repeat(32)}`)
        .replace(/0x[0-9a-fA-F]{40}/g, `0x${'cd'.repeat(20)}`)
        .replace(/[\w.+-]+@[\w-]+\.[\w.]+/g, 'treasury@example.com');

    return JSON.parse(text);
}

async function save(name: string, value: unknown) {
    await mkdir(FIXTURES, { recursive: true });
    await writeFile(
        join(FIXTURES, `${name}.json`),
        `${JSON.stringify(sanitize(value), null, 4)}\n`,
    );
}

let failures = 0;

async function check<T>(name: string, run: () => Promise<T>): Promise<T | undefined> {
    try {
        const result = await run();

        console.log(`PASS  ${name}`);

        return result;
    } catch (err) {
        failures += 1;
        console.log(`FAIL  ${name}`);
        console.log(err instanceof Error ? err.message : err);

        return undefined;
    }
}

async function until<T>(
    what: string,
    read: () => Promise<T | undefined>,
    ms = 300_000,
): Promise<T> {
    const end = Date.now() + ms;

    while (Date.now() < end) {
        const value = await read();

        if (value !== undefined) {
            return value;
        }

        await new Promise((r) => setTimeout(r, 5_000));
    }

    throw new Error(`Timed out waiting for ${what}`);
}

const runId = Date.now();
const eventTypes = new Set<string>();

await check('authenticate and list profiles', async () => {
    const profiles = await paxos.listProfiles();

    await save('ListProfiles', profiles);
    await save('ListProfileBalances', await paxos.listProfileBalances(profileId));
});

await check('register the treasury wallet as an ARBITRUM_ONE destination', async () => {
    const res = await paxos.putCryptoDestinationAddress({
        crypto_network: 'ARBITRUM_ONE',
        address: account.address,
        nickname: 'Treasury wallet',
    });

    await save('PutCryptoDestinationAddress', res);
});

await check('mint 1 USDG from the profile to the wallet on ARBITRUM_ONE', async () => {
    const created = await paxos.createOrchestration({
        ref_id: `probe-mint-${runId}`,
        source_asset: 'USD',
        source_amount: '1',
        destination_asset: 'USDG',
        source: { profile: { profile_id: profileId } },
        destination: { crypto: { address: account.address, network: 'ARBITRUM_ONE' } },
    });

    await save('CreateOrchestration', created);

    const done = await until('mint orchestration', async () => {
        const o = await paxos.getOrchestration(created.id!);

        return ['COMPLETED', 'FAILED', 'REJECTED'].includes(o.status ?? '')
            ? o
            : undefined;
    });

    await save('GetOrchestration.completed', done);

    if (done.status !== 'COMPLETED') {
        throw new Error(
            `Mint ended ${done.status}: ${JSON.stringify(done.fail_reason)}`,
        );
    }

    const transfer = await paxos.getTransfer(done.destination_transfer!.transfer_id!);

    await save('GetTransfer.crypto_withdrawal', transfer);

    const receipt = await chain.getTransactionReceipt({
        hash: transfer.crypto_tx_hash as Hex,
    });
    const logs = parseEventLogs({
        abi: usdgAbi,
        logs: receipt.logs,
        eventName: 'Transfer',
    });

    if (!logs.some((l) => l.args.to.toLowerCase() === account.address.toLowerCase())) {
        throw new Error(
            'No USDG Transfer to the treasury wallet in the withdrawal transaction',
        );
    }
});

await check('deposit 1 USDG to an ARBITRUM_ONE deposit address', async () => {
    const existing = await paxos.listDepositAddresses({});
    const found = existing.items?.find((a) => a.crypto_network === 'ARBITRUM_ONE');
    const address =
        found ??
        (await paxos.createDepositAddress({
            profile_id: profileId,
            crypto_network: 'ARBITRUM_ONE',
            ref_id: `probe-deposit-address-${runId}`,
        }));

    await save('CreateDepositAddress', address);

    const since = new Date().toISOString();
    const hash = await wallet.writeContract({
        address: network.address,
        abi: usdgAbi,
        functionName: 'transfer',
        args: [address.address as Hex, 1_000_000n],
    });

    await chain.waitForTransactionReceipt({ hash });

    const event = await until('transfer.crypto_deposit.completed', async () => {
        const { events } = await paxos.listEvents({
            'created_at.gte': since,
            limit: 100,
        });

        return events?.find((e) => e.type === 'transfer.crypto_deposit.completed');
    });

    await save('ListEvents', { events: [event] });
});

const rule = await check(
    'create a WIRE to USDG rule delivering to ARBITRUM_ONE',
    async () => {
        const rules = await paxos.listOrchestrationRules({});
        const reuse = rules.rules?.find(
            (r) =>
                r.destination?.crypto?.network === 'ARBITRUM_ONE' &&
                r.destination_asset === 'USDG',
        );
        const res =
            reuse ??
            (
                await paxos.createOrchestrationRule({
                    ref_id: `probe-rule-${runId}`,
                    nickname: 'Auto mint USDG to the treasury wallet',
                    profile_id: profileId,
                    source_asset: 'USD',
                    destination_asset: 'USDG',
                    source: { fiat: { network: 'WIRE', account_type: 'ABA' } },
                    destination: {
                        crypto: { address: account.address, network: 'ARBITRUM_ONE' },
                    },
                })
            ).rule;

        await save('CreateOrchestrationRule', { rule: res });

        return res;
    },
);

await check('simulate a sandbox wire deposit that triggers the rule', async () => {
    const memo = rule?.source?.fiat?.memo_id;

    if (!memo) {
        throw new Error('The rule response carried no memo_id');
    }

    await save(
        'ListFiatDepositInstructions',
        await paxos.listFiatDepositInstructions({}),
    );
    await paxos.initiateSandboxFiatDeposit({
        amount: '2.00',
        asset: 'USD',
        memo_id: memo,
        fiat_network_instructions: {
            wire: {
                account_number: '12345678',
                fiat_account_owner_address: {
                    country: 'USA',
                    address1: '456 Main Street',
                    city: 'New York',
                    province: 'NY',
                    zip_code: '10101',
                },
                routing_details: {
                    routing_number_type: 'ABA',
                    routing_number: '123456789',
                    bank_name: 'Customers Bank',
                    bank_address: {
                        country: 'USA',
                        address1: '123 Bank Street',
                        city: 'New York',
                        province: 'NY',
                        zip_code: '10101',
                    },
                },
            },
        },
        fiat_account_owner: { institution_details: { name: 'Example Treasury, Inc.' } },
    });

    const fired = await until('rule orchestration', async () => {
        const list = await paxos.listOrchestrations({ limit: 20 });

        return list.items?.find((o) => o.orchestration_rule_id === rule?.id);
    });

    await save('GetOrchestration.rule', fired);
});

await check('fetch each event type seen', async () => {
    const { events } = await paxos.listEvents({ limit: 100, order: 'DESC' });

    for (const e of events ?? []) {
        if (e.type && !eventTypes.has(e.type)) {
            eventTypes.add(e.type);
            await save(`GetEvent.${e.type}`, await paxos.getEvent(e.id!));
        }
    }

    console.log(`      event types: ${[...eventTypes].join(', ')}`);
});

console.log(failures ? `\n${failures} check(s) failed` : '\nAll checks passed');
process.exit(failures ? 1 : 0);
