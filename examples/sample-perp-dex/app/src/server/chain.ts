import { acmeMarginVaultAbi, acmeOracleAbi } from '@arbitrum-usdg/perp-dex-contracts';
import { forkClient, type ForkClient } from '@arbitrum-usdg/perp-dex-fork-services';
import { usdgAuthorizationAbi } from '@arbitrum-usdg/usdg';
import type { Abi, Address, Hex, LocalAccount } from 'viem';
import { privateKeyToAccount } from 'viem/accounts';

import type { Config } from './config.ts';
import { walletOn, type Wallet } from './funding.ts';
import type { Who } from './wallets.ts';

export type Chain = {
    client: ForkClient;
    account(who: Who): LocalAccount;
    address(who: Who): Address;
    wallet(who: Who): Wallet;
};

// The fork client, and a signer for the operator, the keeper, and each trader.
export function createChain(config: Config): Chain {
    const client = forkClient(config.rpcUrl);
    const key = (who: Who): Hex =>
        who === 'operator'
            ? config.operatorKey
            : who === 'keeper'
              ? config.keeperKey
              : config.walletKeys[who];
    const wallets = new Map<Who, Wallet>();

    return {
        client,
        account: (who) => privateKeyToAccount(key(who)),
        address: (who) => privateKeyToAccount(key(who)).address,
        wallet(who) {
            if (!wallets.has(who)) {
                wallets.set(who, walletOn(client, key(who)));
            }

            return wallets.get(who)!;
        },
    };
}

// The vault ABI with the errors it can bubble up from the oracle and from
// USDG's EIP-3009 facet, so every revert decodes by name.
export const vaultAbi = [
    ...acmeMarginVaultAbi,
    ...acmeOracleAbi.filter((e) => e.type === 'error'),
    ...usdgAuthorizationAbi.filter((e) => e.type === 'error'),
] as const;

// A message the app wrote itself, safe to show a trader or operator.
export class ActionError extends Error {}

// What each contract error means for the person who pressed the button.
const REVERTS: Record<string, string> = {
    InsufficientMargin:
        'Not enough free margin for that. Deposit more or close a position first.',
    InsufficientLiquidity:
        'The house cannot cover a position that large right now. Try a smaller size.',
    PositionExists:
        'There is already a position in this market. Close it before opening another.',
    NoPosition: 'There is no open position in this market.',
    LeverageOutOfRange: 'Leverage must be between 1x and 10x.',
    PriceSlippage:
        'The price moved past the acceptable price, so nothing happened. Check the new price and try again.',
    NotLiquidatable: 'That position is still above its maintenance margin.',
    DepositNotReceived:
        'USDG did not move for that signature, so no margin was credited. Sign a new deposit.',
    NothingToShare: 'The vault holds no margin or liquidity to share rewards with yet.',
    StalePrice:
        'The market price is out of date, so trading is paused until the keeper pushes a new one.',
    UnknownMarket: 'That market is not listed.',
    AuthorizationExpired: 'That deposit signature expired. Sign a new one.',
    InvalidSignature: 'The deposit signature does not match the trader.',
    ZeroAmount: 'Enter an amount above zero.',
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
    abi: Abi | readonly unknown[];
    functionName: string;
    args?: readonly unknown[];
};

// Simulates, broadcasts, and waits for one contract call. Simulating first
// turns a revert into a readable error before any gas is spent.
export async function submit(chain: Chain, who: Who, call: Call) {
    const wallet = chain.wallet(who);
    const { request } = await chain.client
        .simulateContract({
            ...call,
            account: wallet.account,
        } as Parameters<ForkClient['simulateContract']>[0])
        .catch((err: unknown) => {
            throw revertMessage(err) ?? err;
        });
    // The call shape is checked where each caller builds it.
    const hash = await wallet.writeContract(request as never);
    const receipt = await chain.client.waitForTransactionReceipt({ hash });

    if (receipt.status !== 'success') {
        throw new ActionError(`The transaction ${hash} reverted.`);
    }

    return receipt;
}
