// Prepares a Paxos account and the treasury wallet for the app: registers the
// wallet, proves ownership of it, creates the Arbitrum deposit address and the
// auto mint rule, and checks the bank account. Safe to run more than once.
import { PaxosApiError } from '@arbitrum-usdg/paxos-client';
import { isAddress } from 'viem';
import { privateKeyToAccount } from 'viem/accounts';

import { createCtx } from '../src/server/context.ts';
import { getKv, setKv } from '../src/server/db.ts';
import { SANDBOX_BANK_ACCOUNT } from '../src/server/wire.ts';

const ctx = createCtx();
const { config, db, paxos } = ctx;
const account = privateKeyToAccount(config.privateKey);
const todo: string[] = [];

function line(status: 'ok' | 'todo' | 'skip', text: string) {
    console.log(
        `${status === 'ok' ? 'OK  ' : status === 'todo' ? 'TODO' : 'SKIP'}  ${text}`,
    );
}

function message(err: unknown) {
    return err instanceof PaxosApiError
        ? `${err.status} ${JSON.stringify(err.body)}`
        : String(err);
}

console.log(`Treasury wallet ${account.address} (${config.mode} mode)\n`);

// 1. Register the treasury wallet as a destination the business owns.
try {
    const res = await paxos.putCryptoDestinationAddress({
        crypto_network: 'ARBITRUM_ONE',
        address: account.address,
        nickname: 'Treasury wallet',
        bookmarked_status: true,
        travelrule_metadata: { beneficiary: { self: true }, custodian_type: 'PRIVATE' },
    });

    line('ok', `Treasury wallet registered (${res.address?.status ?? 'submitted'})`);
} catch (err) {
    line('todo', `Register the treasury wallet: ${message(err)}`);
    todo.push('Check the API credential scopes and the IP allowlist.');
}

// 2. Prove the business controls the wallet by signing a Paxos message.
if (config.paxos.optionalScopes) {
    try {
        const created = await paxos.createAddressVerification({
            network: 'ARBITRUM_ONE',
            address: account.address,
            verification_method: 'SIGNATURE',
            ref_id: `treasury-verify-${Date.now()}`,
        });
        const signature = await account.signMessage({
            message: created.signature_verification!.message!,
        });
        const submitted = await paxos.submitAddressVerificationSignature({
            id: created.id!,
            signature,
        });

        line('ok', `Wallet ownership verified (${submitted.status ?? 'submitted'})`);
    } catch (err) {
        line('skip', `Wallet ownership verification: ${message(err)}`);
    }
} else {
    line('skip', 'Wallet ownership verification needs PAXOS_OPTIONAL_SCOPES=1');
}

// 3. A Paxos deposit address on Arbitrum, where redeems send USDG.
try {
    const existing = getKv(db, 'deposit_address');
    const listed = await paxos.listDepositAddresses({});
    const found = listed.items?.find(
        (a) =>
            a.crypto_network === 'ARBITRUM_ONE' &&
            isAddress(a.address ?? '') &&
            (a.conversion_target_asset ?? 'NO_CONVERSION') === 'NO_CONVERSION' &&
            (!existing || a.address === existing),
    );
    const address =
        found ??
        (await paxos.createDepositAddress({
            profile_id: config.paxos.profileId,
            crypto_network: 'ARBITRUM_ONE',
            conversion_target_asset: 'NO_CONVERSION',
            ref_id: `treasury-deposit-address-${Date.now()}`,
        }));

    setKv(db, 'deposit_address', address.address!);
    line('ok', `Deposit address ${address.address}`);
} catch (err) {
    line('todo', `Create the Arbitrum deposit address: ${message(err)}`);
}

// 4. The auto mint rule: USD wired to Paxos becomes USDG in the wallet.
try {
    const rules = await paxos.listOrchestrationRules({});
    const found = rules.items?.find(
        (r) =>
            r.status === 'ACTIVE' &&
            r.destination_asset === 'USDG' &&
            r.destination?.crypto?.network === 'ARBITRUM_ONE' &&
            r.destination.crypto.address?.toLowerCase() ===
                account.address.toLowerCase(),
    );
    const rule =
        found ??
        (
            await paxos.createOrchestrationRule({
                ref_id: `treasury-auto-mint-${Date.now()}`,
                nickname: 'Auto mint USDG to the treasury wallet',
                profile_id: config.paxos.profileId,
                source_asset: 'USD',
                destination_asset: 'USDG',
                source: { fiat: { network: 'WIRE', account_type: 'ABA' } },
                destination: {
                    crypto: { address: account.address, network: 'ARBITRUM_ONE' },
                },
            })
        ).rule;

    setKv(db, 'rule_id', rule!.id!);
    setKv(db, 'rule_memo_id', rule!.source!.fiat!.memo_id!);
    line(
        'ok',
        `Auto mint rule ${rule!.status} (wire memo ${rule!.source!.fiat!.memo_id})`,
    );
} catch (err) {
    line('todo', `Create the auto mint rule: ${message(err)}`);
}

// 5. The bank account redeems pay out to.
try {
    let id = config.paxos.bankAccountId ?? getKv(db, 'bank_account_id');

    if (!id && config.mode !== 'production') {
        const created = await paxos.createFiatAccount({
            ref_id: `treasury-bank-${Date.now()}`,
            ...SANDBOX_BANK_ACCOUNT,
        });

        id = created.id!;
    }

    if (!id) {
        line('todo', 'Set PAXOS_BANK_ACCOUNT_ID to an approved bank account');
    } else {
        const bank = await paxos.getFiatAccount(id);

        setKv(db, 'bank_account_id', id);
        line(
            bank.status === 'APPROVED' ? 'ok' : 'todo',
            `Bank account ${id} is ${bank.status}`,
        );
    }
} catch (err) {
    line('todo', `Bank account: ${message(err)}`);
}

if (process.env.POLICY_START_PAUSED === '1') {
    setKv(db, 'policy_paused', '1');
}

if (config.mode !== 'mock') {
    todo.push(
        'In the Paxos Dashboard, add a webhook to https://<your host>/api/webhooks/paxos with header x-api-key set to WEBHOOK_API_KEY. Without one, the app polls for events every few seconds.',
    );
}

for (const t of todo) {
    console.log(`\nNext: ${t}`);
}
