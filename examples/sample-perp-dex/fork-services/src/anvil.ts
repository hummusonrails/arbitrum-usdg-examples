// A fresh Anvil fork of Arbitrum One, and helpers to act and fund accounts on it.
import { spawn, type ChildProcess } from 'node:child_process';

import {
    createTestClient,
    erc20Abi,
    http,
    publicActions,
    walletActions,
    type Address,
} from 'viem';
import { arbitrum } from 'viem/chains';

export type ForkClient = ReturnType<typeof forkClient>;

const UPSTREAM = 'https://arb1.arbitrum.io/rpc';

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

// Starts Anvil on the latest Arbitrum One block. FORK_RPC_URL picks another upstream.
export async function startAnvil(opts: { port: number; upstream?: string }) {
    const upstream = opts.upstream ?? process.env.FORK_RPC_URL ?? UPSTREAM;
    const rpcUrl = `http://127.0.0.1:${opts.port}`;
    const child: ChildProcess = spawn(
        'anvil',
        // Without --no-rate-limit Anvil throttles its upstream calls, which makes
        // a cold fork slow to deploy and seed.
        [
            '--fork-url',
            upstream,
            '--port',
            String(opts.port),
            '--no-rate-limit',
            '--silent',
        ],
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

// Moves a real ERC20 balance from a holder on the fork, so balances and
// Transfer logs are real contract behavior.
export async function fundErc20(
    client: ForkClient,
    holder: Address,
    token: Address,
    to: Address,
    units: bigint,
): Promise<void> {
    await asAccount(client, holder, async () => {
        const hash = await client.writeContract({
            account: holder,
            chain: client.chain,
            address: token,
            abi: erc20Abi,
            functionName: 'transfer',
            args: [to, units],
        });

        await client.waitForTransactionReceipt({ hash });
    });
}

// Moves `units` of `token` to `to`, drawing from each holder in turn. Holder
// balances change on mainnet, so no single holder has to cover the whole amount.
export async function fundFromHolders(
    client: ForkClient,
    token: Address,
    holders: Address[],
    to: Address,
    units: bigint,
): Promise<void> {
    let remaining = units;

    for (const holder of holders) {
        if (remaining === 0n) {
            return;
        }

        const balance = await client.readContract({
            address: token,
            abi: erc20Abi,
            functionName: 'balanceOf',
            args: [holder],
        });
        const take = balance < remaining ? balance : remaining;

        if (take > 0n) {
            await fundErc20(client, holder, token, to, take);
            remaining -= take;
        }
    }

    if (remaining > 0n) {
        throw new Error(
            `The funding holders for ${token} are ${remaining} units short. Add a holder to the list.`,
        );
    }
}
