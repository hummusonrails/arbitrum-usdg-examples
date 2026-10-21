// The GMX Dollar Vault (GLV [USDG-USDG]) behind the shared vault adapter.
// GLV is not ERC-4626: a deposit or withdrawal is a request that a GMX keeper
// executes a few seconds later with signed oracle prices. So deposit and
// withdraw return a request key, and settle watches GMX's EventEmitter for the
// request's Executed or Cancelled event.
import { readWalletHealth, USDG, usdgAbi } from '@arbitrum-usdg/usdg';
import {
    encodeAbiParameters,
    encodeFunctionData,
    erc20Abi,
    formatEther,
    formatUnits,
    keccak256,
    maxUint256,
    parseEventLogs,
    zeroAddress,
    type Address,
    type Hex,
    type Log,
} from 'viem';

import { dataStoreAbi, eventEmitterAbi, glvRouterAbi } from '../abi.ts';
import { ActionError, submit, type Chain } from '../chain.ts';
import { GMX } from './registry.ts';
import type { VaultAdapter, VaultConfig } from './types.ts';

const usdg = USDG.arbitrumOne.address;
const ONE_SHARE = 10n ** 18n;
// Minimum output is the quoted amount less this, in basis points.
const SLIPPAGE_BPS = 50n;
// GMX's own UI sends about three times the minimum execution fee; the keeper
// refunds whatever it does not use.
const FEE_MULTIPLIER = 3n;

type GlvMarket = { address: Address; balanceUsd: string; isDisabled: boolean };

// GMX DataStore keys are keccak256(abi.encode(name)).
const key = (name: string) =>
    keccak256(encodeAbiParameters([{ type: 'string' }], [name]));

type EventArgs = {
    eventName: string;
    topic1: Hex;
    eventData: {
        uintItems: { items: readonly { key: string; value: bigint }[] };
        stringItems: { items: readonly { key: string; value: string }[] };
    };
};

function gmxEvents(logs: Log[]): (EventArgs & { transactionHash: Hex | null })[] {
    return parseEventLogs({
        abi: eventEmitterAbi,
        logs: logs.filter(
            (l) => l.address.toLowerCase() === GMX.eventEmitter.toLowerCase(),
        ),
    })
        .filter((e) => e.eventName === 'EventLog2')
        .map((e) => ({
            ...(e.args as unknown as EventArgs),
            transactionHash: e.transactionHash,
        }));
}

const uintItem = (e: EventArgs, name: string) =>
    e.eventData.uintItems.items.find((i) => i.key === name)?.value;

export function createGlvAdapter(
    config: VaultConfig,
    chain: Chain,
    gmxApiUrl: string,
): VaultAdapter {
    const { publicClient, omnibus } = chain;
    const glv = config.address;

    async function getJson<T>(path: string): Promise<T> {
        const res = await fetch(`${gmxApiUrl}${path}`, {
            headers: { 'user-agent': 'acme-money-sample' },
        });

        if (!res.ok) {
            throw new ActionError(`GMX API ${path} returned ${res.status}.`);
        }

        return res.json() as Promise<T>;
    }

    // USDG base units for 1e18 GLV, from GMX's price feed. GMX prices carry
    // 30 decimals per whole token, so an 18 decimal token's price per unit has
    // 12; this values one GLV in USD and treats USDG as one dollar.
    async function sharePrice(): Promise<bigint> {
        const tickers =
            await getJson<{ tokenAddress: string; minPrice: string }[]>(
                '/prices/tickers',
            );
        const ticker = tickers.find(
            (t) => t.tokenAddress.toLowerCase() === glv.toLowerCase(),
        );

        if (!ticker) {
            throw new ActionError(
                'GMX did not return a price for the GMX Dollar Vault.',
            );
        }

        return BigInt(ticker.minPrice) / 10n ** 6n;
    }

    async function markets(): Promise<GlvMarket[]> {
        const info = await getJson<{
            glvs: { glvToken: string; markets: GlvMarket[] }[];
        }>('/glvs/info');
        const entry = info.glvs.find(
            (g) => g.glvToken.toLowerCase() === glv.toLowerCase(),
        );

        return (entry?.markets ?? []).filter((m) => !m.isDisabled);
    }

    // Deposits go to the market the vault holds least of, so they stay clear of
    // per market caps. Withdrawals come from the market it holds most of.
    async function pickMarket(kind: 'deposit' | 'withdraw'): Promise<Address> {
        const list = (await markets()).sort((a, b) => {
            const diff = BigInt(a.balanceUsd) - BigInt(b.balanceUsd);

            return diff === 0n ? 0 : diff < 0n ? -1 : 1;
        });
        const market = kind === 'deposit' ? list[0] : list[list.length - 1];

        if (!market) {
            throw new ActionError(
                'The GMX Dollar Vault has no open markets right now.',
            );
        }

        return market.address;
    }

    // GMX checks the fee against its own gas estimate times the gas price.
    async function executionFee(kind: 'deposit' | 'withdraw'): Promise<bigint> {
        const read = (name: string) =>
            publicClient.readContract({
                address: GMX.dataStore,
                abi: dataStoreAbi,
                functionName: 'getUint',
                args: [key(name)],
            });
        const marketCount = BigInt((await markets()).length || 7);
        const [
            base,
            perOracle,
            multiplier,
            glvLimit,
            perMarket,
            marketLimit,
            gasPrice,
        ] = await Promise.all([
            read('ESTIMATED_GAS_FEE_BASE_AMOUNT_V2_1'),
            read('ESTIMATED_GAS_FEE_PER_ORACLE_PRICE'),
            read('ESTIMATED_GAS_FEE_MULTIPLIER_FACTOR'),
            read(
                kind === 'deposit'
                    ? 'GLV_DEPOSIT_GAS_LIMIT'
                    : 'GLV_WITHDRAWAL_GAS_LIMIT',
            ),
            read('GLV_PER_MARKET_GAS_LIMIT'),
            read(kind === 'deposit' ? 'DEPOSIT_GAS_LIMIT' : 'WITHDRAWAL_GAS_LIMIT'),
            publicClient.getGasPrice(),
        ]);
        const estimated = glvLimit + perMarket * marketCount + marketLimit;
        const adjusted =
            base +
            perOracle * (2n + marketCount) +
            (estimated * multiplier) / 10n ** 30n;

        return adjusted * gasPrice * FEE_MULTIPLIER;
    }

    async function approve(token: Address, amount: bigint) {
        const allowance = await publicClient.readContract({
            address: token,
            abi: erc20Abi,
            functionName: 'allowance',
            args: [omnibus, GMX.router],
        });

        if (allowance < amount) {
            await submit(chain, {
                address: token,
                abi: erc20Abi,
                functionName: 'approve',
                args: [GMX.router, maxUint256],
            });
        }
    }

    async function request(token: Address, amount: bigint, create: Hex, fee: bigint) {
        const receipt = await submit(chain, {
            address: GMX.glvRouter,
            abi: glvRouterAbi,
            functionName: 'multicall',
            args: [
                [
                    encodeFunctionData({
                        abi: glvRouterAbi,
                        functionName: 'sendWnt',
                        args: [GMX.glvVault, fee],
                    }),
                    encodeFunctionData({
                        abi: glvRouterAbi,
                        functionName: 'sendTokens',
                        args: [token, GMX.glvVault, amount],
                    }),
                    create,
                ],
            ],
            value: fee,
        });
        const created = gmxEvents(receipt.logs).find((e) =>
            e.eventName.endsWith('Created'),
        );

        if (!created) {
            throw new ActionError(
                `GMX did not record a request in ${receipt.transactionHash}.`,
            );
        }

        return { txHash: receipt.transactionHash, requestKey: created.topic1 };
    }

    return {
        config,

        async readState() {
            const [price, supply, omnibusShares, open] = await Promise.all([
                sharePrice(),
                publicClient.readContract({
                    address: glv,
                    abi: erc20Abi,
                    functionName: 'totalSupply',
                }),
                publicClient.readContract({
                    address: glv,
                    abi: erc20Abi,
                    functionName: 'balanceOf',
                    args: [omnibus],
                }),
                markets().then((m) => m.length > 0),
            ]);

            return {
                totalAssets: (supply * price) / ONE_SHARE,
                sharePrice: price,
                omnibusShares,
                depositsOpen: open,
                withdrawalsOpen: open,
            };
        },

        async sharesForAssets(assets) {
            const price = await sharePrice();

            return (assets * ONE_SHARE + price - 1n) / price;
        },

        async assetsForShares(shares) {
            return (shares * (await sharePrice())) / ONE_SHARE;
        },

        async preflight(kind, assets) {
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

            if ((await markets()).length === 0) {
                return {
                    ok: false,
                    reason: 'The GMX Dollar Vault has no open markets right now.',
                };
            }

            const fee = await executionFee(kind);

            if (health.eth < fee) {
                return {
                    ok: false,
                    reason: `The omnibus wallet needs ${formatEther(fee)} ETH for the GMX keeper fee.`,
                };
            }

            if (kind === 'deposit' && health.usdg < assets) {
                return {
                    ok: false,
                    reason: `The omnibus wallet holds only ${formatUnits(health.usdg, 6)} USDG.`,
                };
            }

            return { ok: true };
        },

        async deposit(assets) {
            const [price, market, fee] = await Promise.all([
                sharePrice(),
                pickMarket('deposit'),
                executionFee('deposit'),
            ]);
            const quoted = (assets * ONE_SHARE) / price;

            await approve(usdg, assets);

            const sent = await request(
                usdg,
                assets,
                encodeFunctionData({
                    abi: glvRouterAbi,
                    functionName: 'createGlvDeposit',
                    args: [
                        {
                            addresses: {
                                glv,
                                market,
                                receiver: omnibus,
                                callbackContract: zeroAddress,
                                uiFeeReceiver: zeroAddress,
                                initialLongToken: usdg,
                                initialShortToken: usdg,
                                longTokenSwapPath: [],
                                shortTokenSwapPath: [],
                            },
                            minGlvTokens: (quoted * (10_000n - SLIPPAGE_BPS)) / 10_000n,
                            executionFee: fee,
                            callbackGasLimit: 0n,
                            shouldUnwrapNativeToken: false,
                            isMarketTokenDeposit: false,
                            dataList: [],
                        },
                    ],
                }),
                fee,
            );

            return { ...sent, mode: 'async', amount: assets };
        },

        async withdraw(shares) {
            const [market, fee] = await Promise.all([
                pickMarket('withdraw'),
                executionFee('withdraw'),
            ]);

            await approve(glv, shares);

            const sent = await request(
                glv,
                shares,
                encodeFunctionData({
                    abi: glvRouterAbi,
                    functionName: 'createGlvWithdrawal',
                    args: [
                        {
                            addresses: {
                                receiver: omnibus,
                                callbackContract: zeroAddress,
                                uiFeeReceiver: zeroAddress,
                                market,
                                glv,
                                longTokenSwapPath: [],
                                shortTokenSwapPath: [],
                            },
                            // Both sides of this market are USDG and GMX decides the
                            // split at execution, so there is no single minimum per
                            // side. The app checks the USDG received when it settles.
                            minLongTokenAmount: 0n,
                            minShortTokenAmount: 0n,
                            shouldUnwrapNativeToken: false,
                            executionFee: fee,
                            callbackGasLimit: 0n,
                            dataList: [],
                        },
                    ],
                }),
                fee,
            );

            return { ...sent, mode: 'async', amount: shares };
        },

        async settle(sub) {
            if (!sub.requestKey) {
                throw new ActionError('A GMX request needs its request key to settle.');
            }

            const created = await publicClient.getTransactionReceipt({
                hash: sub.txHash,
            });
            const logs = await publicClient.getLogs({
                address: GMX.eventEmitter,
                event: eventEmitterAbi[2],
                args: { topic1: sub.requestKey },
                fromBlock: created.blockNumber,
            });
            const done = gmxEvents(logs).find(
                (e) =>
                    e.eventName.endsWith('Executed') ||
                    e.eventName.endsWith('Cancelled'),
            );

            if (!done) {
                return null;
            }

            if (done.eventName.endsWith('Cancelled')) {
                const reason = done.eventData.stringItems.items.find(
                    (i) => i.key === 'reason',
                );

                return {
                    status: 'cancelled',
                    reason: `GMX cancelled the request${reason?.value ? `: ${reason.value}` : ''}. The funds were returned.`,
                };
            }

            if (done.eventName === 'GlvDepositExecuted') {
                const shares = uintItem(done, 'receivedGlvTokens');

                if (shares === undefined) {
                    throw new ActionError(
                        'GlvDepositExecuted had no receivedGlvTokens.',
                    );
                }

                return { status: 'executed', shares, assets: sub.amount };
            }

            // A withdrawal's event carries no amounts, so the USDG paid to the
            // omnibus wallet is read from the keeper's transaction.
            const receipt = await publicClient.getTransactionReceipt({
                hash: done.transactionHash!,
            });
            const paid = parseEventLogs({
                abi: usdgAbi,
                eventName: 'Transfer',
                logs: receipt.logs,
            })
                .filter(
                    (t) =>
                        t.address.toLowerCase() === usdg.toLowerCase() &&
                        t.args.to.toLowerCase() === omnibus.toLowerCase(),
                )
                .reduce((sum, t) => sum + t.args.value, 0n);

            return { status: 'executed', shares: sub.amount, assets: paid };
        },
    };
}
