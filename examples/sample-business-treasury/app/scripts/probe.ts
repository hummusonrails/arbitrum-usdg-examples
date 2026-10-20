// Runs each Paxos call the treasury app depends on against the sandbox,
// prints the result of each check, and saves sanitized responses as fixtures
// for the local mock server.
import { mkdir, writeFile } from 'node:fs/promises';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

import {
    PAXOS_ENV,
    PaxosApiError,
    createPaxosClient,
    scopesFor,
    type PaxosClient,
    type Transfer,
} from '@arbitrum-usdg/paxos-client';
import { USDG, usdgAbi } from '@arbitrum-usdg/usdg';
import {
    createPublicClient,
    createWalletClient,
    http,
    isAddress,
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
// Wallet exports often omit the 0x prefix, so accept both forms.
const key = env('TREASURY_PRIVATE_KEY').trim();
const account = privateKeyToAccount((key.startsWith('0x') ? key : `0x${key}`) as Hex);
const rpc = http(process.env.RPC_URL ?? 'https://sepolia-rollup.arbitrum.io/rpc');
const chain = createPublicClient({ chain: network.chain, transport: rpc });
const wallet = createWalletClient({ account, chain: network.chain, transport: rpc });
const profileId = env('PAXOS_PROFILE_ID');

function client(optional: boolean): PaxosClient {
    return createPaxosClient({
        apiUrl: PAXOS_ENV.sandbox.api,
        oauthUrl: PAXOS_ENV.sandbox.oauth,
        clientId: env('PAXOS_CLIENT_ID'),
        clientSecret: env('PAXOS_CLIENT_SECRET'),
        scopes: scopesFor({ optional }),
    });
}

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
        console.log(`      ${err instanceof Error ? err.message : String(err)}`);

        return undefined;
    }
}

function note(text: string) {
    console.log(`      ${text}`);
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

function describeTransfer(t: Transfer): string {
    const reason = t.secondary_status?.name ?? Object.keys(t.status_details ?? {})[0] ?? '';

    return `${t.type} ${t.status}${reason ? ` (${reason})` : ''} hash=${t.crypto_tx_hash || 'none'}`;
}

const runId = Date.now();

// Optional scopes cover steps Paxos enables per organization. Fall back to the
// core scopes when the credential does not carry them.
let paxos = client(true);
let optional = true;

await check('authenticate and list profiles', async () => {
    try {
        await paxos.listProfiles();
    } catch {
        optional = false;
        paxos = client(false);
    }

    note(`optional scopes ${optional ? 'granted' : 'not granted on this credential'}`);
    await save('ListProfiles', await paxos.listProfiles());
    await save('ListProfileBalances', await paxos.listProfileBalances(profileId));
});

await check('register the treasury wallet with travel rule details', async () => {
    const res = await paxos.putCryptoDestinationAddress({
        crypto_network: 'ARBITRUM_ONE',
        address: account.address,
        nickname: 'Treasury wallet',
        bookmarked_status: true,
        travelrule_metadata: { beneficiary: { self: true }, custodian_type: 'PRIVATE' },
    });

    note(`destination status ${res.address?.status ?? 'unknown'}`);
    await save('PutCryptoDestinationAddress', res);
});

await check('verify ownership of the treasury wallet', async () => {
    if (!optional) {
        note('skipped: needs address ownership scopes on the credential');

        return;
    }

    const created = await paxos.createAddressVerification({
        network: 'ARBITRUM_ONE',
        address: account.address,
        verification_method: 'SIGNATURE',
        ref_id: `probe-verify-${runId}`,
    });
    const message = created.signature_verification?.message;

    if (!message) {
        throw new Error(`No message to sign: ${JSON.stringify(created)}`);
    }

    const signature = await account.signMessage({ message });
    const submitted = await paxos.submitAddressVerificationSignature({
        id: created.id!,
        signature,
    });

    note(`verification status ${submitted.status ?? 'unknown'}`);
    await save('CreateVerification', created);
});

await check('mint 1 USDG from the profile to the wallet on ARBITRUM_ONE', async () => {
    const before = await chain.readContract({
        address: network.address,
        abi: usdgAbi,
        functionName: 'balanceOf',
        args: [account.address],
    });
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

        return ['COMPLETED', 'FAILED', 'REJECTED'].includes(o.status ?? '') ? o : undefined;
    });

    await save('GetOrchestration.mint', done);
    note(`orchestration ${done.status}`);

    const transferId = done.destination_transfer?.transfer_id;

    if (!transferId) {
        throw new Error(`No destination transfer: ${JSON.stringify(done.fail_reason)}`);
    }

    const transfer = await until('withdrawal to settle', async () => {
        const t = await paxos.getTransfer(transferId);

        return t.status === 'PENDING' ? undefined : t;
    });

    await save('GetTransfer.crypto_withdrawal', transfer);
    note(describeTransfer(transfer));

    if (transfer.status !== 'COMPLETED' || !transfer.crypto_tx_hash) {
        throw new Error('The withdrawal did not reach the chain');
    }

    const receipt = await chain.getTransactionReceipt({
        hash: transfer.crypto_tx_hash as Hex,
    });
    const logs = parseEventLogs({ abi: usdgAbi, logs: receipt.logs, eventName: 'Transfer' });
    const after = await chain.readContract({
        address: network.address,
        abi: usdgAbi,
        functionName: 'balanceOf',
        args: [account.address],
    });

    note(`wallet USDG ${before} -> ${after}`);

    if (!logs.some((l) => l.args.to.toLowerCase() === account.address.toLowerCase())) {
        throw new Error('No USDG Transfer to the treasury wallet in the withdrawal');
    }
});

await check('deposit 1 USDG to an ARBITRUM_ONE deposit address', async () => {
    const existing = await paxos.listDepositAddresses({});
    const found = existing.items?.find(
        (a) =>
            a.crypto_network === 'ARBITRUM_ONE' &&
            isAddress(a.address ?? '') &&
            (a.conversion_target_asset ?? 'NO_CONVERSION') === 'NO_CONVERSION',
    );
    const address =
        found ??
        (await paxos.createDepositAddress({
            profile_id: profileId,
            crypto_network: 'ARBITRUM_ONE',
            conversion_target_asset: 'NO_CONVERSION',
            ref_id: `probe-deposit-address-${runId}`,
        }));

    await save('CreateDepositAddress', address);

    const hash = await wallet.writeContract({
        address: network.address,
        abi: usdgAbi,
        functionName: 'transfer',
        args: [address.address as Hex, 1_000_000n],
    });

    await chain.waitForTransactionReceipt({ hash });
    note(`sent on chain ${hash}`);

    const deposit = await until('the deposit to appear', async () => {
        const list = await paxos.listTransfers({ crypto_tx_hashes: [hash] });

        return list.items?.[0];
    });

    note(describeTransfer(deposit));

    if (deposit.secondary_status?.name === 'TRAVEL_RULE_INFO_REQUESTED') {
        await save('GetTransfer.crypto_deposit.travel_rule', deposit);

        if (!optional) {
            throw new Error('Deposit is held for travel rule info and the update scope is missing');
        }

        try {
            await paxos.updateCryptoDeposit(deposit.id!, {
                identity_id: process.env.PAXOS_IDENTITY_ID ?? deposit.identity_id!,
                originator_address_info: {
                    institution_info: {
                        institution_name: process.env.PAXOS_INSTITUTION_NAME ?? 'Company',
                    },
                },
            });
        } catch (err) {
            if (!(err instanceof PaxosApiError && err.status === 409)) {
                throw err;
            }
        }

        note('answered the travel rule request');
    }

    const settled = await until('the deposit to complete', async () => {
        const t = await paxos.getTransfer(deposit.id!);

        return t.status === 'PENDING' ? undefined : t;
    });

    await save('GetTransfer.crypto_deposit', settled);
    note(describeTransfer(settled));

    if (settled.status !== 'COMPLETED') {
        throw new Error('The deposit did not complete');
    }
});

const rule = await check('create a WIRE to USDG rule delivering to ARBITRUM_ONE', async () => {
    const rules = await paxos.listOrchestrationRules({});
    const reuse = rules.items?.find(
        (r) =>
            r.status === 'ACTIVE' &&
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

    note(`rule status ${res?.status}`);
    await save('CreateOrchestrationRule', { rule: res });

    return res;
});

await check('simulate a sandbox wire deposit that triggers the rule', async () => {
    const memo = rule?.source?.fiat?.memo_id;

    if (!memo) {
        throw new Error('The rule response carried no memo_id');
    }

    await save('ListFiatDepositInstructions', await paxos.listFiatDepositInstructions({}));

    const bank = {
        country: 'USA',
        address1: '123 Bank Street',
        city: 'New York',
        province: 'NY',
        zip_code: '10101',
    };

    await paxos.initiateSandboxFiatDeposit({
        amount: '500.00',
        asset: 'USD',
        memo_id: memo,
        fiat_network_instructions: {
            wire: {
                account_number: '74600021314512',
                fiat_account_owner_address: { ...bank, address1: '456 Main Street' },
                routing_details: {
                    routing_number_type: 'ABA',
                    routing_number: '031302971',
                    bank_name: 'Customers Bank',
                    bank_address: bank,
                },
            },
        },
        fiat_account_owner: { institution_details: { name: 'Company' } },
    });

    const fired = await until('the rule to start a mint', async () => {
        const list = await paxos.listOrchestrations({ limit: 20 });

        return list.items?.find(
            (o) => o.orchestration_rule_id === rule?.id && o.source_amount !== '2',
        );
    });

    note(`rule mint ${fired.status} for ${fired.source_amount} USD`);
    await save('GetOrchestration.rule', fired);
});

await check('fetch each event type seen', async () => {
    const seen = new Set<string>();
    const { events } = await paxos.listEvents({ limit: 100, order: 'DESC' });

    for (const e of events ?? []) {
        if (e.type && !seen.has(e.type)) {
            seen.add(e.type);
            await save(`GetEvent.${e.type}`, await paxos.getEvent(e.id!));
        }
    }

    note(`event types: ${[...seen].join(', ')}`);
});

console.log(failures ? `\n${failures} check(s) failed` : '\nAll checks passed');
process.exit(failures ? 1 : 0);
