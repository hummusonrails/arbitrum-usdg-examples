// Fork setup shared by the stack and the probe: wallets, funding, and
// deploying and seeding the Acme pools.
import { readFileSync } from 'node:fs';
import { createRequire } from 'node:module';
import { dirname, join } from 'node:path';

import { acmePoolAbi } from '@arbitrum-usdg/spot-dex-contracts';
import {
    fundFromHolders,
    type ForkClient,
} from '@arbitrum-usdg/spot-dex-fork-services';
import { USDG, USDG_ETHEREUM } from '@arbitrum-usdg/usdg';
import {
    createWalletClient,
    erc20Abi,
    http,
    maxUint256,
    type Address,
    type Hex,
} from 'viem';
import { privateKeyToAccount } from 'viem/accounts';

import {
    ARB,
    chainlinkAbi,
    FORK_HOLDERS,
    WETH,
    wethAbi,
    type PoolDef,
} from '../src/server/registry.ts';

const require = createRequire(import.meta.url);
const CONTRACTS_DIR = dirname(require.resolve('@arbitrum-usdg/spot-dex-contracts'));

function poolBytecode(): Hex {
    const artifact = JSON.parse(
        readFileSync(join(CONTRACTS_DIR, 'out/AcmePool.sol/AcmePool.json'), 'utf8'),
    ) as { bytecode: { object: Hex } };

    return artifact.bytecode.object;
}

export function walletOn(client: ForkClient, key: Hex) {
    return createWalletClient({
        account: privateKeyToAccount(key),
        chain: client.chain,
        transport: http(client.transport.url as string, { timeout: 120_000 }),
    });
}

export type Wallet = ReturnType<typeof walletOn>;

async function mined(client: ForkClient, hash: Hex) {
    const receipt = await client.waitForTransactionReceipt({ hash });

    if (receipt.status !== 'success') {
        throw new Error(`Setup transaction ${hash} reverted`);
    }

    return receipt;
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

export type Funding = { usdg: bigint; usdgEthereum: bigint; weth: bigint; arb: bigint };

// Gives an account ETH for gas on both forks and real token balances moved
// from holders on the fork. WETH is wrapped from ETH.
export async function fund(
    arbitrum: ForkClient,
    ethereum: ForkClient,
    key: Hex,
    amounts: Funding,
) {
    const who = privateKeyToAccount(key).address;
    const eth = 10n ** 18n * 10n;

    await arbitrum.setBalance({ address: who, value: eth + amounts.weth });
    await ethereum.setBalance({ address: who, value: eth });

    if (amounts.usdg > 0n) {
        await fundFromHolders(
            arbitrum,
            USDG.arbitrumOne.address,
            FORK_HOLDERS.usdgArbitrum,
            who,
            amounts.usdg,
        );
    }

    if (amounts.usdgEthereum > 0n) {
        await fundFromHolders(
            ethereum,
            USDG_ETHEREUM,
            FORK_HOLDERS.usdgEthereum,
            who,
            amounts.usdgEthereum,
        );
    }

    if (amounts.arb > 0n) {
        await fundFromHolders(arbitrum, ARB, FORK_HOLDERS.arb, who, amounts.arb);
    }

    if (amounts.weth > 0n) {
        await mined(
            arbitrum,
            await walletOn(arbitrum, key).writeContract({
                address: WETH,
                abi: wethAbi,
                functionName: 'deposit',
                value: amounts.weth,
            }),
        );
    }
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
