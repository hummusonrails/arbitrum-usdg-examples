import { stringToHex, type Address, type Hex } from 'viem';

export type MarketId = 'eth' | 'btc';

export const MARKET_IDS: MarketId[] = ['eth', 'btc'];

export type MarketDef = {
    id: MarketId;
    name: string;
    symbol: string;
    // The market's key in the vault and the oracle: the name as bytes32.
    key: Hex;
    // Chainlink USD feed on Arbitrum One (8 decimals), checked on chain by
    // `pnpm probe`. On the fork it is the keeper's price source.
    feed: Address;
};

const market = (id: MarketId, name: string, symbol: string, feed: Address) =>
    ({
        id,
        name,
        symbol,
        key: stringToHex(name, { size: 32 }),
        feed,
    }) satisfies MarketDef;

export const MARKETS: Record<MarketId, MarketDef> = {
    eth: market('eth', 'ETH-USD', 'ETH', '0x639Fe6ab55C921f74e7fac1ee960C0B6293ba612'),
    btc: market('btc', 'BTC-USD', 'BTC', '0x6ce185860a4963106506C203335A2910413708e9'),
};

export function marketByKey(key: Hex): MarketDef | undefined {
    return Object.values(MARKETS).find((m) => m.key === key);
}

export const LEVERAGES = [2, 5, 10] as const;
export const PRICE_DECIMALS = 8;
// The oracle refuses prices older than this, and the keeper pushes well before.
export const ORACLE_MAX_AGE_S = 120;

// Plain accounts that hold enough USDG on Arbitrum One to fund the demo on a
// fork. Holders change, so the list has a backup.
export const FORK_HOLDERS: Address[] = [
    '0x264bd8291fae1d75db2c5f573b07faa6715997b5',
    '0x1887fa9edadeab7562b01cc3f4fa246ace2c3cdd',
];

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
    {
        type: 'function',
        name: 'description',
        stateMutability: 'view',
        inputs: [],
        outputs: [{ type: 'string' }],
    },
] as const;
