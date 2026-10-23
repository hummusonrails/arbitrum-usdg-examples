// Wallets on the forks and demo funding from real holders. Used by the stack,
// the probe, and the app's fork only "add demo funds" action.
import {
    fundFromHolders,
    type ForkClient,
} from '@arbitrum-usdg/spot-dex-fork-services';
import { USDG, USDG_ETHEREUM } from '@arbitrum-usdg/usdg';
import { createWalletClient, http, type Hex } from 'viem';
import { privateKeyToAccount } from 'viem/accounts';

import { ARB, FORK_HOLDERS, WETH, wethAbi } from './registry.ts';

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

export type Funding = { usdg: bigint; usdgEthereum: bigint; weth: bigint; arb: bigint };

// Gives an account ETH for gas on both forks and real token balances moved
// from holders on the fork. WETH is wrapped from ETH.
export async function fund(
    arbitrum: ForkClient,
    ethereum: ForkClient,
    key: Hex,
    amounts: Funding,
) {
    const who = privateKeyToAccount(key).address;
    const eth = 10n ** 18n * 10n;

    await arbitrum.setBalance({ address: who, value: eth + amounts.weth });
    await ethereum.setBalance({ address: who, value: eth });

    if (amounts.usdg > 0n) {
        await fundFromHolders(
            arbitrum,
            USDG.arbitrumOne.address,
            FORK_HOLDERS.usdgArbitrum,
            who,
            amounts.usdg,
        );
    }

    if (amounts.usdgEthereum > 0n) {
        await fundFromHolders(
            ethereum,
            USDG_ETHEREUM,
            FORK_HOLDERS.usdgEthereum,
            who,
            amounts.usdgEthereum,
        );
    }

    if (amounts.arb > 0n) {
        await fundFromHolders(arbitrum, ARB, FORK_HOLDERS.arb, who, amounts.arb);
    }

    if (amounts.weth > 0n) {
        await mined(
            arbitrum,
            await walletOn(arbitrum, key).writeContract({
                address: WETH,
                abi: wethAbi,
                functionName: 'deposit',
                value: amounts.weth,
            }),
        );
    }
}

// What one "add demo funds" press gives a wallet on the forks.
export const DEMO_TOP_UP: Funding = {
    usdg: 10_000n * 10n ** 6n,
    usdgEthereum: 5_000n * 10n ** 6n,
    weth: 2n * 10n ** 18n,
    arb: 10_000n * 10n ** 18n,
};
