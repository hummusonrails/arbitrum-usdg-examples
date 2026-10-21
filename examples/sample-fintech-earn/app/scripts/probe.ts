// Fork probe: checks, on a fresh fork of Arbitrum One, every contract call and
// API the embedded earn example depends on, before anything is built on them.
import { USDG } from '@arbitrum-usdg/usdg';
import {
    executeRequest,
    fundUsdg,
    asAccount,
    startAnvil,
} from '@arbitrum-usdg/earn-fork-services';
import {
    createWalletClient,
    decodeEventLog,
    encodeAbiParameters,
    encodeFunctionData,
    erc20Abi,
    http,
    keccak256,
    parseEventLogs,
    zeroAddress,
    type Address,
    type Hex,
} from 'viem';
import { generatePrivateKey, privateKeyToAccount } from 'viem/accounts';
import { arbitrum } from 'viem/chains';

import {
    accessControlManagerAbi,
    eventEmitterAbi,
    glvRouterAbi,
    merklDistributorAbi,
    roleStoreAbi,
    vaultV2Abi,
} from '../src/server/abi.ts';
import {
    ARB_TOKEN,
    FORK_USDG_HOLDER,
    GMX,
    MERKL_DISTRIBUTOR,
    VAULTS,
} from '../src/server/vaults/registry.ts';

const usdg = USDG.arbitrumOne.address;
const results: { name: string; ok: boolean; detail: string }[] = [];

async function check(name: string, fn: () => Promise<string>) {
    try {
        const detail = await fn();

        results.push({ name, ok: true, detail });
        console.log(`PASS ${name}\n  ${detail.replaceAll('\n', '\n  ')}`);
    } catch (err) {
        const detail = err instanceof Error ? err.message.split('\n')[0]! : String(err);

        results.push({ name, ok: false, detail });
        console.log(`FAIL ${name}\n  ${detail}`);
    }
}

const fork = await startAnvil({ port: 8555 });
const { client } = fork;
const key = generatePrivateKey();
const account = privateKeyToAccount(key);
const me = account.address;
const wallet = createWalletClient({
    account,
    chain: arbitrum,
    transport: http(fork.rpcUrl, { timeout: 120_000 }),
});

await client.setBalance({ address: me, value: 10n ** 18n });
await fundUsdg(client, FORK_USDG_HOLDER, me, 5_000_000_000n);

async function send(to: Address, data: Hex, value = 0n) {
    // Simulate first so a revert reports its reason.
    await client.call({ account: me, to, data, value });

    const hash = await wallet.sendTransaction({ to, data, value });
    const receipt = await client.waitForTransactionReceipt({ hash });

    if (receipt.status !== 'success') {
        throw new Error(`tx ${hash} reverted`);
    }

    return receipt;
}

// 1. Morpho Vault V2 deposit and redeem from a fresh wallet.
await check('morpho deposit and redeem', async () => {
    const lines: string[] = [];

    for (const vault of [VAULTS.steakhouse, VAULTS.gauntlet]) {
        await send(
            usdg,
            encodeFunctionData({
                abi: erc20Abi,
                functionName: 'approve',
                args: [vault.address, 1_000_000_000n],
            }),
        );
        const dep = await send(
            vault.address,
            encodeFunctionData({
                abi: vaultV2Abi,
                functionName: 'deposit',
                args: [1_000_000_000n, me],
            }),
        );
        const [d] = parseEventLogs({
            abi: vaultV2Abi,
            eventName: 'Deposit',
            logs: dep.logs,
        });
        const shares = d!.args.shares;
        const red = await send(
            vault.address,
            encodeFunctionData({
                abi: vaultV2Abi,
                functionName: 'redeem',
                args: [shares, me, me],
            }),
        );
        const [w] = parseEventLogs({
            abi: vaultV2Abi,
            eventName: 'Withdraw',
            logs: red.logs,
        });

        lines.push(
            `${vault.name}: 1000 USDG -> ${shares} shares -> ${w!.args.assets} USDG units`,
        );
    }

    return lines.join('\n');
});

// 2. GLV deposit, keeper execution, withdrawal, and the early cancel path.
const BTC_MARKET: Address = '0xe57B97F2f83F39E74Ec83f3e039FD370884784fF';
// Generous so it covers the fork's gas price; any excess is refunded.
const FEE = 50_000_000_000_000_000n;

function glvEvents(
    logs: { address: Address; data: Hex; topics: [Hex, ...Hex[]] | [] }[],
) {
    return logs
        .filter((l) => l.address.toLowerCase() === GMX.eventEmitter.toLowerCase())
        .map((l) =>
            decodeEventLog({ abi: eventEmitterAbi, data: l.data, topics: l.topics }),
        )
        .map((e) => ({ topic1: '0x' as Hex, ...e.args }));
}

type KeyValues<T> = { items: readonly { key: string; value: T }[] };

function describe(args: ReturnType<typeof glvEvents>[number]) {
    const d = (
        args as unknown as {
            eventData: {
                uintItems: KeyValues<bigint>;
                bytesItems: KeyValues<Hex>;
                stringItems: KeyValues<string>;
            };
        }
    ).eventData;
    const uints = d.uintItems.items.map((i) => `${i.key}=${i.value}`).join(' ');
    const bytes = d.bytesItems.items
        .map((i) => `${i.key}=${i.value.slice(0, 18)}`)
        .join(' ');
    const strs = d.stringItems.items.map((i) => `${i.key}=${i.value}`).join(' ');

    return `${args.eventName}: ${uints} ${bytes} ${strs}`.trim();
}

async function createGlvDeposit(amount: bigint): Promise<Hex> {
    const receipt = await send(
        GMX.glvRouter,
        encodeFunctionData({
            abi: glvRouterAbi,
            functionName: 'multicall',
            args: [
                [
                    encodeFunctionData({
                        abi: glvRouterAbi,
                        functionName: 'sendWnt',
                        args: [GMX.glvVault, FEE],
                    }),
                    encodeFunctionData({
                        abi: glvRouterAbi,
                        functionName: 'sendTokens',
                        args: [usdg, GMX.glvVault, amount],
                    }),
                    encodeFunctionData({
                        abi: glvRouterAbi,
                        functionName: 'createGlvDeposit',
                        args: [
                            {
                                addresses: {
                                    glv: VAULTS.glv.address,
                                    market: BTC_MARKET,
                                    receiver: me,
                                    callbackContract: zeroAddress,
                                    uiFeeReceiver: zeroAddress,
                                    initialLongToken: usdg,
                                    initialShortToken: usdg,
                                    longTokenSwapPath: [],
                                    shortTokenSwapPath: [],
                                },
                                minGlvTokens: 0n,
                                executionFee: FEE,
                                callbackGasLimit: 0n,
                                shouldUnwrapNativeToken: false,
                                isMarketTokenDeposit: false,
                                dataList: [],
                            },
                        ],
                    }),
                ],
            ],
        }),
        FEE,
    );
    const created = glvEvents(receipt.logs).find(
        (e) => e.eventName === 'GlvDepositCreated',
    );

    if (!created) {
        throw new Error('no GlvDepositCreated event');
    }

    return created.topic1;
}

await check('glv deposit, keeper, withdrawal', async () => {
    const lines: string[] = [];

    await send(
        usdg,
        encodeFunctionData({
            abi: erc20Abi,
            functionName: 'approve',
            args: [GMX.router, 10n ** 12n],
        }),
    );

    const depKey = await createGlvDeposit(1_000_000_000n);
    const execHash = await executeRequest(client, 'deposit', depKey);
    const exec = await client.getTransactionReceipt({ hash: execHash });

    lines.push(`deposit key ${depKey}`);

    for (const e of glvEvents(exec.logs).filter((e) =>
        e.eventName.startsWith('GlvDeposit'),
    )) {
        lines.push(describe(e));
    }

    const glvBal = await client.readContract({
        address: VAULTS.glv.address,
        abi: erc20Abi,
        functionName: 'balanceOf',
        args: [me],
    });

    lines.push(`GLV balance ${glvBal}`);

    await send(
        VAULTS.glv.address,
        encodeFunctionData({
            abi: erc20Abi,
            functionName: 'approve',
            args: [GMX.router, glvBal],
        }),
    );

    const usdgBefore = await client.readContract({
        address: usdg,
        abi: erc20Abi,
        functionName: 'balanceOf',
        args: [me],
    });
    const wr = await send(
        GMX.glvRouter,
        encodeFunctionData({
            abi: glvRouterAbi,
            functionName: 'multicall',
            args: [
                [
                    encodeFunctionData({
                        abi: glvRouterAbi,
                        functionName: 'sendWnt',
                        args: [GMX.glvVault, FEE],
                    }),
                    encodeFunctionData({
                        abi: glvRouterAbi,
                        functionName: 'sendTokens',
                        args: [VAULTS.glv.address, GMX.glvVault, glvBal],
                    }),
                    encodeFunctionData({
                        abi: glvRouterAbi,
                        functionName: 'createGlvWithdrawal',
                        args: [
                            {
                                addresses: {
                                    receiver: me,
                                    callbackContract: zeroAddress,
                                    uiFeeReceiver: zeroAddress,
                                    market: BTC_MARKET,
                                    glv: VAULTS.glv.address,
                                    longTokenSwapPath: [],
                                    shortTokenSwapPath: [],
                                },
                                minLongTokenAmount: 0n,
                                minShortTokenAmount: 0n,
                                shouldUnwrapNativeToken: false,
                                executionFee: FEE,
                                callbackGasLimit: 0n,
                                dataList: [],
                            },
                        ],
                    }),
                ],
            ],
        }),
        FEE,
    );
    const wCreated = glvEvents(wr.logs).find(
        (e) => e.eventName === 'GlvWithdrawalCreated',
    );

    if (!wCreated) {
        throw new Error('no GlvWithdrawalCreated event');
    }

    const wExecHash = await executeRequest(client, 'withdrawal', wCreated.topic1);
    const wExec = await client.getTransactionReceipt({ hash: wExecHash });

    lines.push(
        `withdrawal exec ${wExec.status}: ${glvEvents(wExec.logs)
            .map((e) => e.eventName)
            .join(', ')}`,
    );

    for (const e of glvEvents(wExec.logs).filter((e) =>
        e.eventName.startsWith('GlvWithdrawal'),
    )) {
        lines.push(describe(e));
    }

    const usdgAfter = await client.readContract({
        address: usdg,
        abi: erc20Abi,
        functionName: 'balanceOf',
        args: [me],
    });

    lines.push(`USDG returned ${usdgAfter - usdgBefore}`);

    // A request can only be cancelled by its creator after 300 seconds.
    const pendingKey = await createGlvDeposit(100_000_000n);
    let early = 'unexpectedly succeeded';

    try {
        await client.simulateContract({
            account: me,
            address: GMX.glvRouter,
            abi: glvRouterAbi,
            functionName: 'cancelGlvDeposit',
            args: [pendingKey],
        });
    } catch (err) {
        early = `reverted as expected (${(err as Error).message.split('\n')[0]})`;
    }

    lines.push(`early cancel ${early}`);
    // Leave the pending request for the keeper so the fork is tidy.
    await executeRequest(client, 'deposit', pendingKey);

    return lines.join('\n');
});

// 3. Merkl: post a root to the real Distributor and claim against it.
await check('merkl root and claim on the fork', async () => {
    const acm = await client.readContract({
        address: MERKL_DISTRIBUTOR,
        abi: merklDistributorAbi,
        functionName: 'accessControlManager',
    });
    const role = await client.readContract({
        address: acm,
        abi: accessControlManagerAbi,
        functionName: 'GOVERNOR_ROLE',
    });
    const governor = await client.readContract({
        address: acm,
        abi: accessControlManagerAbi,
        functionName: 'getRoleMember',
        args: [role, 0n],
    });
    const amount = 10n ** 18n;
    const leaf = (user: Address, token: Address, value: bigint) =>
        keccak256(
            encodeAbiParameters(
                [{ type: 'address' }, { type: 'address' }, { type: 'uint256' }],
                [user, token, value],
            ),
        );
    const mine = leaf(me, ARB_TOKEN, amount);
    const other = leaf('0x000000000000000000000000000000000000dEaD', ARB_TOKEN, 1n);
    const [a, b] = mine < other ? [mine, other] : [other, mine];
    const root = keccak256(
        encodeAbiParameters([{ type: 'bytes32' }, { type: 'bytes32' }], [a, b]),
    );
    const before = await client.getBlock();

    await asAccount(client, governor, async () => {
        for (const call of [
            { functionName: 'setEpochDuration', args: [1] },
            { functionName: 'setDisputePeriod', args: [0] },
            {
                functionName: 'updateTree',
                args: [{ merkleRoot: root, ipfsHash: `0x${'0'.repeat(64)}` }],
            },
        ] as const) {
            const hash = await client.writeContract({
                account: governor,
                chain: arbitrum,
                address: MERKL_DISTRIBUTOR,
                abi: merklDistributorAbi,
                ...call,
            } as Parameters<typeof client.writeContract>[0]);

            await client.waitForTransactionReceipt({ hash });
        }
    });

    const live = await client.readContract({
        address: MERKL_DISTRIBUTOR,
        abi: merklDistributorAbi,
        functionName: 'getMerkleRoot',
    });
    const arbBefore = await client.readContract({
        address: ARB_TOKEN,
        abi: erc20Abi,
        functionName: 'balanceOf',
        args: [me],
    });

    await send(
        MERKL_DISTRIBUTOR,
        encodeFunctionData({
            abi: merklDistributorAbi,
            functionName: 'claim',
            args: [[me], [ARB_TOKEN], [amount], [[other === a ? a : b]]],
        }),
    );

    const arbAfter = await client.readContract({
        address: ARB_TOKEN,
        abi: erc20Abi,
        functionName: 'balanceOf',
        args: [me],
    });
    const after = await client.getBlock();

    return [
        `governor ${governor}`,
        `root live immediately: ${live === root}`,
        `claimed ${arbAfter - arbBefore} ARB units`,
        `fork time moved ${after.timestamp - before.timestamp}s (blocks only)`,
        'leaf = keccak256(abi.encode(user, token, cumulativeAmount)), pairs hashed sorted with abi.encode',
    ].join('\n');
});

// 4. The APIs the app reads.
async function getJson(url: string, init?: RequestInit) {
    const res = await fetch(url, init);

    if (!res.ok) {
        throw new Error(`${url} -> ${res.status}`);
    }

    return res.json() as Promise<unknown>;
}

await check('morpho api', async () => {
    const query = `query($chainId: Int!, $address: String!) { vaultV2ByAddress(chainId: $chainId, address: $address) { name totalAssetsUsd liquidity netApy netApyExcludingRewards performanceFee rewards { asset { symbol address } supplyApr } } }`;
    const lines: string[] = [];

    for (const v of [VAULTS.steakhouse, VAULTS.gauntlet]) {
        const res = (await getJson('https://api.morpho.org/graphql', {
            method: 'POST',
            headers: { 'content-type': 'application/json' },
            body: JSON.stringify({
                query,
                variables: { chainId: 42161, address: v.address },
            }),
        })) as { data?: unknown; errors?: unknown };

        if (res.errors) {
            throw new Error(JSON.stringify(res.errors).slice(0, 300));
        }

        lines.push(JSON.stringify(res.data));

        const opts = await getJson(
            `https://api.morpho.org/v0/vaults-v2/42161:${v.address}/withdrawal-options`,
        );

        lines.push(`withdrawal-options ${JSON.stringify(opts).slice(0, 300)}`);
    }

    return lines.join('\n');
});

await check('merkl api', async () => {
    const opps = (await getJson(
        'https://api.merkl.xyz/v4/opportunities?chainId=42161&search=USDG&items=50',
    )) as {
        id: string;
        identifier: string;
        name: string;
        apr: number;
        nativeApr: number;
        tvl: number;
        status: string;
    }[];
    const lines = opps.map(
        (o) =>
            `${o.identifier} ${o.status} apr=${o.apr} tvl=${o.tvl} id=${o.id} "${o.name}"`,
    );
    const first = opps[0];

    if (first) {
        const camps = (await getJson(
            `https://api.merkl.xyz/v4/opportunities/${first.id}/campaigns`,
        )) as { campaigns?: unknown[] } | unknown[];
        const list = Array.isArray(camps) ? camps : (camps.campaigns ?? []);

        lines.push(`campaign sample ${JSON.stringify(list[0]).slice(0, 500)}`);
    }

    const users = (await getJson(
        `https://api.merkl.xyz/v4/users/${GMX.glvVault}/rewards?chainId=42161`,
    )) as unknown[];

    lines.push(`user rewards shape ${JSON.stringify(users).slice(0, 400)}`);

    return lines.join('\n');
});

await check('gmx api', async () => {
    const headers = { 'user-agent': 'curl/8' };
    const info = await getJson('https://arbitrum-api.gmxinfra.io/glvs/info', {
        headers,
    });
    const apy = (await getJson('https://arbitrum-api.gmxinfra.io/apy?period=7d', {
        headers,
    })) as Record<string, unknown>;
    const tickers = (await getJson('https://arbitrum-api.gmxinfra.io/prices/tickers', {
        headers,
    })) as { tokenAddress: string; minPrice: string; maxPrice: string }[];
    const glv = VAULTS.glv.address.toLowerCase();

    return [
        `glvs/info ${JSON.stringify(info).slice(0, 300)}`,
        `apy keys ${Object.keys(apy).join(',')} glv=${JSON.stringify(
            Object.fromEntries(
                Object.entries(apy).map(([k, v]) => [
                    k,
                    Object.entries(v as Record<string, unknown>).find(
                        ([a]) => a.toLowerCase() === glv,
                    )?.[1],
                ]),
            ),
        )}`,
        `ticker ${JSON.stringify(tickers.find((t) => t.tokenAddress.toLowerCase() === glv))}`,
    ].join('\n');
});

// 5. The GMX router still holds the controller role.
await check('gmx controller role', async () => {
    const controller = keccak256(
        encodeAbiParameters([{ type: 'string' }], ['CONTROLLER']),
    );
    const ok = await client.readContract({
        address: GMX.roleStore,
        abi: roleStoreAbi,
        functionName: 'hasRole',
        args: [GMX.glvRouter, controller],
    });

    if (!ok) {
        throw new Error('GlvRouter lacks CONTROLLER');
    }

    return 'GlvRouter has CONTROLLER';
});

fork.stop();

const failed = results.filter((r) => !r.ok).length;

console.log(`\n${results.length - failed}/${results.length} checks passed`);
process.exit(failed ? 1 : 0);
