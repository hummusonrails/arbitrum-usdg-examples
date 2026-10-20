import type { Address, PublicClient } from 'viem';

import { usdgAbi } from './abi.ts';
import { USDG, type UsdgNetwork } from './networks.ts';

export type WalletHealth = {
    usdg: bigint;
    eth: bigint;
    frozen: boolean;
    paused: boolean;
};

// Everything a treasury needs to know before moving USDG out of a wallet.
export async function readWalletHealth(
    client: PublicClient,
    network: UsdgNetwork,
    wallet: Address,
): Promise<WalletHealth> {
    const token = { address: USDG[network].address, abi: usdgAbi } as const;
    const [usdg, frozen, paused, eth] = await Promise.all([
        client.readContract({ ...token, functionName: 'balanceOf', args: [wallet] }),
        client.readContract({ ...token, functionName: 'isFrozen', args: [wallet] }),
        client.readContract({ ...token, functionName: 'paused' }),
        client.getBalance({ address: wallet }),
    ]);

    return { usdg, eth, frozen, paused };
}
