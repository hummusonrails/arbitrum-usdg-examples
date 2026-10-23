// Stands in for LayerZero delivery between the two forks. On a live network,
// DVNs verify each packet and an executor calls lzReceive on the destination.
// Here the relay watches PacketSent on each fork and makes that call itself by
// impersonating EndpointV2, so the real OFT mints exactly as it would.
import {
    decodePacket,
    LZ_ENDPOINT_V2,
    OFT,
    oftAbi,
    packetSentEvent,
    toBytes32,
    type Packet,
} from '@arbitrum-usdg/usdg';
import type { Hex } from 'viem';

import { asAccount, type ForkClient } from './anvil.ts';

type Side = {
    client: ForkClient;
    oft: (typeof OFT)[keyof typeof OFT];
    // Where the relay started; fixed, for checking past deliveries.
    startBlock: bigint;
    // The next block to scan for packets.
    fromBlock: bigint;
};

export type RelayOptions = {
    arbitrum: ForkClient;
    ethereum: ForkClient;
    // How long a packet stays in flight before delivery, so the app can show it.
    delayMs?: number;
    pollMs?: number;
    log?: boolean;
};

export async function startRelay(opts: RelayOptions) {
    const delayMs = opts.delayMs ?? 8000;
    const side = async (client: ForkClient, oft: Side['oft']): Promise<Side> => {
        const block = await client.getBlockNumber();

        return { client, oft, startBlock: block, fromBlock: block + 1n };
    };
    const sides = [
        await side(opts.arbitrum, OFT.arbitrumOne),
        await side(opts.ethereum, OFT.ethereum),
    ];
    const seen = new Set<Hex>();
    const due: { packet: Packet; to: Side; at: number }[] = [];
    let paused = false;
    let stopped = false;
    let busy = false;

    async function delivered(to: Side, guid: Hex) {
        const logs = await to.client.getContractEvents({
            address: to.oft.address,
            abi: oftAbi,
            eventName: 'OFTReceived',
            args: { guid },
            fromBlock: to.startBlock,
        });

        return logs.length > 0;
    }

    async function deliver(packet: Packet, to: Side) {
        if (await delivered(to, packet.guid)) {
            return;
        }

        await asAccount(to.client, LZ_ENDPOINT_V2, async () => {
            const hash = await to.client.writeContract({
                account: LZ_ENDPOINT_V2,
                chain: to.client.chain,
                address: to.oft.address,
                abi: oftAbi,
                functionName: 'lzReceive',
                args: [
                    {
                        srcEid: packet.srcEid,
                        sender: packet.sender,
                        nonce: packet.nonce,
                    },
                    packet.guid,
                    packet.message,
                    LZ_ENDPOINT_V2,
                    '0x',
                ],
            });
            const receipt = await to.client.waitForTransactionReceipt({ hash });

            if (receipt.status !== 'success') {
                throw new Error(`lzReceive for ${packet.guid} reverted`);
            }
        });

        if (opts.log) {
            console.log(`[relay] delivered ${packet.guid} to eid ${packet.dstEid}`);
        }
    }

    async function scan(from: Side, to: Side) {
        const latest = await from.client.getBlockNumber();

        if (latest < from.fromBlock) {
            return;
        }

        const logs = await from.client.getContractEvents({
            address: LZ_ENDPOINT_V2,
            abi: [packetSentEvent],
            eventName: 'PacketSent',
            fromBlock: from.fromBlock,
            toBlock: latest,
        });

        from.fromBlock = latest + 1n;

        for (const log of logs) {
            const packet = decodePacket(log.args.encodedPayload!);

            // Only packets for the USDG OFT on the other fork.
            if (
                packet.dstEid !== to.oft.eid ||
                packet.receiver.toLowerCase() !==
                    toBytes32(to.oft.address).toLowerCase() ||
                seen.has(packet.guid)
            ) {
                continue;
            }

            seen.add(packet.guid);
            due.push({ packet, to, at: Date.now() + delayMs });
        }
    }

    async function tick() {
        if (busy || stopped) {
            return;
        }

        busy = true;

        try {
            await scan(sides[0]!, sides[1]!);
            await scan(sides[1]!, sides[0]!);

            while (!paused && due[0] && due[0].at <= Date.now()) {
                const next = due[0];

                await deliver(next.packet, next.to);
                due.shift();
            }
        } catch (err) {
            console.error('[relay]', err);
        } finally {
            busy = false;
        }
    }

    const timer = setInterval(() => void tick(), opts.pollMs ?? 1000);

    return {
        // Tests hold delivery to see a transfer in flight.
        pause() {
            paused = true;
        },
        resume() {
            paused = false;
        },
        async close() {
            stopped = true;
            clearInterval(timer);
            while (busy) {
                await new Promise((r) => setTimeout(r, 50));
            }
        },
    };
}

export type Relay = Awaited<ReturnType<typeof startRelay>>;
