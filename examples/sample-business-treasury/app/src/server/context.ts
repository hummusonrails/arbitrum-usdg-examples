import { createPaxosClient, scopesFor } from '@arbitrum-usdg/paxos-client';

import type { Ctx } from './actions.ts';
import { createChain } from './chain.ts';
import { loadConfig } from './config.ts';
import { openDb } from './db.ts';

// Builds everything the server needs from the environment.
export function createCtx(env: NodeJS.ProcessEnv = process.env): Ctx {
    const config = loadConfig(env);

    return {
        config,
        db: openDb(env.DB_PATH ?? 'treasury.db'),
        chain: createChain(config),
        paxos: createPaxosClient({
            apiUrl: config.paxos.apiUrl,
            oauthUrl: config.paxos.oauthUrl,
            clientId: config.paxos.clientId,
            clientSecret: config.paxos.clientSecret,
            scopes: scopesFor({
                optional: config.paxos.optionalScopes,
                sandbox: config.mode !== 'production',
            }),
        }),
    };
}
