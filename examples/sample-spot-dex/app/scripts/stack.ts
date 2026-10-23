// Starts the whole local stack: fresh Anvil forks of Arbitrum One and
// Ethereum, the Acme pools deployed and seeded, a payout group from the Paxos
// registrar stand in, the LayerZero relay stand in, and the app. Used by
// `pnpm dev:fork` and by the end to end tests.
import { spawn, spawnSync, type ChildProcess } from 'node:child_process';
import { mkdirSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

import {
    createPayoutGroup,
    startAnvil,
    startRelay,
    waitFor,
} from '@arbitrum-usdg/spot-dex-fork-services';
import { parseUnits, type Hex } from 'viem';
import { generatePrivateKey, privateKeyToAccount } from 'viem/accounts';
import { arbitrum, mainnet } from 'viem/chains';

import { fund, type Funding } from '../src/server/funding.ts';
import { POOLS, type PoolId } from '../src/server/registry.ts';
import { WALLET_IDS, type WalletId } from '../src/server/wallets.ts';
import { addLiquidity, deployAndSeed, quoteAtFeed, walletOn } from './setup.ts';

const APP_DIR = join(dirname(fileURLToPath(import.meta.url)), '..');

export type StackOptions = {
    app: 'dev' | 'start';
    appPort?: number;
    arbPort?: number;
    ethPort?: number;
    dbPath?: string;
    loopMs?: number;
    relayDelayMs?: number;
    quiet?: boolean;
};

const usdg = (n: number) => parseUnits(String(n), 6);
const whole = (n: number) => parseUnits(String(n), 18);

// Starting balances on the forks, moved from real holders.
const OPERATOR_FUNDING: Funding = {
    usdg: usdg(80_000),
    usdgEthereum: 0n,
    weth: POOLS.weth.seedBase,
    arb: POOLS.arb.seedBase,
};

const WALLET_FUNDING: Record<WalletId, Funding> = {
    lena: {
        usdg: usdg(30_000),
        usdgEthereum: usdg(10_000),
        weth: whole(10),
        arb: whole(50_000),
    },
    omar: {
        usdg: usdg(30_000),
        usdgEthereum: usdg(10_000),
        weth: whole(10),
        arb: whole(50_000),
    },
    priya: {
        usdg: usdg(15_000),
        usdgEthereum: usdg(10_000),
        weth: whole(2),
        arb: whole(10_000),
    },
};

// The two LPs start with positions, so routed rewards have someone to go to.
const STARTING_LIQUIDITY: { who: WalletId; pool: PoolId; usdg: number }[] = [
    { who: 'lena', pool: 'weth', usdg: 12_000 },
    { who: 'omar', pool: 'weth', usdg: 4_000 },
    { who: 'omar', pool: 'arb', usdg: 6_000 },
];

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
    const build = spawnSync(
        'pnpm',
        ['--filter', '@arbitrum-usdg/spot-dex-contracts', 'build'],
        {
            stdio: quiet ? 'ignore' : 'inherit',
        },
    );

    if (build.status !== 0) {
        throw new Error('Building the pool contract failed. Is Foundry installed?');
    }

    const arb = await startAnvil({ port: opts.arbPort ?? 8545, chain: arbitrum });
    const eth = await startAnvil({ port: opts.ethPort ?? 8546, chain: mainnet });
    // Throwaway keys for each run: the Acme Swap operator and three demo wallets.
    const operatorKey = generatePrivateKey();
    const walletKeys = Object.fromEntries(
        WALLET_IDS.map((id) => [id, generatePrivateKey()]),
    ) as Record<WalletId, Hex>;
    const operator = privateKeyToAccount(operatorKey).address;

    await fund(arb.client, eth.client, operatorKey, OPERATOR_FUNDING);

    for (const id of WALLET_IDS) {
        await fund(arb.client, eth.client, walletKeys[id], WALLET_FUNDING[id]);
    }

    const op = walletOn(arb.client, operatorKey);
    const pools = {
        weth: await deployAndSeed(arb.client, op, POOLS.weth),
        arb: await deployAndSeed(arb.client, op, POOLS.arb),
    };

    for (const lp of STARTING_LIQUIDITY) {
        const def = POOLS[lp.pool];
        const quote = usdg(lp.usdg);
        // Base for that much USDG at the feed price, with headroom so the pool
        // takes all of the USDG at its own ratio.
        const base =
            (whole(1) * quote * 101n) /
            (await quoteAtFeed(arb.client, def, whole(1))) /
            100n;

        await addLiquidity(
            arb.client,
            walletOn(arb.client, walletKeys[lp.who]),
            def,
            pools[lp.pool],
            base,
            quote,
        );
    }

    const payoutGroupId = await createPayoutGroup(arb.client, {
        claimer: operator,
        manager: operator,
        destination: operator,
    });
    const relay = await startRelay({
        arbitrum: arb.client,
        ethereum: eth.client,
        delayMs: opts.relayDelayMs,
        log: !quiet,
    });
    // Outside the app folder, so database writes never wake the dev server's
    // file watcher.
    const dbPath = opts.dbPath ?? join(tmpdir(), 'sample-spot-dex', 'dex.fork.db');

    mkdirSync(dirname(dbPath), { recursive: true });

    // The forks start fresh every run, so the records do too.
    for (const suffix of ['', '-wal', '-shm']) {
        rmSync(`${dbPath}${suffix}`, { force: true });
    }

    const env: NodeJS.ProcessEnv = {
        ...process.env,
        RPC_URL: arb.rpcUrl,
        ETH_RPC_URL: eth.rpcUrl,
        OPERATOR_PRIVATE_KEY: operatorKey,
        WALLET_KEYS: JSON.stringify(walletKeys),
        POOL_WETH: pools.weth,
        POOL_ARB: pools.arb,
        PAYOUT_GROUP_ID: String(payoutGroupId),
        DB_PATH: dbPath,
        LOOP_INTERVAL_MS: String(opts.loopMs ?? 3000),
        PORT: String(appPort),
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
        arbitrum: arb.client,
        ethereum: eth.client,
        arbRpcUrl: arb.rpcUrl,
        ethRpcUrl: eth.rpcUrl,
        operator,
        wallets: Object.fromEntries(
            WALLET_IDS.map((id) => [id, privateKeyToAccount(walletKeys[id]).address]),
        ) as Record<WalletId, `0x${string}`>,
        pools,
        payoutGroupId,
        relay,
        startApp,
        stopApp,
        async stop() {
            await stopApp();
            await relay.close();
            arb.stop();
            eth.stop();
        },
    };
}

export type Stack = Awaited<ReturnType<typeof startStack>>;
