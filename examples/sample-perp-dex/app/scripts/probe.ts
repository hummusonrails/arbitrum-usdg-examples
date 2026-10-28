// Fork probe: checks, on a fresh fork of Arbitrum One, every contract call the
// perp DEX example depends on, before anything is built on them.
import { acmeMarginVaultAbi } from '@arbitrum-usdg/perp-dex-contracts';
import {
    asAccount,
    createPayoutGroup,
    startAnvil,
} from '@arbitrum-usdg/perp-dex-fork-services';
import { USDG, usdgAuthorizationAbi, usdgRewardsAbi } from '@arbitrum-usdg/usdg';
import {
    BaseError,
    ContractFunctionRevertedError,
    erc20Abi,
    getAddress,
    isAddressEqual,
    parseEventLogs,
    type Address,
    type Hex,
} from 'viem';
import { generatePrivateKey, privateKeyToAccount } from 'viem/accounts';

import {
    depositArgs,
    signDeposit,
    type SignedDeposit,
} from '../src/server/authorize.ts';
import { mined } from '../src/server/funding.ts';
import { feedPrice } from '../src/server/prices.ts';
import { chainlinkAbi, MARKETS } from '../src/server/registry.ts';
import { deployExchange, fund, pushPrices, walletOn } from './setup.ts';

const usdg = USDG.arbitrumOne.address;
const units = (n: number) => BigInt(n) * 10n ** 6n;
const show = (u: bigint) => `${Number(u) / 1e6} USDG`;
let failed = false;

async function check(name: string, fn: () => Promise<string>) {
    try {
        console.log(`PASS ${name}\n  ${(await fn()).replaceAll('\n', '\n  ')}`);
    } catch (err) {
        failed = true;
        console.log(
            `FAIL ${name}\n  ${err instanceof Error ? err.message.split('\n')[0] : err}`,
        );
    }
}

function assert(ok: boolean, message: string) {
    if (!ok) {
        throw new Error(message);
    }
}

const arb = await startAnvil({ port: 8665 });
const client = arb.client;
const operatorKey = generatePrivateKey();
const keeperKey = generatePrivateKey();
const traderKeys = [generatePrivateKey(), generatePrivateKey()];
const operator = privateKeyToAccount(operatorKey).address;
const traders = traderKeys.map((k) => privateKeyToAccount(k));
const op = walletOn(client, operatorKey);
const keeper = walletOn(client, keeperKey);
let vault: Address = '0x';
let oracle: Address = '0x';
let group = 0;
let firstDeposit: SignedDeposit | undefined;

const read = <T>(functionName: string, args: readonly unknown[] = []) =>
    client.readContract({
        address: vault,
        abi: acmeMarginVaultAbi,
        functionName,
        args,
    } as never) as Promise<T>;
const balanceOf = (who: Address) =>
    client.readContract({
        address: usdg,
        abi: erc20Abi,
        functionName: 'balanceOf',
        args: [who],
    });
const blockTime = async () => (await client.getBlock()).timestamp;

async function relay(d: SignedDeposit) {
    return mined(
        client,
        await keeper.writeContract({
            address: vault,
            abi: acmeMarginVaultAbi,
            functionName: 'depositWithAuthorization',
            args: depositArgs(d),
        }),
    );
}

// What the vault owes, from its own totals. Its USDG balance must equal it.
async function books() {
    const [free, collateral, liquidity, held] = await Promise.all([
        read<bigint>('totalFreeMargin'),
        read<bigint>('totalCollateral'),
        read<bigint>('liquidity'),
        read<bigint>('rewardsHeld'),
    ]);

    return free + collateral + liquidity + held;
}

async function advance(days: number) {
    await client.increaseTime({ seconds: days * 86_400 });
    await client.mine({ blocks: 1 });
}

try {
    await check(
        '1. The fork starts, the feeds answer, and the holders fund the demo',
        async () => {
            await fund(client, operatorKey, units(300_000));
            await fund(client, keeperKey, 0n);

            for (const k of traderKeys) {
                await fund(client, k, units(300_000));
            }

            const lines = [`Arbitrum block ${await client.getBlockNumber()}`];

            for (const def of Object.values(MARKETS)) {
                const description = await client.readContract({
                    address: def.feed,
                    abi: chainlinkAbi,
                    functionName: 'description',
                });

                assert(
                    description.replaceAll(' ', '') === def.name.replace('-', '/'),
                    `${def.feed} is ${description}`,
                );
                lines.push(
                    `${description}: ${Number(await feedPrice(client, def)) / 1e8}`,
                );
            }

            return lines.join('\n');
        },
    );

    await check(
        '2. Deploy the oracle and vault, list both markets, seed the house',
        async () => {
            ({ vault, oracle } = await deployExchange(
                client,
                op,
                keeper,
                units(250_000),
            ));
            vault = getAddress(vault);
            oracle = getAddress(oracle);

            const liquidity = await read<bigint>('liquidity');

            assert(liquidity === units(250_000), `liquidity ${liquidity}`);
            assert((await balanceOf(vault)) === liquidity, 'vault balance differs');

            return `oracle ${oracle}, vault ${vault}, liquidity ${show(liquidity)}`;
        },
    );

    await check('3. The registrar stand in creates a payout group', async () => {
        group = await createPayoutGroup(client, {
            claimer: operator,
            manager: operator,
            destination: operator,
        });

        const claimer = await client.readContract({
            address: usdg,
            abi: usdgRewardsAbi,
            functionName: 'getPayoutGroupClaimer',
            args: [group],
        });

        assert(claimer === operator, `claimer ${claimer}`);

        return `group ${group}, claimer and destination ${operator}`;
    });

    await check(
        '4. A signed deposit through receiveWithAuthorization credits the signer',
        async () => {
            const [ana] = traders;
            const d = await signDeposit(ana!, vault, units(20_000), await blockTime());
            const before = await balanceOf(ana!.address);
            const receipt = await relay(d);
            const used = parseEventLogs({
                abi: usdgAuthorizationAbi,
                eventName: 'AuthorizationUsed',
                logs: receipt.logs,
            });
            const free = await read<bigint>('freeMargin', [ana!.address]);

            firstDeposit = d;
            assert(free === units(20_000), `free margin ${free}`);
            assert(
                before - (await balanceOf(ana!.address)) === units(20_000),
                'trader balance',
            );
            assert(
                used.length === 1 && used[0]!.args.nonce === d.nonce,
                'no AuthorizationUsed',
            );
            assert(
                receipt.from.toLowerCase() === keeper.account.address.toLowerCase(),
                'relayer',
            );

            return `relayed by the keeper, ${show(free)} credited to the trader, gas ${receipt.gasUsed}`;
        },
    );

    await check(
        '5. A replayed authorization moves nothing, and the vault refuses it',
        async () => {
            const d = firstDeposit!;
            const vaultBefore = await balanceOf(vault);
            // Straight to USDG, as the vault: no revert, no transfer.
            const direct = await asAccount(client, vault, async () =>
                client.waitForTransactionReceipt({
                    hash: await client.writeContract({
                        account: vault,
                        chain: client.chain,
                        address: usdg,
                        abi: usdgAuthorizationAbi,
                        functionName: 'receiveWithAuthorization',
                        args: [
                            d.from,
                            d.to,
                            d.value,
                            d.validAfter,
                            d.validBefore,
                            d.nonce,
                            d.signature,
                        ],
                    }),
                }),
            );
            const already = parseEventLogs({
                abi: usdgAuthorizationAbi,
                eventName: 'AuthorizationAlreadyUsed',
                logs: direct.logs,
            });

            assert(direct.status === 'success', 'direct replay reverted');
            assert(already.length === 1, 'no AuthorizationAlreadyUsed');
            assert((await balanceOf(vault)) === vaultBefore, 'USDG moved on replay');

            let refusal = '';

            try {
                await client.simulateContract({
                    account: keeper.account,
                    address: vault,
                    abi: acmeMarginVaultAbi,
                    functionName: 'depositWithAuthorization',
                    args: depositArgs(d),
                });
            } catch (err) {
                const reverted =
                    err instanceof BaseError
                        ? err.walk((e) => e instanceof ContractFunctionRevertedError)
                        : null;

                refusal =
                    reverted instanceof ContractFunctionRevertedError
                        ? (reverted.data?.errorName ?? reverted.raw ?? 'no data')
                        : String(err);
            }

            assert(
                refusal.includes('DepositNotReceived'),
                `vault replay: ${refusal || 'accepted'}`,
            );

            return `USDG emitted AuthorizationAlreadyUsed with status success; the vault reverted DepositNotReceived`;
        },
    );

    await check('6. Propose, then the vault accepts its own registration', async () => {
        await mined(
            client,
            await op.writeContract({
                address: usdg,
                abi: usdgRewardsAbi,
                functionName: 'proposeRegisterRewardAddress',
                args: [group, vault],
            }),
        );

        const [pendingGroup, proposer] = await client.readContract({
            address: usdg,
            abi: usdgRewardsAbi,
            functionName: 'getPendingRegistration',
            args: [vault],
        });

        assert(pendingGroup === group && proposer === operator, 'pending registration');

        const receipt = await mined(
            client,
            await op.writeContract({
                address: vault,
                abi: acmeMarginVaultAbi,
                functionName: 'acceptRewardsRegistration',
                args: [group],
            }),
        );
        const registered = await client.readContract({
            address: usdg,
            abi: usdgRewardsAbi,
            functionName: 'payoutGroupIdOf',
            args: [vault],
        });

        assert(registered === group, `payoutGroupIdOf ${registered}`);

        const events = parseEventLogs({ abi: usdgRewardsAbi, logs: receipt.logs }).map(
            (l) => l.eventName,
        );

        return `pending (${pendingGroup}, ${proposer}); after accept payoutGroupIdOf(vault) = ${registered}; events ${events.join(', ')}`;
    });

    await check('7. Accrual follows the vault balance', async () => {
        const available = () =>
            client.readContract({
                address: usdg,
                abi: usdgRewardsAbi,
                functionName: 'availableRewardsOf',
                args: [vault],
            });
        const balance1 = await balanceOf(vault);
        const start = await available();

        await advance(7);

        const week1 = (await available()) - start;
        // Double the vault's balance with a second trader's deposit.
        const [, kofi] = traders;

        await relay(await signDeposit(kofi!, vault, balance1, await blockTime()));

        const balance2 = await balanceOf(vault);
        const mid = await available();

        await advance(7);

        const week2 = (await available()) - mid;
        const ratio = Number((week2 * 10_000n) / week1) / 10_000;
        const expected = Number((balance2 * 10_000n) / balance1) / 10_000;

        assert(week1 > 0n, 'nothing accrued');
        assert(
            Math.abs(ratio - expected) < 0.01,
            `ratio ${ratio}, expected ${expected}`,
        );

        return `week 1 on ${show(balance1)}: ${show(week1)}; week 2 on ${show(balance2)}: ${show(week2)} (x${ratio}, balance x${expected})`;
    });

    await check(
        '8. claimForAddresses pays the operator and leaves the vault untouched',
        async () => {
            const vaultBefore = await balanceOf(vault);
            const opBefore = await balanceOf(operator);
            const receipt = await mined(
                client,
                await op.writeContract({
                    address: usdg,
                    abi: usdgRewardsAbi,
                    functionName: 'claimForAddresses',
                    args: [group, [vault]],
                }),
            );
            const [claim] = parseEventLogs({
                abi: usdgRewardsAbi,
                eventName: 'RewardsClaimed',
                logs: receipt.logs,
            });
            const paid = (await balanceOf(operator)) - opBefore;
            const left = await client.readContract({
                address: usdg,
                abi: usdgRewardsAbi,
                functionName: 'availableRewardsOf',
                args: [vault],
            });

            assert(
                !!claim && isAddressEqual(claim.args.account, vault),
                'RewardsClaimed account',
            );
            assert(
                claim?.args.amount === paid,
                `event ${claim?.args.amount}, paid ${paid}`,
            );
            assert((await balanceOf(vault)) === vaultBefore, 'vault balance moved');
            assert(left === 0n, `left ${left}`);

            return `operator received ${show(paid)}; RewardsClaimed matches; vault balance unchanged`;
        },
    );

    await check(
        '9. notifyRewards splits between the house and the traders by balance',
        async () => {
            const amount = units(100);
            const [free, collateral, liquidity] = await Promise.all([
                read<bigint>('totalFreeMargin'),
                read<bigint>('totalCollateral'),
                read<bigint>('liquidity'),
            ]);
            const toLiquidity = (amount * liquidity) / (free + collateral + liquidity);

            await mined(
                client,
                await op.writeContract({
                    address: vault,
                    abi: acmeMarginVaultAbi,
                    functionName: 'notifyRewards',
                    args: [amount],
                }),
            );

            const pending = await Promise.all(
                traders.map((t) => read<bigint>('pendingRewards', [t.address])),
            );
            const toTraders = pending.reduce((a, b) => a + b, 0n);

            assert(
                (await read<bigint>('liquidity')) === liquidity + toLiquidity,
                'house share',
            );
            assert(amount - toLiquidity - toTraders <= 2n, `traders ${toTraders}`);
            assert((await balanceOf(vault)) === (await books()), 'books');

            return `house ${show(toLiquidity)}, traders ${pending.map(show).join(' and ')}`;
        },
    );

    await check(
        '10. Trade, move the market, close, and liquidate on the oracle price',
        async () => {
            const [ana, kofi] = traders;
            const eth = MARKETS.eth.key;
            const as = (k: Hex) => walletOn(client, k);

            // The clock moved two weeks, so the keeper pushes fresh prices first.
            await pushPrices(client, keeper, oracle);

            const write = async (
                k: Hex,
                functionName: string,
                args: readonly unknown[],
            ) =>
                mined(
                    client,
                    await as(k).writeContract({
                        address: vault,
                        abi: acmeMarginVaultAbi,
                        functionName,
                        args,
                    } as never),
                );

            await write(traderKeys[0]!, 'openPosition', [
                eth,
                true,
                units(1_000),
                units(5_000),
                2n ** 255n,
            ]);
            await write(traderKeys[1]!, 'openPosition', [
                eth,
                true,
                units(1_000),
                units(10_000),
                2n ** 255n,
            ]);
            await pushPrices(client, keeper, oracle, { eth: 500 });

            const pnl = await read<bigint>('pnlOf', [ana!.address, eth]);
            const freeBefore = await read<bigint>('freeMargin', [ana!.address]);

            await write(traderKeys[0]!, 'closePosition', [eth, 0n]);

            const payout =
                (await read<bigint>('freeMargin', [ana!.address])) - freeBefore;

            assert(
                payout === units(1_000) + pnl - units(5),
                `payout ${payout}, pnl ${pnl}`,
            );

            await pushPrices(client, keeper, oracle, { eth: -1_000 });

            assert(
                await read<boolean>('isLiquidatable', [kofi!.address, eth]),
                'not liquidatable',
            );

            const receipt = await mined(
                client,
                await keeper.writeContract({
                    address: vault,
                    abi: acmeMarginVaultAbi,
                    functionName: 'liquidate',
                    args: [kofi!.address, eth],
                }),
            );
            const [liquidated] = parseEventLogs({
                abi: acmeMarginVaultAbi,
                eventName: 'PositionLiquidated',
                logs: receipt.logs,
            });

            assert((await balanceOf(vault)) === (await books()), 'books');
            assert((await read<bigint>('reservedLiquidity')) === 0n, 'reserve left');

            return `5x long closed at +5%: pnl ${show(pnl)}, payout ${show(payout)}; 10x long at -10% liquidated with pnl ${show(liquidated!.args.pnl)}; vault balance equals its books`;
        },
    );
} finally {
    arb.stop();
}

process.exit(failed ? 1 : 0);
