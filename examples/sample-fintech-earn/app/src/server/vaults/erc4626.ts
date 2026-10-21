// Morpho Vault V2 behind the shared vault adapter. Deposits and withdrawals
// settle in the same transaction, so the exact shares come from the vault's
// own Deposit and Withdraw events.
import { readWalletHealth, USDG } from '@arbitrum-usdg/usdg';
import {
    BaseError,
    ContractFunctionRevertedError,
    erc20Abi,
    formatUnits,
    maxUint256,
    parseEventLogs,
    type Hex,
} from 'viem';

import { vaultV2Abi } from '../abi.ts';
import {
    ActionError,
    confirm,
    receiptOrNull,
    send,
    submit,
    type Chain,
} from '../chain.ts';
import type { VaultAdapter, VaultConfig } from './types.ts';

const ONE_SHARE = 10n ** 18n;

const REVERTS: Record<string, string> = {
    AbsoluteCapExceeded: 'This vault has reached its deposit limit.',
    RelativeCapExceeded:
        'This vault has reached its deposit limit for its current market.',
    CannotReceiveShares: 'This vault is not accepting new depositors right now.',
    CannotSendAssets:
        'This vault is not accepting deposits from this wallet right now.',
    CannotSendShares:
        'This vault is not allowing withdrawals from this wallet right now.',
    CannotReceiveAssets: 'This vault cannot pay out to this wallet right now.',
};

// Turns a vault revert into a sentence. Unknown reverts become a generic one.
export function vaultRevertMessage(err: unknown): string | undefined {
    if (!(err instanceof BaseError)) {
        return undefined;
    }

    const reverted = err.walk((e) => e instanceof ContractFunctionRevertedError);
    const name =
        reverted instanceof ContractFunctionRevertedError
            ? reverted.data?.errorName
            : undefined;

    return name ? REVERTS[name] : undefined;
}

const usdg = (amount: bigint) => `${formatUnits(amount, 6)} USDG`;

export function createErc4626Adapter(config: VaultConfig, chain: Chain): VaultAdapter {
    const { publicClient, omnibus } = chain;
    const vault = { address: config.address, abi: vaultV2Abi } as const;
    const gate = (
        functionName:
            'canReceiveShares' | 'canSendAssets' | 'canSendShares' | 'canReceiveAssets',
    ) => publicClient.readContract({ ...vault, functionName, args: [omnibus] });
    const preview = (
        functionName: 'previewWithdraw' | 'previewRedeem',
        amount: bigint,
    ) => publicClient.readContract({ ...vault, functionName, args: [amount] });

    // Gates can be switched on with no delay, so they are read before every action.
    async function gates() {
        const [receiveShares, sendAssets, sendShares, receiveAssets] =
            await Promise.all([
                gate('canReceiveShares'),
                gate('canSendAssets'),
                gate('canSendShares'),
                gate('canReceiveAssets'),
            ]);

        return {
            depositsOpen: receiveShares && sendAssets,
            withdrawalsOpen: sendShares && receiveAssets,
        };
    }

    // Sends one call, reporting its hash as soon as it is broadcast, then
    // waits for it. Vault reverts become readable sentences.
    async function run(
        call: Parameters<typeof submit>[1],
        onSent?: (hash: Hex) => void,
    ) {
        try {
            const hash = await send(chain, call);

            onSent?.(hash);

            return await confirm(chain, hash);
        } catch (err) {
            const message = vaultRevertMessage(err);

            throw message ? new ActionError(message) : err;
        }
    }

    return {
        config,

        async readState() {
            const [totalAssets, sharePrice, omnibusShares, g] = await Promise.all([
                publicClient.readContract({ ...vault, functionName: 'totalAssets' }),
                publicClient.readContract({
                    ...vault,
                    functionName: 'convertToAssets',
                    args: [ONE_SHARE],
                }),
                publicClient.readContract({
                    ...vault,
                    functionName: 'balanceOf',
                    args: [omnibus],
                }),
                gates(),
            ]);

            return { totalAssets, sharePrice, omnibusShares, ...g };
        },

        sharesForAssets: (assets) => preview('previewWithdraw', assets),
        assetsForShares: (shares) => preview('previewRedeem', shares),

        async preflight(kind, assets, instantLiquidity) {
            const health = await readWalletHealth(publicClient, 'arbitrumOne', omnibus);

            if (health.paused) {
                return {
                    ok: false,
                    reason: 'USDG transfers are paused by the token issuer.',
                };
            }

            if (health.frozen) {
                return {
                    ok: false,
                    reason: 'The omnibus wallet is frozen by the token issuer.',
                };
            }

            const g = await gates();

            if (kind === 'deposit') {
                if (!g.depositsOpen) {
                    return {
                        ok: false,
                        reason: 'This vault is not accepting deposits right now.',
                    };
                }

                if (health.usdg < assets) {
                    return {
                        ok: false,
                        reason: `The omnibus wallet holds only ${usdg(health.usdg)}.`,
                    };
                }

                return { ok: true };
            }

            if (!g.withdrawalsOpen) {
                return {
                    ok: false,
                    reason: 'This vault is not allowing withdrawals right now.',
                };
            }

            // Morpho Vault V2 pays withdrawals only from idle funds and its
            // liquidity market. Anything larger reverts.
            if (instantLiquidity != null && assets > instantLiquidity) {
                return {
                    ok: false,
                    reason: `Only ${usdg(instantLiquidity)} can be withdrawn from this vault right now.`,
                    maxNow: instantLiquidity,
                };
            }

            return { ok: true };
        },

        async deposit(assets, onSent) {
            const allowance = await publicClient.readContract({
                address: USDG.arbitrumOne.address,
                abi: erc20Abi,
                functionName: 'allowance',
                args: [omnibus, config.address],
            });

            // One standing approval per vault, so each deposit is one transaction.
            if (allowance < assets) {
                await run({
                    address: USDG.arbitrumOne.address,
                    abi: erc20Abi,
                    functionName: 'approve',
                    args: [config.address, maxUint256],
                });
            }

            const receipt = await run(
                { ...vault, functionName: 'deposit', args: [assets, omnibus] },
                onSent,
            );

            return { txHash: receipt.transactionHash, mode: 'sync', amount: assets };
        },

        async withdraw(shares, onSent) {
            const receipt = await run(
                { ...vault, functionName: 'redeem', args: [shares, omnibus, omnibus] },
                onSent,
            );

            return { txHash: receipt.transactionHash, mode: 'sync', amount: shares };
        },

        async settle(sub) {
            const receipt = await receiptOrNull(publicClient, sub.txHash);

            if (!receipt) {
                return null;
            }

            if (receipt.status !== 'success') {
                return { status: 'cancelled', reason: 'The transaction reverted.' };
            }

            const [event] = parseEventLogs({
                abi: vaultV2Abi,
                logs: receipt.logs.filter(
                    (l) => l.address.toLowerCase() === config.address.toLowerCase(),
                ),
            }).filter(
                (e) =>
                    (e.eventName === 'Deposit' || e.eventName === 'Withdraw') &&
                    e.args.onBehalf.toLowerCase() === omnibus.toLowerCase(),
            );

            if (
                !event ||
                (event.eventName !== 'Deposit' && event.eventName !== 'Withdraw')
            ) {
                throw new ActionError(`No vault event in ${sub.txHash}.`);
            }

            return {
                status: 'executed',
                shares: event.args.shares,
                assets: event.args.assets,
            };
        },
    };
}
