// Fork setup shared by the stack and the probe: deploying and seeding the
// Acme pools.
import { readFileSync } from 'node:fs';
import { createRequire } from 'node:module';
import { dirname, join } from 'node:path';

import { acmePoolAbi } from '@arbitrum-usdg/spot-dex-contracts';
import type { ForkClient } from '@arbitrum-usdg/spot-dex-fork-services';
import { USDG } from '@arbitrum-usdg/usdg';
import { erc20Abi, maxUint256, type Address, type Hex } from 'viem';

import { mined, type Wallet } from '../src/server/funding.ts';
import { chainlinkAbi, type PoolDef } from '../src/server/registry.ts';

export { fund, walletOn } from '../src/server/funding.ts';

const require = createRequire(import.meta.url);
const CONTRACTS_DIR = dirname(require.resolve('@arbitrum-usdg/spot-dex-contracts'));

function poolBytecode(): Hex {
    const artifact = JSON.parse(
        readFileSync(join(CONTRACTS_DIR, 'out/AcmePool.sol/AcmePool.json'), 'utf8'),
    ) as { bytecode: { object: Hex } };

    return artifact.bytecode.object;
}

export async function approve(
    client: ForkClient,
    wallet: Wallet,
    token: Address,
    spender: Address,
) {
    await mined(
        client,
        await wallet.writeContract({
            address: token,
            abi: erc20Abi,
            functionName: 'approve',
            args: [spender, maxUint256],
        }),
    );
}

// The USDG side for `baseUnits` of the base token at the Chainlink USD price,
// taking USDG at one dollar.
export async function quoteAtFeed(client: ForkClient, def: PoolDef, baseUnits: bigint) {
    const [, answer] = await client.readContract({
        address: def.feed,
        abi: chainlinkAbi,
        functionName: 'latestRoundData',
    });

    // base (18 decimals) x price (8 decimals) to USDG (6 decimals).
    return (baseUnits * answer) / 10n ** 20n;
}

export async function deployPool(client: ForkClient, wallet: Wallet, def: PoolDef) {
    const hash = await wallet.deployContract({
        abi: acmePoolAbi,
        bytecode: poolBytecode(),
        args: [
            def.base.address,
            USDG.arbitrumOne.address,
            def.lpName,
            def.lpSymbol,
            wallet.account.address,
        ],
    });
    const receipt = await mined(client, hash);

    return receipt.contractAddress!;
}

// Adds liquidity from `wallet`, approving the pool for both tokens first.
export async function addLiquidity(
    client: ForkClient,
    wallet: Wallet,
    def: PoolDef,
    pool: Address,
    baseUnits: bigint,
    quoteUnits: bigint,
) {
    await approve(client, wallet, def.base.address, pool);
    await approve(client, wallet, USDG.arbitrumOne.address, pool);
    await mined(
        client,
        await wallet.writeContract({
            address: pool,
            abi: acmePoolAbi,
            functionName: 'addLiquidity',
            args: [baseUnits, quoteUnits, 0n, wallet.account.address],
        }),
    );
}

// Deploys a pool owned by `wallet` and seeds it at the feed price.
export async function deployAndSeed(client: ForkClient, wallet: Wallet, def: PoolDef) {
    const pool = await deployPool(client, wallet, def);
    const quote = await quoteAtFeed(client, def, def.seedBase);

    await addLiquidity(client, wallet, def, pool, def.seedBase, quote);

    return pool;
}
