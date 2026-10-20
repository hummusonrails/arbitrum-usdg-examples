import { USDG, usdgAbi } from '@arbitrum-usdg/usdg';
import {
    createPublicClient,
    createWalletClient,
    encodeFunctionData,
    http,
    keccak256,
    type Address,
    type Hex,
    type PublicClient,
} from 'viem';
import { privateKeyToAccount } from 'viem/accounts';

import type { Config } from './config.ts';

export type Chain = {
    publicClient: PublicClient;
    wallet: Address;
    // Signs a USDG transfer without broadcasting it, so the caller can store
    // the hash and raw transaction before anything leaves the machine.
    signUsdgTransfer(to: Address, units: bigint): Promise<{ hash: Hex; raw: Hex }>;
    broadcast(raw: Hex): Promise<void>;
};

export function createChain(config: Config): Chain {
    const deployment = USDG[config.network];
    const account = privateKeyToAccount(config.privateKey);
    const transport = http(config.rpcUrl);
    const publicClient = createPublicClient({ chain: deployment.chain, transport });
    const walletClient = createWalletClient({
        account,
        chain: deployment.chain,
        transport,
    });

    return {
        publicClient: publicClient as PublicClient,
        wallet: account.address,
        async signUsdgTransfer(to, units) {
            const request = await walletClient.prepareTransactionRequest({
                to: deployment.address,
                data: encodeFunctionData({
                    abi: usdgAbi,
                    functionName: 'transfer',
                    args: [to, units],
                }),
            });
            const raw = await walletClient.signTransaction(request);

            return { hash: keccak256(raw), raw };
        },
        async broadcast(raw) {
            try {
                await walletClient.sendRawTransaction({ serializedTransaction: raw });
            } catch (err) {
                // Rebroadcasting a transaction the node already has is fine.
                if (
                    !/already known|nonce too low|already imported/i.test(String(err))
                ) {
                    throw err;
                }
            }
        },
    };
}
