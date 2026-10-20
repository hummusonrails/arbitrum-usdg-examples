// Starts the whole local stack: a fresh Anvil fork of Arbitrum One, the mock
// Paxos server, the setup command, and the app. Used by `pnpm dev:mock` and
// by the end to end tests.
import { spawn, type ChildProcess } from 'node:child_process';
import { rmSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

import { startMockPaxos } from '@arbitrum-usdg/mock-paxos';
import { createTestClient, http, publicActions, type Address } from 'viem';
import { generatePrivateKey, privateKeyToAccount } from 'viem/accounts';
import { arbitrum } from 'viem/chains';

const APP_DIR = join(dirname(fileURLToPath(import.meta.url)), '..');

export type StackOptions = {
    app: 'dev' | 'start';
    appPort?: number;
    mockPort?: number;
    anvilPort?: number;
    dbPath?: string;
    loopMs?: number;
    env?: Record<string, string>;
    quiet?: boolean;
};

async function waitFor(what: string, ok: () => Promise<boolean>, ms = 60_000) {
    const end = Date.now() + ms;

    while (Date.now() < end) {
        if (await ok().catch(() => false)) {
            return;
        }

        await new Promise((r) => setTimeout(r, 250));
    }

    throw new Error(`Timed out waiting for ${what}`);
}

function run(
    cmd: string,
    args: string[],
    env: NodeJS.ProcessEnv,
    quiet: boolean,
): ChildProcess {
    return spawn(cmd, args, {
        cwd: APP_DIR,
        env,
        stdio: quiet ? 'ignore' : 'inherit',
        detached: true,
    });
}

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
    const anvilPort = opts.anvilPort ?? 8545;
    const rpcUrl = `http://127.0.0.1:${anvilPort}`;
    const upstream = process.env.FORK_RPC_URL ?? 'https://arb1.arbitrum.io/rpc';
    // A throwaway wallet for each run, funded with ETH on the local fork.
    const key = generatePrivateKey();
    const wallet: Address = privateKeyToAccount(key).address;
    const webhookKey = 'local-webhook-key';

    // A fresh fork every run: public RPCs only keep recent state.
    const anvil = run(
        'anvil',
        ['--fork-url', upstream, '--port', String(anvilPort), '--silent'],
        process.env,
        true,
    );
    const testClient = createTestClient({
        chain: arbitrum,
        mode: 'anvil',
        transport: http(rpcUrl),
    }).extend(publicActions);

    await waitFor('Anvil', async () => (await testClient.getBlockNumber()) > 0n);
    await testClient.setBalance({ address: wallet, value: 10n ** 18n });

    const mock = await startMockPaxos({
        port: opts.mockPort ?? 4010,
        rpcUrl,
        profileId: 'mock-profile',
        webhookUrl: `http://127.0.0.1:${appPort}/api/webhooks/paxos`,
        webhookApiKey: webhookKey,
        pollMs: 500,
    });
    const dbPath = opts.dbPath ?? join(APP_DIR, 'treasury.mock.db');

    // The fork and the mock start fresh every run, so the records do too.
    for (const suffix of ['', '-wal', '-shm']) {
        rmSync(`${dbPath}${suffix}`, { force: true });
    }

    const env: NodeJS.ProcessEnv = {
        ...process.env,
        MODE: 'mock',
        MOCK_PAXOS_URL: mock.url,
        RPC_URL: rpcUrl,
        TREASURY_PRIVATE_KEY: key,
        PAXOS_CLIENT_ID: 'mock',
        PAXOS_CLIENT_SECRET: 'mock',
        PAXOS_PROFILE_ID: 'mock-profile',
        PAXOS_BANK_ACCOUNT_ID: '',
        PAXOS_OPTIONAL_SCOPES: '1',
        PAXOS_IDENTITY_ID: 'mock-identity',
        PAXOS_INSTITUTION_NAME: 'Acme Co.',
        WEBHOOK_API_KEY: webhookKey,
        DB_PATH: dbPath,
        LOOP_INTERVAL_MS: String(opts.loopMs ?? 3000),
        PORT: String(appPort),
        ...opts.env,
    };

    const setup = run(
        'pnpm',
        ['exec', 'tsx', '--conditions=react-server', 'scripts/setup.ts'],
        env,
        quiet,
    );

    await new Promise<void>((resolve, reject) =>
        setup.on('exit', (code) =>
            code === 0 ? resolve() : reject(new Error(`setup exited ${code}`)),
        ),
    );

    let app: ChildProcess | undefined;
    const appUrl = `http://127.0.0.1:${appPort}`;

    async function startApp() {
        app = run(
            'pnpm',
            ['exec', 'next', opts.app, '--port', String(appPort)],
            env,
            quiet,
        );
        await waitFor(
            'the app',
            async () => (await fetch(`${appUrl}/api/state?once=1`)).ok,
            120_000,
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
        mockUrl: mock.url,
        rpcUrl,
        wallet,
        startApp,
        stopApp,
        async stop() {
            await stopApp();
            await mock.close();
            stopProcess(anvil);
        },
    };
}

export type Stack = Awaited<ReturnType<typeof startStack>>;
