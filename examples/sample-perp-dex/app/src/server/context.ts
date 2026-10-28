import { createChain } from './chain.ts';
import { loadConfig } from './config.ts';
import type { Ctx } from './ctx.ts';
import { getKv, openDb, setKv } from './db.ts';

// Builds everything the server needs from the environment.
export async function createCtx(env: NodeJS.ProcessEnv = process.env): Promise<Ctx> {
    const config = loadConfig(env);
    const db = openDb(config.dbPath);
    const chain = createChain(config);

    // Positions, deposits, and liquidations are read from logs since the first
    // boot on this fork, so a restart still finds every one.
    if (!getKv(db, 'start_block')) {
        setKv(
            db,
            'start_block',
            env.START_BLOCK ?? String(await chain.client.getBlockNumber()),
        );
    }

    return { config, db, chain };
}
