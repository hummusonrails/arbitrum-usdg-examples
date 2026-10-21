// A local stand in for GMX keepers. On mainnet, keepers execute GLV deposit
// and withdrawal requests a few seconds after they are created, using signed
// oracle prices. No keeper watches a local fork, so this one does: it impersonates
// a real keeper account and submits the same public signed prices.
import {
    createPublicClient,
    encodeAbiParameters,
    http,
    keccak256,
    parseAbi,
    toHex,
    type Address,
    type Hex,
} from 'viem';
import { arbitrum } from 'viem/chains';

import { asAccount, forkClient, type ForkClient } from './anvil.ts';

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
    let stopped = false;
    let timer: NodeJS.Timeout | undefined;

    const pass = async () => {
        const to = await client.getBlockNumber();

        if (to < from) {
            return;
        }

        for (const kind of ['deposit', 'withdrawal'] as const) {
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
                const requestKey = log.topics[2] as Hex;

                try {
                    const hash = await executeRequest(client, kind, requestKey);

                    if (opts.log) {
                        console.log(
                            `keeper executed GLV ${kind} ${requestKey} in ${hash}`,
                        );
                    }
                } catch (err) {
                    console.error(`keeper could not execute GLV ${kind}`, err);
                }
            }
        }

        from = to + 1n;
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
