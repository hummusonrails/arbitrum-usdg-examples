import { forkClient, fundUsdg } from '@arbitrum-usdg/earn-fork-services';

import { createChain } from './chain.ts';
import { loadConfig } from './config.ts';
import type { Ctx } from './ctx.ts';
import { openDb } from './db.ts';
import { seedCustomers } from './ledger.ts';
import { readMarkets } from './market.ts';
import { createAdapters, FORK_USDG_HOLDER } from './vaults/index.ts';

// Builds everything the server needs from the environment.
export function createCtx(env: NodeJS.ProcessEnv = process.env): Ctx {
    const config = loadConfig(env);
    const db = openDb(config.dbPath);
    const chain = createChain(config);

    seedCustomers(db);

    return {
        config,
        db,
        chain,
        adapters: createAdapters(chain, config),
        markets: () => readMarkets(config),
        fundOmnibus:
            config.mode === 'fork'
                ? (units) =>
                      fundUsdg(
                          forkClient(config.rpcUrl),
                          FORK_USDG_HOLDER,
                          chain.omnibus,
                          units,
                      )
                : undefined,
    };
}
