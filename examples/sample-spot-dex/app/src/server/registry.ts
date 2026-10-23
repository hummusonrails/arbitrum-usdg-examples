import type { Address } from 'viem';

// Tokens and price feeds on Arbitrum One, checked on chain by `pnpm probe`.
export const WETH: Address = '0x82aF49447D8a07e3bd95BD0d56f35241523fBab1';
export const ARB: Address = '0x912CE59144191C1204E64559FE8253a0e49E6548';

export type PoolId = 'weth' | 'arb';

export const POOL_IDS: PoolId[] = ['weth', 'arb'];

export type PoolDef = {
    id: PoolId;
    pair: string;
    lpName: string;
    lpSymbol: string;
    base: { symbol: 'WETH' | 'ARB'; address: Address; decimals: 18 };
    // Chainlink USD feed (8 decimals), used once to seed the pool at a fair price.
    feed: Address;
    // How much base token the operator seeds the pool with on the fork.
    seedBase: bigint;
};

export const POOLS: Record<PoolId, PoolDef> = {
    weth: {
        id: 'weth',
        pair: 'WETH/USDG',
        lpName: 'Acme Swap LP WETH/USDG',
        lpSymbol: 'ASLP-WETH',
        base: { symbol: 'WETH', address: WETH, decimals: 18 },
        feed: '0x639Fe6ab55C921f74e7fac1ee960C0B6293ba612',
        seedBase: 20n * 10n ** 18n,
    },
    arb: {
        id: 'arb',
        pair: 'ARB/USDG',
        lpName: 'Acme Swap LP ARB/USDG',
        lpSymbol: 'ASLP-ARB',
        base: { symbol: 'ARB', address: ARB, decimals: 18 },
        feed: '0xb2A824043730FE05F3DA2efaFa1CBbe83fa548D6',
        seedBase: 100_000n * 10n ** 18n,
    },
};

// Plain accounts that hold enough of each token on mainnet to fund the demo on
// a fork. Holders change, so each list has a backup.
export const FORK_HOLDERS = {
    usdgArbitrum: [
        '0x264bd8291fae1d75db2c5f573b07faa6715997b5',
        '0x1887fa9edadeab7562b01cc3f4fa246ace2c3cdd',
    ],
    usdgEthereum: [
        '0xaf698519e1f304f2fbbe0539401672ab15650e9e',
        '0xfaa4ca60886f7bec2ac98746ea51d4647d94197c',
    ],
    arb: [
        '0x361ad597f6a0cf86f8ab14234ca17a5739a67458',
        '0xb38e8c17e38363af6ebdcb3dae12e0243582891d',
    ],
} satisfies Record<string, Address[]>;

export const chainlinkAbi = [
    {
        type: 'function',
        name: 'latestRoundData',
        stateMutability: 'view',
        inputs: [],
        outputs: [
            { name: 'roundId', type: 'uint80' },
            { name: 'answer', type: 'int256' },
            { name: 'startedAt', type: 'uint256' },
            { name: 'updatedAt', type: 'uint256' },
            { name: 'answeredInRound', type: 'uint80' },
        ],
    },
] as const;

export const wethAbi = [
    {
        type: 'function',
        name: 'deposit',
        stateMutability: 'payable',
        inputs: [],
        outputs: [],
    },
] as const;
