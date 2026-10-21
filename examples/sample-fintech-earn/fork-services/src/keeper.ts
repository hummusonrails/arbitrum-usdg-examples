// A local stand in for GMX keepers. On mainnet, keepers execute GLV deposit
// and withdrawal requests a few seconds after they are created, using signed
// oracle prices. No keeper watches a local fork, so this one does: it impersonates
// a real keeper account and submits the same public signed prices.
import {
    createPublicClient,
    encodeAbiParameters,
    encodeFunctionData,
    zeroAddress,
    http,
    keccak256,
    parseAbi,
    toHex,
    type Address,
    type Hex,
} from 'viem';
import { arbitrum } from 'viem/chains';

import { asAccount, forkClient, fundUsdg, type ForkClient } from './anvil.ts';

const GMX = {
    dataStore: '0xFD70de6b91282D8017aA4E741e9Ae325CAb992d8',
    reader: '0xfA26cBb46e2614609406de08CA1Dc7f70a684184',
    eventEmitter: '0xC8ee91A54287DB53897056e12D9819156D3822Fb',
    oracle: '0x26C02F221e8dB5A821e12347C7eA8a6b6E10842f',
    glvDepositHandler: '0xE092bFd05186546fDEAC888f5bCC2c42406d026d',
    glvWithdrawalHandler: '0x45048c62528a6A66FA5CC8D2b25b918701F0FAAA',
    glv: '0x4Cd5A94a30876320ac65F2e192493EE476f13866',
    usdg: '0x004B506865409877C9fA29bfb1ebA929984B9bbC',
} as const satisfies Record<string, Address>;

// An account holding GMX's ORDER_KEEPER role on Arbitrum One.
const KEEPER: Address = '0xE47b36382DC50b90bCF6176Ddb159C4b9333A7AB';
// About a minute of retries at the default poll interval.
const MAX_TRIES = 60;
const SIGNED_PRICES = 'https://arbitrum-api.gmxinfra.io/signed_prices/latest';

const abi = parseAbi([
    'function getAddress(bytes32 key) view returns (address)',
    'function getAddressValuesAt(bytes32 setKey, uint256 start, uint256 end) view returns (address[])',
    'function getMarket(address dataStore, address key) view returns ((address marketToken, address indexToken, address longToken, address shortToken))',
    'function executeGlvDeposit(bytes32 key, (address[] tokens, address[] providers, bytes[] data) oracleParams)',
    'function executeGlvWithdrawal(bytes32 key, (address[] tokens, address[] providers, bytes[] data) oracleParams)',
]);

// topic0 of GMX's EventLog2 (the selector of its full ABI signature). The
// event name hash is topic1 and the request key is topic2.
const EVENT_LOG2: Hex =
    '0x468a25a7ba624ceea6e540ad6f49171b52495b648417ae91bca21676d8a24dc5';

// GMX DataStore keys are keccak256(abi.encode(...)).
function key(...parts: [string, ...(Address | Hex)[]]): Hex {
    const [name, ...rest] = parts;
    const base = keccak256(encodeAbiParameters([{ type: 'string' }], [name]));

    if (rest.length === 0) {
        return base;
    }

    return keccak256(
        encodeAbiParameters(
            [{ type: 'bytes32' }, ...rest.map(() => ({ type: 'address' as const }))],
            [base, ...(rest as Address[])],
        ),
    );
}

export type RequestKind = 'deposit' | 'withdrawal';

// The tokens whose prices a GLV request needs: USDG plus every index token of
// the markets inside the GLV.
async function oracleTokens(client: ForkClient): Promise<Address[]> {
    const markets = await client.readContract({
        address: GMX.dataStore,
        abi,
        functionName: 'getAddressValuesAt',
        args: [key('GLV_SUPPORTED_MARKET_LIST', GMX.glv), 0n, 100n],
    });
    const props = await Promise.all(
        markets.map((m) =>
            client.readContract({
                address: GMX.reader,
                abi,
                functionName: 'getMarket',
                args: [GMX.dataStore, m],
            }),
        ),
    );
    const tokens = new Set<string>([GMX.usdg.toLowerCase()]);

    for (const p of props) {
        tokens.add(p.indexToken.toLowerCase());
    }

    return [...tokens] as Address[];
}

type SignedPrice = { tokenAddress: string; blob: Hex; maxBlockTimestamp: number };

// Executes one pending GLV request with live signed prices.
export async function executeRequest(
    client: ForkClient,
    kind: RequestKind,
    requestKey: Hex,
): Promise<Hex> {
    const tokens = await oracleTokens(client);
    const providers = await Promise.all(
        tokens.map((t) =>
            client.readContract({
                address: GMX.dataStore,
                abi,
                functionName: 'getAddress',
                args: [key('ORACLE_PROVIDER_FOR_TOKEN', GMX.oracle, t)],
            }),
        ),
    );
    const res = await fetch(SIGNED_PRICES, { headers: { 'user-agent': 'curl/8' } });
    const { signedPrices } = (await res.json()) as { signedPrices: SignedPrice[] };
    const byToken = new Map(signedPrices.map((p) => [p.tokenAddress.toLowerCase(), p]));
    const prices = tokens.map((t) => {
        const p = byToken.get(t);

        if (!p) {
            throw new Error(`No signed price for ${t}`);
        }

        return p;
    });
    const newest = Math.max(...prices.map((p) => p.maxBlockTimestamp));
    const block = await client.getBlock();

    // Prices may not be newer than the block that uses them. Moving the fork
    // forward to meet live prices keeps it close to live time.
    if (BigInt(newest) >= block.timestamp) {
        await client.setNextBlockTimestamp({ timestamp: BigInt(newest + 1) });
    }

    return asAccount(client, KEEPER, async () => {
        const call = {
            account: KEEPER,
            chain: arbitrum,
            address:
                kind === 'deposit' ? GMX.glvDepositHandler : GMX.glvWithdrawalHandler,
            abi,
            functionName:
                kind === 'deposit' ? 'executeGlvDeposit' : 'executeGlvWithdrawal',
            args: [requestKey, { tokens, providers, data: prices.map((p) => p.blob) }],
            gas: 15_000_000n,
        } as const;

        // Simulate first so a failure reports its reason instead of a bare revert.
        await client.simulateContract(call);

        const hash = await client.writeContract(call);
        const receipt = await client.waitForTransactionReceipt({ hash });

        if (receipt.status !== 'success') {
            throw new Error(`GLV ${kind} execution ${hash} reverted`);
        }

        return hash;
    });
}

// Watches for new GLV requests and executes each one, like mainnet keepers.
export async function startKeeper(opts: {
    rpcUrl: string;
    pollMs?: number;
    log?: boolean;
}) {
    const client = forkClient(opts.rpcUrl);
    const reader = createPublicClient({
        chain: arbitrum,
        transport: http(opts.rpcUrl),
    });
    const created: Record<RequestKind, Hex> = {
        deposit: keccak256(toHex('GlvDepositCreated')),
        withdrawal: keccak256(toHex('GlvWithdrawalCreated')),
    };
    let from = await client.getBlockNumber();
    const queue = new Map<Hex, { kind: RequestKind; tries: number }>();
    let stopped = false;
    let timer: NodeJS.Timeout | undefined;

    const pass = async () => {
        const to = await client.getBlockNumber();

        for (const kind of to < from ? [] : (['deposit', 'withdrawal'] as const)) {
            const logs = await reader.request({
                method: 'eth_getLogs',
                params: [
                    {
                        address: GMX.eventEmitter,
                        topics: [EVENT_LOG2, created[kind]],
                        fromBlock: toHex(from),
                        toBlock: toHex(to),
                    },
                ],
            });

            for (const log of logs) {
                queue.set(log.topics[2] as Hex, { kind, tries: 0 });
            }
        }

        from = to < from ? from : to + 1n;

        // Signed prices must be at least as new as the request, so a request
        // made a moment after the latest price waits for the next one, as a
        // real keeper would. Requests that keep failing are dropped.
        for (const [requestKey, item] of queue) {
            try {
                const hash = await executeRequest(client, item.kind, requestKey);

                queue.delete(requestKey);

                if (opts.log) {
                    console.log(
                        `keeper executed GLV ${item.kind} ${requestKey} in ${hash}`,
                    );
                }
            } catch (err) {
                item.tries += 1;

                if (item.tries >= MAX_TRIES) {
                    queue.delete(requestKey);
                    console.error(
                        `keeper gave up on GLV ${item.kind} ${requestKey}`,
                        err,
                    );
                }
            }
        }
    };

    const loop = async () => {
        await pass().catch((err) => console.error('keeper', err));

        if (!stopped) {
            timer = setTimeout(loop, opts.pollMs ?? 1000);
        }
    };

    void loop();

    return {
        async close() {
            stopped = true;
            clearTimeout(timer);
        },
    };
}

const routerAbi = parseAbi([
    'function approve(address spender, uint256 amount) returns (bool)',
    'function multicall(bytes[] data) payable returns (bytes[] results)',
    'function sendWnt(address receiver, uint256 amount) payable',
    'function sendTokens(address token, address receiver, uint256 amount) payable',
    'function createGlvDeposit(((address glv, address market, address receiver, address callbackContract, address uiFeeReceiver, address initialLongToken, address initialShortToken, address[] longTokenSwapPath, address[] shortTokenSwapPath) addresses, uint256 minGlvTokens, uint256 executionFee, uint256 callbackGasLimit, bool shouldUnwrapNativeToken, bool isMarketTokenDeposit, bytes32[] dataList) params) payable returns (bytes32)',
]);

// The first GLV execution on a fresh fork pulls a lot of GMX state from the
// upstream RPC and can take a minute or more. Running one small deposit from a
// throwaway account at startup makes the first customer deposit as quick as
// the rest. The keeper executes it like any other request.
export async function warmGlv(rpcUrl: string, usdgHolder: Address): Promise<void> {
    const client = forkClient(rpcUrl);
    const account: Address = '0x00000000000000000000000000000000000ea4e1';
    const fee = 10n ** 16n;
    const glvRouter: Address = '0x167540D2DFF14120365CfDDF2F86e3045D4fa712';
    const router: Address = '0x7452c558d45f8afC8c83dAe62C3f8A5BE19c71f6';
    const glvVault: Address = '0x393053B58f9678C9c28c2cE941fF6cac49C3F8f9';
    const market: Address = '0xe57B97F2f83F39E74Ec83f3e039FD370884784fF';
    const amount = 10_000_000n;

    await fundUsdg(client, usdgHolder, account, amount);
    await asAccount(client, account, async () => {
        const send = async (to: Address, data: Hex, value = 0n) =>
            client.waitForTransactionReceipt({
                hash: await client.sendTransaction({
                    account,
                    chain: arbitrum,
                    to,
                    data,
                    value,
                }),
            });

        await send(
            GMX.usdg,
            encodeFunctionData({
                abi: routerAbi,
                functionName: 'approve',
                args: [router, amount],
            }),
        );
        await send(
            glvRouter,
            encodeFunctionData({
                abi: routerAbi,
                functionName: 'multicall',
                args: [
                    [
                        encodeFunctionData({
                            abi: routerAbi,
                            functionName: 'sendWnt',
                            args: [glvVault, fee],
                        }),
                        encodeFunctionData({
                            abi: routerAbi,
                            functionName: 'sendTokens',
                            args: [GMX.usdg, glvVault, amount],
                        }),
                        encodeFunctionData({
                            abi: routerAbi,
                            functionName: 'createGlvDeposit',
                            args: [
                                {
                                    addresses: {
                                        glv: GMX.glv,
                                        market,
                                        receiver: account,
                                        callbackContract: zeroAddress,
                                        uiFeeReceiver: zeroAddress,
                                        initialLongToken: GMX.usdg,
                                        initialShortToken: GMX.usdg,
                                        longTokenSwapPath: [],
                                        shortTokenSwapPath: [],
                                    },
                                    minGlvTokens: 0n,
                                    executionFee: fee,
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
            fee,
        );
    });
}
