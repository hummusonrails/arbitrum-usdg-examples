import { forkClient, type ForkClient } from '@arbitrum-usdg/spot-dex-fork-services';
import type { Abi, Address, Hex } from 'viem';
import { privateKeyToAccount } from 'viem/accounts';
import { arbitrum, mainnet } from 'viem/chains';

import type { Config } from './config.ts';
import { walletOn, type Wallet } from './funding.ts';
import type { Who } from './wallets.ts';

export type Network = 'arbitrum' | 'ethereum';

export type Chains = {
    clients: Record<Network, ForkClient>;
    address(who: Who): Address;
    wallet(who: Who, on: Network): Wallet;
};

// Clients for both forks, and a signer for the operator and each demo wallet.
export function createChains(config: Config): Chains {
    const clients = {
        arbitrum: forkClient(config.rpcUrl, arbitrum),
        ethereum: forkClient(config.ethRpcUrl, mainnet),
    };
    const key = (who: Who): Hex =>
        who === 'operator' ? config.operatorKey : config.walletKeys[who];
    const wallets = new Map<string, Wallet>();

    return {
        clients,
        address: (who) => privateKeyToAccount(key(who)).address,
        wallet(who, on) {
            const id = `${who}:${on}`;

            if (!wallets.has(id)) {
                wallets.set(id, walletOn(clients[on], key(who)));
            }

            return wallets.get(id)!;
        },
    };
}

// A message the app wrote itself, safe to show a trader or operator.
export class ActionError extends Error {}

// What each contract error means for the person who pressed the button.
const REVERTS: Record<string, string> = {
    InsufficientOutput:
        'The price moved past your minimum, so nothing was swapped. Check the new quote and try again.',
    InsufficientLiquidity: 'That amount is too small for the pool to act on.',
    NoLiquidity: 'This pool has no LPs to route rewards to yet.',
    ZeroAmount: 'Enter an amount above zero.',
    ERC20InsufficientBalance: 'The wallet does not hold enough of that token.',
};

// A plain message for a contract revert the app knows, or null for anything
// else. It walks the cause chain by error name rather than instanceof, since
// the Next.js server bundle can load viem more than once.
export function revertMessage(err: unknown): ActionError | null {
    for (
        let e = err as {
            name?: string;
            data?: { errorName?: string };
            cause?: unknown;
        };
        e;
        e = e.cause as typeof e
    ) {
        const name =
            e.name === 'ContractFunctionRevertedError' ? e.data?.errorName : undefined;

        if (name && REVERTS[name]) {
            return new ActionError(REVERTS[name]);
        }
    }

    return null;
}

type Call = {
    address: Address;
    abi: Abi;
    functionName: string;
    args?: readonly unknown[];
    value?: bigint;
};

// Simulates, broadcasts, and waits for one contract call. Simulating first
// turns a revert into a readable error before any gas is spent.
export async function submit(chains: Chains, who: Who, on: Network, call: Call) {
    const client = chains.clients[on];
    const wallet = chains.wallet(who, on);
    const { request } = await client
        .simulateContract({
            ...call,
            account: wallet.account,
        } as Parameters<ForkClient['simulateContract']>[0])
        .catch((err: unknown) => {
            throw revertMessage(err) ?? err;
        });
    // The call shape is checked where each caller builds it.
    const hash = await wallet.writeContract(request as never);
    const receipt = await client.waitForTransactionReceipt({ hash });

    if (receipt.status !== 'success') {
        throw new ActionError(`The transaction ${hash} reverted.`);
    }

    return receipt;
}
