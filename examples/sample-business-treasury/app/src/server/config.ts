import 'server-only';

import { PAXOS_ENV } from '@arbitrum-usdg/paxos-client';
import { toUnits, type UsdgNetwork } from '@arbitrum-usdg/usdg';
import type { Address, Hex } from 'viem';
import { privateKeyToAccount } from 'viem/accounts';

import type { Band } from './policy.ts';

export type Mode = 'mock' | 'sandbox' | 'production';

export type Config = {
    mode: Mode;
    network: UsdgNetwork;
    rpcUrl: string;
    privateKey: Hex;
    wallet: Address;
    paxos: {
        apiUrl: string;
        oauthUrl: string;
        clientId: string;
        clientSecret: string;
        optionalScopes: boolean;
        profileId: string;
        bankAccountId?: string;
        identityId?: string;
        institutionName: string;
    };
    policy: Band;
    demoWireAmount: string;
    webhookApiKey: string;
};

function required(env: NodeJS.ProcessEnv, name: string): string {
    const value = env[name]?.trim();

    if (!value) {
        throw new Error(
            `Missing ${name}. Copy examples/sample-business-treasury/app/.env.example to .env and fill it in.`,
        );
    }

    return value;
}

// Reads and validates the environment once, with a readable message for
// anything missing.
export function loadConfig(env: NodeJS.ProcessEnv = process.env): Config {
    const mode = (env.MODE ?? 'mock') as Mode;

    if (!['mock', 'sandbox', 'production'].includes(mode)) {
        throw new Error(`MODE must be mock, sandbox, or production, not "${mode}"`);
    }

    const key = required(env, 'TREASURY_PRIVATE_KEY');
    // Wallet exports often omit the 0x prefix, so accept both forms.
    const privateKey = (key.startsWith('0x') ? key : `0x${key}`) as Hex;
    const paxosEnv = mode === 'production' ? PAXOS_ENV.production : PAXOS_ENV.sandbox;
    const policy = {
        min: toUnits(env.POLICY_MIN ?? '1000'),
        target: toUnits(env.POLICY_TARGET ?? '5000'),
        max: toUnits(env.POLICY_MAX ?? '10000'),
    };

    if (!(policy.min < policy.target && policy.target < policy.max)) {
        throw new Error(
            'POLICY_MIN, POLICY_TARGET, and POLICY_MAX must increase in that order',
        );
    }

    return {
        mode,
        network: mode === 'sandbox' ? 'arbitrumSepolia' : 'arbitrumOne',
        rpcUrl: required(env, 'RPC_URL'),
        privateKey,
        wallet: privateKeyToAccount(privateKey).address,
        paxos: {
            apiUrl:
                mode === 'mock'
                    ? `${required(env, 'MOCK_PAXOS_URL')}/v2`
                    : paxosEnv.api,
            oauthUrl:
                mode === 'mock'
                    ? `${required(env, 'MOCK_PAXOS_URL')}/oauth2/token`
                    : paxosEnv.oauth,
            clientId: required(env, 'PAXOS_CLIENT_ID'),
            clientSecret: required(env, 'PAXOS_CLIENT_SECRET'),
            optionalScopes: env.PAXOS_OPTIONAL_SCOPES === '1',
            profileId: required(env, 'PAXOS_PROFILE_ID'),
            bankAccountId: env.PAXOS_BANK_ACCOUNT_ID?.trim() || undefined,
            identityId: env.PAXOS_IDENTITY_ID?.trim() || undefined,
            institutionName: env.PAXOS_INSTITUTION_NAME?.trim() || 'Company',
        },
        policy,
        demoWireAmount: env.DEMO_WIRE_AMOUNT ?? '2500.00',
        webhookApiKey: env.WEBHOOK_API_KEY ?? '',
    };
}
