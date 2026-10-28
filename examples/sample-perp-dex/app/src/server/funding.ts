// Wallets on the fork and demo funding from real holders. Used by the stack,
// the probe, and the app's fork only "add demo funds" action.
import {
    fundFromHolders,
    type ForkClient,
} from '@arbitrum-usdg/perp-dex-fork-services';
import { USDG } from '@arbitrum-usdg/usdg';
import { createWalletClient, http, type Hex } from 'viem';
import { privateKeyToAccount } from 'viem/accounts';

import { FORK_HOLDERS } from './registry.ts';

export function walletOn(client: ForkClient, key: Hex) {
    return createWalletClient({
        account: privateKeyToAccount(key),
        chain: client.chain,
        transport: http(client.transport.url as string, { timeout: 120_000 }),
    });
}

export type Wallet = ReturnType<typeof walletOn>;

export async function mined(client: ForkClient, hash: Hex) {
    const receipt = await client.waitForTransactionReceipt({ hash });

    if (receipt.status !== 'success') {
        throw new Error(`Setup transaction ${hash} reverted`);
    }

    return receipt;
}

// Gives an account ETH for gas and real USDG moved from holders on the fork.
export async function fund(client: ForkClient, key: Hex, usdgUnits: bigint) {
    const who = privateKeyToAccount(key).address;

    await client.setBalance({ address: who, value: 10n * 10n ** 18n });

    if (usdgUnits > 0n) {
        await fundFromHolders(
            client,
            USDG.arbitrumOne.address,
            FORK_HOLDERS,
            who,
            usdgUnits,
        );
    }
}

// What one "add demo funds" press gives a trader's wallet on the fork.
export const DEMO_TOP_UP = 10_000n * 10n ** 6n;
