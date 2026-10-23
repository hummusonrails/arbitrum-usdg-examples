import { createChains } from './chain.ts';
import { loadConfig } from './config.ts';
import type { Ctx } from './ctx.ts';
import { getKv, openDb, setKv } from './db.ts';

// Builds everything the server needs from the environment.
export async function createCtx(env: NodeJS.ProcessEnv = process.env): Promise<Ctx> {
    const config = loadConfig(env);
    const db = openDb(config.dbPath);
    const chains = createChains(config);

    // Transfers are read from logs since the first boot on these forks, so a
    // restart still finds every transfer sent before it.
    for (const network of ['arbitrum', 'ethereum'] as const) {
        if (!getKv(db, `start_block:${network}`)) {
            const block = await chains.clients[network].getBlockNumber();

            setKv(db, `start_block:${network}`, String(block));
        }
    }

    return { config, db, chains };
}
