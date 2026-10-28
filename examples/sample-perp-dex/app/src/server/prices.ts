// Where the keeper's prices come from on the fork: the Chainlink feed on the
// fork, which stays at its value at the fork block, shifted by the fork only
// market move the console sets. A production keeper would read live prices.
import type { ForkClient } from '@arbitrum-usdg/perp-dex-fork-services';

import { chainlinkAbi, type MarketDef } from './registry.ts';

export async function feedPrice(client: ForkClient, def: MarketDef): Promise<bigint> {
    const [, answer] = await client.readContract({
        address: def.feed,
        abi: chainlinkAbi,
        functionName: 'latestRoundData',
    });

    return answer;
}

// The feed price moved by `moveBps` basis points, such as -1000 for 10% down.
export function applyMove(price: bigint, moveBps: number): bigint {
    return (price * BigInt(10_000 + moveBps)) / 10_000n;
}
