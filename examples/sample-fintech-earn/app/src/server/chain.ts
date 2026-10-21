import {
    createPublicClient,
    type Abi,
    createWalletClient,
    http,
    type Address,
    type PublicClient,
    type WalletClient,
} from 'viem';
import { privateKeyToAccount } from 'viem/accounts';
import { arbitrum } from 'viem/chains';

import type { Config } from './config.ts';

export type Chain = {
    publicClient: PublicClient;
    walletClient: WalletClient;
    omnibus: Address;
};

// Clients for Arbitrum One (or a fork of it) acting as the omnibus wallet.
export function createChain(config: Config): Chain {
    const account = privateKeyToAccount(config.privateKey);
    // A fresh fork fetches state from upstream on first touch, which can be slow.
    const transport = http(config.rpcUrl, { timeout: 120_000 });

    return {
        publicClient: createPublicClient({
            chain: arbitrum,
            transport,
        }) as PublicClient,
        walletClient: createWalletClient({ account, chain: arbitrum, transport }),
        omnibus: account.address,
    };
}

// A message the app wrote itself, safe to show a customer or operator.
export class ActionError extends Error {}

type Call = {
    address: Address;
    abi: Abi;
    functionName: string;
    args?: readonly unknown[];
    value?: bigint;
};

// Simulates, sends, and waits for one contract call from the omnibus wallet.
// Simulating first turns a revert into a readable error before any gas is spent.
export async function submit(chain: Chain, call: Call) {
    const { request } = await chain.publicClient.simulateContract({
        ...call,
        account: chain.walletClient.account!,
    } as Parameters<PublicClient['simulateContract']>[0]);
    // The call shape is checked where each caller builds it.
    const hash = await chain.walletClient.writeContract(request as never);
    const receipt = await chain.publicClient.waitForTransactionReceipt({ hash });

    if (receipt.status !== 'success') {
        throw new ActionError(`The transaction ${hash} reverted.`);
    }

    return receipt;
}
