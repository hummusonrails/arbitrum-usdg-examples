import type { Address, Hex } from 'viem';

import { POOL_IDS, type PoolId } from './registry.ts';
import { WALLET_IDS, type WalletId } from './wallets.ts';

// The app runs against local forks of Arbitrum One and Ethereum started by
// `pnpm dev:fork`, which deploys the pools and writes every value below.
export type Config = {
    rpcUrl: string;
    ethRpcUrl: string;
    operatorKey: Hex;
    walletKeys: Record<WalletId, Hex>;
    pools: Record<PoolId, Address>;
    payoutGroupId: number;
    dbPath: string;
    loopMs: number;
};

function required(env: NodeJS.ProcessEnv, name: string): string {
    const value = env[name]?.trim();

    if (!value) {
        throw new Error(
            `Missing ${name}. Run pnpm dev:fork, which starts the forks, deploys the pools, and sets it.`,
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

    const pools = Object.fromEntries(
        POOL_IDS.map((id) => [
            id,
            required(env, `POOL_${id.toUpperCase()}`) as Address,
        ]),
    ) as Record<PoolId, Address>;

    return {
        rpcUrl: required(env, 'RPC_URL'),
        ethRpcUrl: required(env, 'ETH_RPC_URL'),
        operatorKey: required(env, 'OPERATOR_PRIVATE_KEY') as Hex,
        walletKeys: keys as Record<WalletId, Hex>,
        pools,
        payoutGroupId: Number(required(env, 'PAYOUT_GROUP_ID')),
        dbPath: env.DB_PATH ?? 'dex.db',
        loopMs: Number(env.LOOP_INTERVAL_MS ?? 3000),
    };
}
