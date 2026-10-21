// A fresh Anvil fork of Arbitrum One, and helpers to fund accounts on it.
import { spawn, type ChildProcess } from 'node:child_process';

import { USDG, usdgAbi } from '@arbitrum-usdg/usdg';
import {
    createTestClient,
    http,
    publicActions,
    walletActions,
    type Address,
} from 'viem';
import { arbitrum } from 'viem/chains';

export type ForkClient = ReturnType<typeof forkClient>;

export function forkClient(rpcUrl: string) {
    // Anvil fetches fork state from upstream on first touch, so cold calls on a
    // fresh fork can take far longer than viem's default timeout.
    return createTestClient({
        chain: arbitrum,
        mode: 'anvil',
        transport: http(rpcUrl, { timeout: 120_000 }),
    })
        .extend(publicActions)
        .extend(walletActions);
}

export async function waitFor(what: string, ok: () => Promise<boolean>, ms = 60_000) {
    const end = Date.now() + ms;

    while (Date.now() < end) {
        if (await ok().catch(() => false)) {
            return;
        }

        await new Promise((r) => setTimeout(r, 250));
    }

    throw new Error(`Timed out waiting for ${what}`);
}

// Starts Anvil on the latest Arbitrum One block. GMX checks oracle price age
// against block time, so the fork must start close to live time.
export async function startAnvil(opts: { port?: number; upstream?: string } = {}) {
    const port = opts.port ?? 8545;
    const upstream =
        opts.upstream ?? process.env.FORK_RPC_URL ?? 'https://arb1.arbitrum.io/rpc';
    const rpcUrl = `http://127.0.0.1:${port}`;
    const child: ChildProcess = spawn(
        'anvil',
        ['--fork-url', upstream, '--port', String(port), '--silent'],
        { stdio: 'ignore', detached: true },
    );
    const client = forkClient(rpcUrl);

    await waitFor('Anvil', async () => (await client.getBlockNumber()) > 0n);

    return {
        rpcUrl,
        client,
        stop() {
            if (child.pid && child.exitCode === null) {
                try {
                    process.kill(-child.pid, 'SIGTERM');
                } catch {}
            }
        },
    };
}

// Sends a transaction as any account on the fork.
export async function asAccount<T>(
    client: ForkClient,
    account: Address,
    fn: () => Promise<T>,
): Promise<T> {
    await client.impersonateAccount({ address: account });
    await client.setBalance({ address: account, value: 10n ** 18n });

    try {
        return await fn();
    } finally {
        await client.stopImpersonatingAccount({ address: account });
    }
}

// Moves real USDG from a holder on the fork, so balances and Transfer logs are
// real contract behavior.
export async function fundUsdg(
    client: ForkClient,
    holder: Address,
    to: Address,
    units: bigint,
): Promise<void> {
    await asAccount(client, holder, async () => {
        const hash = await client.writeContract({
            account: holder,
            chain: arbitrum,
            address: USDG.arbitrumOne.address,
            abi: usdgAbi,
            functionName: 'transfer',
            args: [to, units],
        });

        await client.waitForTransactionReceipt({ hash });
    });
}
