// Moves real USDG on an Anvil fork of Arbitrum One so mock Paxos mints and
// deposits produce genuine balances and Transfer logs.
import { USDG, usdgAbi } from '@arbitrum-usdg/usdg';
import {
    createPublicClient,
    createTestClient,
    http,
    parseEventLogs,
    walletActions,
    type Address,
    type Hex,
} from 'viem';
import { arbitrum } from 'viem/chains';

// A large USDG holder on Arbitrum One, used to fund mints on the fork.
const HOLDER: Address = '0x264bd8291fae1d75db2c5f573b07faa6715997b5';
const token = { address: USDG.arbitrumOne.address, abi: usdgAbi } as const;

export type ObservedTransfer = {
    from: Address;
    to: Address;
    value: bigint;
    hash: Hex;
    index: number;
};

export function createForkChain(rpcUrl: string) {
    const transport = http(rpcUrl);
    const publicClient = createPublicClient({ chain: arbitrum, transport });
    const testClient = createTestClient({
        chain: arbitrum,
        mode: 'anvil',
        transport,
    }).extend(walletActions);
    let ready: Promise<void> | undefined;
    let queue: Promise<unknown> = Promise.resolve();

    async function prepareHolder() {
        await testClient.impersonateAccount({ address: HOLDER });
        await testClient.setBalance({ address: HOLDER, value: 10n ** 20n });
    }

    async function sendNow(to: Address, units: bigint): Promise<Hex> {
        ready ??= prepareHolder();
        await ready;

        const hash = await testClient.writeContract({
            account: HOLDER,
            chain: arbitrum,
            ...token,
            functionName: 'transfer',
            args: [to, units],
        });

        await publicClient.waitForTransactionReceipt({ hash });

        return hash;
    }

    return {
        // Sends USDG from the funding holder, the way a Paxos withdrawal lands.
        // Sends go out one at a time: parallel sends from the same impersonated
        // account would race for the same nonce.
        send(to: Address, units: bigint): Promise<Hex> {
            const run = queue.then(() => sendNow(to, units));

            queue = run.catch((err) => console.error('mock withdrawal failed', err));

            return run;
        },

        async blockNumber(): Promise<bigint> {
            return publicClient.getBlockNumber();
        },

        // USDG transfers into any of the watched addresses between two blocks.
        async transfersTo(
            addresses: Address[],
            fromBlock: bigint,
            toBlock: bigint,
        ): Promise<ObservedTransfer[]> {
            if (addresses.length === 0 || fromBlock > toBlock) {
                return [];
            }

            const logs = await publicClient.getLogs({
                address: token.address,
                event: usdgAbi.find(
                    (x) => x.type === 'event' && x.name === 'Transfer',
                )!,
                args: { to: addresses },
                fromBlock,
                toBlock,
            });

            return parseEventLogs({ abi: usdgAbi, logs, eventName: 'Transfer' }).map(
                (l) => ({
                    from: l.args.from,
                    to: l.args.to,
                    value: l.args.value,
                    hash: l.transactionHash,
                    index: l.logIndex,
                }),
            );
        },
    };
}

export type ForkChain = ReturnType<typeof createForkChain>;
