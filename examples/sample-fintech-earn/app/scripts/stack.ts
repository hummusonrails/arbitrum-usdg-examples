// Starts the whole local stack: a fresh Anvil fork of Arbitrum One, the local
// GMX keeper, the Merkl rewards stand in, and the app. Used by `pnpm dev:fork`
// and by the end to end tests.
import { spawn, type ChildProcess } from 'node:child_process';
import { rmSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

import {
    startAnvil,
    startKeeper,
    startMerklStandIn,
    waitFor,
    warmGlv,
} from '@arbitrum-usdg/earn-fork-services';
import { generatePrivateKey, privateKeyToAccount } from 'viem/accounts';

import { FORK_USDG_HOLDER, VAULTS } from '../src/server/vaults/registry.ts';

const APP_DIR = join(dirname(fileURLToPath(import.meta.url)), '..');

export type StackOptions = {
    app: 'dev' | 'start';
    appPort?: number;
    anvilPort?: number;
    merklPort?: number;
    dbPath?: string;
    loopMs?: number;
    // Fixed reward rate for tests, so they pass whether or not a campaign is live.
    fixedApr?: number;
    env?: Record<string, string>;
    quiet?: boolean;
};

function stopProcess(child: ChildProcess | undefined) {
    if (child?.pid && child.exitCode === null) {
        try {
            process.kill(-child.pid, 'SIGTERM');
        } catch {}
    }
}

export async function startStack(opts: StackOptions) {
    const quiet = opts.quiet ?? false;
    const appPort = opts.appPort ?? 3000;
    const fork = await startAnvil({ port: opts.anvilPort ?? 8545 });
    // A throwaway omnibus wallet for each run, funded with ETH on the fork.
    const key = generatePrivateKey();
    const omnibus = privateKeyToAccount(key).address;

    await fork.client.setBalance({ address: omnibus, value: 10n ** 18n });

    const keeper = await startKeeper({ rpcUrl: fork.rpcUrl, log: !quiet });

    // Warms GMX state on the fork in the background so the first GLV deposit
    // settles in seconds.
    void warmGlv(fork.rpcUrl, FORK_USDG_HOLDER).catch((err) =>
        console.error('GLV warm up failed; the first GLV request may be slow', err),
    );
    const merkl = await startMerklStandIn({
        rpcUrl: fork.rpcUrl,
        port: opts.merklPort ?? 4020,
        omnibus,
        vaults: [VAULTS.steakhouse, VAULTS.gauntlet],
        fixedApr: opts.fixedApr,
    });
    const dbPath = opts.dbPath ?? join(APP_DIR, 'earn.fork.db');

    // The fork starts fresh every run, so the records do too.
    for (const suffix of ['', '-wal', '-shm']) {
        rmSync(`${dbPath}${suffix}`, { force: true });
    }

    const env: NodeJS.ProcessEnv = {
        ...process.env,
        MODE: 'fork',
        RPC_URL: fork.rpcUrl,
        OMNIBUS_PRIVATE_KEY: key,
        MERKL_API_URL: merkl.url,
        DB_PATH: dbPath,
        LOOP_INTERVAL_MS: String(opts.loopMs ?? 3000),
        PORT: String(appPort),
        ...opts.env,
    };
    let app: ChildProcess | undefined;
    const appUrl = `http://127.0.0.1:${appPort}`;

    async function startApp() {
        app = spawn('pnpm', ['exec', 'next', opts.app, '--port', String(appPort)], {
            cwd: APP_DIR,
            env,
            stdio: quiet ? 'ignore' : 'inherit',
            detached: true,
        });
        await waitFor(
            'the app',
            async () => (await fetch(`${appUrl}/api/state?once=1`)).ok,
            180_000,
        );
    }

    async function stopApp() {
        const child = app;

        stopProcess(child);
        await new Promise((r) =>
            child && child.exitCode === null ? child.on('exit', r) : r(null),
        );
    }

    await startApp();

    return {
        appUrl,
        rpcUrl: fork.rpcUrl,
        merklUrl: merkl.url,
        omnibus,
        client: fork.client,
        publishRewards: merkl.publish,
        startApp,
        stopApp,
        async stop() {
            await stopApp();
            await keeper.close();
            await merkl.close();
            fork.stop();
        },
    };
}

export type Stack = Awaited<ReturnType<typeof startStack>>;
