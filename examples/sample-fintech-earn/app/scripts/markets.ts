// Prints the live vault data the app shows, for checking the data sources.
import { generatePrivateKey } from 'viem/accounts';

import { loadConfig } from '../src/server/config.ts';
import { readMarkets } from '../src/server/market.ts';

const config = loadConfig({
    MODE: 'mainnet',
    OMNIBUS_PRIVATE_KEY: generatePrivateKey(),
    RPC_URL: 'https://arb1.arbitrum.io/rpc',
    ...process.env,
});

console.log(
    JSON.stringify(
        await readMarkets(config),
        (_, v) => (typeof v === 'bigint' ? v.toString() : v),
        2,
    ),
);
