import type { Address, Hex } from 'viem';
import { privateKeyToAccount } from 'viem/accounts';

// fork: a local Anvil fork of Arbitrum One with a GLV keeper and a Merkl
// rewards stand in, started by `pnpm dev:fork`. mainnet: real Arbitrum One.
export type Mode = 'fork' | 'mainnet';

export type Config = {
    mode: Mode;
    rpcUrl: string;
    privateKey: Hex;
    omnibus: Address;
    dbPath: string;
    loopMs: number;
    merklApiUrl: string;
    morphoApiUrl: string;
    gmxApiUrl: string;
    // Fork mode only: how many simulated seconds of rewards accrue per real
    // second, so a short demo shows something.
    rewardsClockScale: number;
};

function required(env: NodeJS.ProcessEnv, name: string): string {
    const value = env[name]?.trim();

    if (!value) {
        throw new Error(
            `Missing ${name}. Copy examples/sample-fintech-earn/app/.env.example to .env and fill it in, or run pnpm dev:fork.`,
        );
    }

    return value;
}

// Reads and validates the environment once, with a readable message for
// anything missing.
export function loadConfig(env: NodeJS.ProcessEnv = process.env): Config {
    const mode = (env.MODE ?? 'mainnet') as Mode;

    if (!['fork', 'mainnet'].includes(mode)) {
        throw new Error(`MODE must be fork or mainnet, not "${mode}"`);
    }

    const key = required(env, 'OMNIBUS_PRIVATE_KEY');
    // Wallet exports often omit the 0x prefix, so accept both forms.
    const privateKey = (key.startsWith('0x') ? key : `0x${key}`) as Hex;

    return {
        mode,
        rpcUrl: required(env, 'RPC_URL'),
        privateKey,
        omnibus: privateKeyToAccount(privateKey).address,
        dbPath: env.DB_PATH ?? 'earn.db',
        loopMs: Number(env.LOOP_INTERVAL_MS ?? 5000),
        merklApiUrl: env.MERKL_API_URL ?? 'https://api.merkl.xyz',
        morphoApiUrl: env.MORPHO_API_URL ?? 'https://api.morpho.org',
        gmxApiUrl: env.GMX_API_URL ?? 'https://arbitrum-api.gmxinfra.io',
        rewardsClockScale: Number(env.REWARDS_CLOCK_SCALE ?? 1440),
    };
}
