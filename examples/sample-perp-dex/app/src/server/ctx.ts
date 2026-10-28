import type { Chain } from './chain.ts';
import type { Config } from './config.ts';
import type { Db } from './db.ts';

// Everything the server needs, built once at startup.
export type Ctx = {
    config: Config;
    db: Db;
    chain: Chain;
};
