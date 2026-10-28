// Starts the whole local stack: a fresh Anvil fork of Arbitrum One, the Acme
// oracle and margin vault deployed with house liquidity, a payout group from
// the Paxos registrar stand in, two traders already in positions, and the app.
// Used by `pnpm dev:fork` and by the end to end tests.
import { spawn, spawnSync, type ChildProcess } from 'node:child_process';
import { mkdirSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

import { acmeMarginVaultAbi } from '@arbitrum-usdg/perp-dex-contracts';
import {
    createPayoutGroup,
    startAnvil,
    waitFor,
} from '@arbitrum-usdg/perp-dex-fork-services';
import { getAddress, maxUint256, parseUnits, type Address, type Hex } from 'viem';
import { generatePrivateKey, privateKeyToAccount } from 'viem/accounts';

import { depositArgs, signDeposit } from '../src/server/authorize.ts';
import { mined } from '../src/server/funding.ts';
import { MARKETS, type MarketId } from '../src/server/registry.ts';
import { WALLET_IDS, type WalletId } from '../src/server/wallets.ts';
import { deployExchange, fund, walletOn } from './setup.ts';

const APP_DIR = join(dirname(fileURLToPath(import.meta.url)), '..');

export type StackOptions = {
    app: 'dev' | 'start';
    appPort?: number;
    arbPort?: number;
    dbPath?: string;
    loopMs?: number;
    quiet?: boolean;
};

const usdg = (n: number) => parseUnits(String(n), 6);

// House liquidity the operator puts in the vault, and what each wallet starts
// with, moved from real holders on the fork.
const HOUSE_LIQUIDITY = usdg(250_000);
const OPERATOR_FUNDING = usdg(260_000);
const WALLET_FUNDING: Record<WalletId, bigint> = {
    ana: usdg(25_000),
    kofi: usdg(25_000),
    mei: usdg(15_000),
};

// Two traders start with margin and a position, so the console has something
// to show. Mei starts with USDG in her wallet only.
const STARTING_TRADES: {
    who: WalletId;
    deposit: number;
    market: MarketId;
    isLong: boolean;
    collateral: number;
    size: number;
}[] = [
    {
        who: 'ana',
        deposit: 10_000,
        market: 'eth',
        isLong: true,
        collateral: 1_000,
        size: 5_000,
    },
    {
        who: 'kofi',
        deposit: 8_000,
        market: 'btc',
        isLong: false,
        collateral: 2_000,
        size: 4_000,
    },
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
        ['--filter', '@arbitrum-usdg/perp-dex-contracts', 'build'],
        {
            stdio: quiet ? 'ignore' : 'inherit',
        },
    );

    if (build.status !== 0) {
        throw new Error('Building the vault contracts failed. Is Foundry installed?');
    }

    const arb = await startAnvil({ port: opts.arbPort ?? 8545 });
    const client = arb.client;
    // Throwaway keys for each run: the Acme Perps operator, its keeper, and
    // three demo traders.
    const operatorKey = generatePrivateKey();
    const keeperKey = generatePrivateKey();
    const walletKeys = Object.fromEntries(
        WALLET_IDS.map((id) => [id, generatePrivateKey()]),
    ) as Record<WalletId, Hex>;
    const operator = privateKeyToAccount(operatorKey).address;

    await fund(client, operatorKey, OPERATOR_FUNDING);
    await fund(client, keeperKey, 0n);

    for (const id of WALLET_IDS) {
        await fund(client, walletKeys[id], WALLET_FUNDING[id]);
    }

    // The app reads the vault's events from here on.
    const startBlock = await client.getBlockNumber();
    const keeper = walletOn(client, keeperKey);
    const deployed = await deployExchange(
        client,
        walletOn(client, operatorKey),
        keeper,
        HOUSE_LIQUIDITY,
    );
    const vault = getAddress(deployed.vault);
    const oracle = getAddress(deployed.oracle);

    for (const t of STARTING_TRADES) {
        const trader = walletOn(client, walletKeys[t.who]);
        const { timestamp } = await client.getBlock();
        const signed = await signDeposit(
            trader.account,
            vault,
            usdg(t.deposit),
            timestamp,
        );

        await mined(
            client,
            await keeper.writeContract({
                address: vault,
                abi: acmeMarginVaultAbi,
                functionName: 'depositWithAuthorization',
                args: depositArgs(signed),
            }),
        );
        await mined(
            client,
            await trader.writeContract({
                address: vault,
                abi: acmeMarginVaultAbi,
                functionName: 'openPosition',
                args: [
                    MARKETS[t.market].key,
                    t.isLong,
                    usdg(t.collateral),
                    usdg(t.size),
                    t.isLong ? maxUint256 : 0n,
                ],
            }),
        );
    }

    const payoutGroupId = await createPayoutGroup(client, {
        claimer: operator,
        manager: operator,
        destination: operator,
    });
    // Outside the app folder, so database writes never wake the dev server's
    // file watcher.
    const dbPath = opts.dbPath ?? join(tmpdir(), 'sample-perp-dex', 'perp.fork.db');

    mkdirSync(dirname(dbPath), { recursive: true });

    // The fork starts fresh every run, so the records do too.
    for (const suffix of ['', '-wal', '-shm']) {
        rmSync(`${dbPath}${suffix}`, { force: true });
    }

    const env: NodeJS.ProcessEnv = {
        ...process.env,
        RPC_URL: arb.rpcUrl,
        OPERATOR_PRIVATE_KEY: operatorKey,
        KEEPER_PRIVATE_KEY: keeperKey,
        WALLET_KEYS: JSON.stringify(walletKeys),
        VAULT_ADDRESS: vault,
        ORACLE_ADDRESS: oracle,
        PAYOUT_GROUP_ID: String(payoutGroupId),
        START_BLOCK: String(startBlock),
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
        client,
        rpcUrl: arb.rpcUrl,
        operator,
        keeper: keeper.account.address,
        wallets: Object.fromEntries(
            WALLET_IDS.map((id) => [id, privateKeyToAccount(walletKeys[id]).address]),
        ) as Record<WalletId, Address>,
        vault,
        oracle,
        payoutGroupId,
        startBlock,
        startApp,
        stopApp,
        async stop() {
            await stopApp();
            arb.stop();
        },
    };
}

export type Stack = Awaited<ReturnType<typeof startStack>>;
