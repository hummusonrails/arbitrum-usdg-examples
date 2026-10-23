// Fork probe: checks, on fresh forks of Arbitrum One and Ethereum, every
// contract call the spot DEX example depends on, before anything is built on them.
import { acmePoolAbi } from '@arbitrum-usdg/spot-dex-contracts';
import {
    createPayoutGroup,
    startAnvil,
    startRelay,
    waitFor,
} from '@arbitrum-usdg/spot-dex-fork-services';
import {
    OFT,
    oftAbi,
    toBytes32,
    USDG,
    USDG_ETHEREUM,
    usdgAbi,
    usdgRewardsAbi,
} from '@arbitrum-usdg/usdg';
import { erc20Abi, parseEventLogs, type Address } from 'viem';
import { generatePrivateKey, privateKeyToAccount } from 'viem/accounts';
import { arbitrum as arbitrumChain, mainnet } from 'viem/chains';

import { POOLS } from '../src/server/registry.ts';
import { addLiquidity, approve, deployAndSeed, fund, walletOn } from './setup.ts';

const usdg = USDG.arbitrumOne.address;
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

const arb = await startAnvil({ port: 8655, chain: arbitrumChain });
const eth = await startAnvil({ port: 8656, chain: mainnet });
const operatorKey = generatePrivateKey();
const lpKey = generatePrivateKey();
const operator = privateKeyToAccount(operatorKey).address;
const lp = privateKeyToAccount(lpKey).address;
const opArb = walletOn(arb.client, operatorKey);
let pool: Address = '0x';
let group = 0;

try {
    await check('1. Both forks start and funding holders hold enough', async () => {
        await fund(arb.client, eth.client, operatorKey, {
            usdg: 120_000n * 10n ** 6n,
            usdgEthereum: 0n,
            weth: 20n * 10n ** 18n,
            arb: 0n,
        });
        await fund(arb.client, eth.client, lpKey, {
            usdg: 50_000n * 10n ** 6n,
            usdgEthereum: 20_000n * 10n ** 6n,
            weth: 5n * 10n ** 18n,
            arb: 50_000n * 10n ** 18n,
        });

        const arbBalance = await arb.client.readContract({
            address: POOLS.arb.base.address,
            abi: erc20Abi,
            functionName: 'balanceOf',
            args: [lp],
        });

        return `Arbitrum block ${await arb.client.getBlockNumber()}, Ethereum block ${await eth.client.getBlockNumber()}, LP holds ${arbBalance / 10n ** 18n} ARB`;
    });

    await check('2. Deploy WETH/USDG and seed it at the Chainlink price', async () => {
        pool = await deployAndSeed(arb.client, opArb, POOLS.weth);

        const [base, quote] = await arb.client.readContract({
            address: pool,
            abi: acmePoolAbi,
            functionName: 'getReserves',
        });

        await addLiquidity(
            arb.client,
            walletOn(arb.client, lpKey),
            POOLS.weth,
            pool,
            5n * 10n ** 18n,
            50_000n * 10n ** 6n,
        );

        return `pool ${pool}: ${base / 10n ** 18n} WETH and ${quote / 10n ** 6n} USDG; an LP added 5 WETH`;
    });

    await check(
        '3. Payout group with the operator as claimer, manager, and destination',
        async () => {
            group = await createPayoutGroup(arb.client, {
                claimer: operator,
                manager: operator,
                destination: operator,
            });

            const destination = await arb.client.readContract({
                address: usdg,
                abi: usdgRewardsAbi,
                functionName: 'getPayoutGroupDestination',
                args: [group],
            });

            if (destination.toLowerCase() !== operator.toLowerCase()) {
                throw new Error(`destination is ${destination}`);
            }

            return `payout group ${group}`;
        },
    );

    await check('4. Propose, then the pool accepts', async () => {
        await arb.client.waitForTransactionReceipt({
            hash: await opArb.writeContract({
                address: usdg,
                abi: usdgRewardsAbi,
                functionName: 'proposeRegisterRewardAddress',
                args: [group, pool],
            }),
        });

        const pending = await arb.client.readContract({
            address: usdg,
            abi: usdgRewardsAbi,
            functionName: 'getPendingRegistration',
            args: [pool],
        });

        await arb.client.waitForTransactionReceipt({
            hash: await opArb.writeContract({
                address: pool,
                abi: acmePoolAbi,
                functionName: 'acceptRewardsRegistration',
                args: [group],
            }),
        });

        const registered = await arb.client.readContract({
            address: usdg,
            abi: usdgRewardsAbi,
            functionName: 'payoutGroupIdOf',
            args: [pool],
        });

        if (registered !== group) {
            throw new Error(`payoutGroupIdOf is ${registered}`);
        }

        return `pending (${pending[0]}, ${pending[1]}), then payoutGroupIdOf = ${registered}`;
    });

    let claimed = 0n;

    await check('5. Rewards accrue over 7 days and claim to the operator', async () => {
        await arb.client.increaseTime({ seconds: 7 * 86_400 });
        await arb.client.mine({ blocks: 1 });

        const available = await arb.client.readContract({
            address: usdg,
            abi: usdgRewardsAbi,
            functionName: 'availableRewardsOf',
            args: [pool],
        });
        const poolBefore = await arb.client.readContract({
            address: usdg,
            abi: usdgAbi,
            functionName: 'balanceOf',
            args: [pool],
        });
        const receipt = await arb.client.waitForTransactionReceipt({
            hash: await opArb.writeContract({
                address: usdg,
                abi: usdgRewardsAbi,
                functionName: 'claimForAddresses',
                args: [group, [pool]],
            }),
        });
        const transfers = parseEventLogs({
            abi: erc20Abi,
            eventName: 'Transfer',
            logs: receipt.logs,
            args: { to: operator },
        });
        const poolAfter = await arb.client.readContract({
            address: usdg,
            abi: usdgAbi,
            functionName: 'balanceOf',
            args: [pool],
        });

        claimed = transfers.reduce((sum, t) => sum + t.args.value, 0n);

        if (available === 0n || claimed !== available || poolBefore !== poolAfter) {
            throw new Error(
                `available ${available}, claimed ${claimed}, pool ${poolBefore} then ${poolAfter}`,
            );
        }

        return `available ${available} = claimed ${claimed} USDG units; pool balance unchanged`;
    });

    await check('6. Route the claim to LPs', async () => {
        await approve(arb.client, opArb, usdg, pool);
        await arb.client.waitForTransactionReceipt({
            hash: await opArb.writeContract({
                address: pool,
                abi: acmePoolAbi,
                functionName: 'notifyRewards',
                args: [claimed],
            }),
        });

        const read = (account: Address) =>
            arb.client.readContract({
                address: pool,
                abi: acmePoolAbi,
                functionName: 'pendingRewards',
                args: [account],
            });

        return `operator pending ${await read(operator)}, LP pending ${await read(lp)} of ${claimed}`;
    });

    await check('7. USDG moves both ways through the OFT and the relay', async () => {
        const relay = await startRelay({
            arbitrum: arb.client,
            ethereum: eth.client,
            delayMs: 500,
        });
        const lpArb = walletOn(arb.client, lpKey);
        const lpEth = walletOn(eth.client, lpKey);
        const legs = [
            {
                from: lpArb,
                client: arb.client,
                oft: OFT.arbitrumOne,
                to: OFT.ethereum,
                toClient: eth.client,
                token: USDG_ETHEREUM,
            },
            {
                from: lpEth,
                client: eth.client,
                oft: OFT.ethereum,
                to: OFT.arbitrumOne,
                toClient: arb.client,
                token: usdg,
            },
        ];
        const lines: string[] = [];

        try {
            for (const leg of legs) {
                const amount = 1_000n * 10n ** 6n;
                const param = {
                    dstEid: leg.to.eid,
                    to: toBytes32(lp),
                    amountLD: amount,
                    minAmountLD: amount,
                    extraOptions: '0x',
                    composeMsg: '0x',
                    oftCmd: '0x',
                } as const;
                const fee = await leg.client.readContract({
                    address: leg.oft.address,
                    abi: oftAbi,
                    functionName: 'quoteSend',
                    args: [param, false],
                });
                const [, canSend] = await leg.client.readContract({
                    address: leg.oft.address,
                    abi: oftAbi,
                    functionName: 'getAmountCanBeSent',
                    args: [leg.to.eid],
                });
                const balance = () =>
                    leg.toClient.readContract({
                        address: leg.token,
                        abi: erc20Abi,
                        functionName: 'balanceOf',
                        args: [lp],
                    });
                const before = await balance();

                await leg.client.waitForTransactionReceipt({
                    hash: await leg.from.writeContract({
                        address: leg.oft.address,
                        abi: oftAbi,
                        functionName: 'send',
                        args: [param, fee, lp],
                        value: fee.nativeFee,
                    }),
                });
                await waitFor(
                    'delivery',
                    async () => (await balance()) - before === amount,
                    30_000,
                );
                lines.push(
                    `eid ${leg.oft.eid} to ${leg.to.eid}: fee ${fee.nativeFee} wei, can send ${canSend}, delivered ${amount}`,
                );
            }
        } finally {
            await relay.close();
        }

        return lines.join('\n');
    });
} finally {
    arb.stop();
    eth.stop();
}

process.exit(failed ? 1 : 0);
