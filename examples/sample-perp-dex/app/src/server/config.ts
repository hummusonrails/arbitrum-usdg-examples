import type { Address, Hex } from 'viem';

import { WALLET_IDS, type WalletId } from './wallets.ts';

// The app runs against a local fork of Arbitrum One started by `pnpm dev:fork`,
// which deploys the vault and the oracle and writes every value below.
export type Config = {
    rpcUrl: string;
    operatorKey: Hex;
    keeperKey: Hex;
    walletKeys: Record<WalletId, Hex>;
    vault: Address;
    oracle: Address;
    payoutGroupId: number;
    dbPath: string;
    loopMs: number;
};

function required(env: NodeJS.ProcessEnv, name: string): string {
    const value = env[name]?.trim();

    if (!value) {
        throw new Error(
            `Missing ${name}. Run pnpm dev:fork, which starts the fork, deploys the vault, and sets it.`,
        );
    }

    return value;
}

// Reads and validates the environment once, with a readable message for
// anything missing.
export function loadConfig(env: NodeJS.ProcessEnv = process.env): Config {
    const keys = JSON.parse(required(env, 'WALLET_KEYS')) as Record<string, Hex>;

    for (const id of WALLET_IDS) {
        if (!keys[id]) {
            throw new Error(`WALLET_KEYS has no key for ${id}`);
        }
    }

    return {
        rpcUrl: required(env, 'RPC_URL'),
        operatorKey: required(env, 'OPERATOR_PRIVATE_KEY') as Hex,
        keeperKey: required(env, 'KEEPER_PRIVATE_KEY') as Hex,
        walletKeys: keys as Record<WalletId, Hex>,
        vault: required(env, 'VAULT_ADDRESS') as Address,
        oracle: required(env, 'ORACLE_ADDRESS') as Address,
        payoutGroupId: Number(required(env, 'PAYOUT_GROUP_ID')),
        dbPath: env.DB_PATH ?? 'perp.db',
        loopMs: Number(env.LOOP_INTERVAL_MS ?? 3000),
    };
}
