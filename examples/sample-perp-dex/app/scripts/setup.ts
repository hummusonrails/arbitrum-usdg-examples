// Fork setup shared by the stack and the probe: deploying the oracle and the
// margin vault, listing the markets, pricing them, and seeding the house.
import { readFileSync } from 'node:fs';
import { createRequire } from 'node:module';
import { dirname, join } from 'node:path';

import { acmeMarginVaultAbi, acmeOracleAbi } from '@arbitrum-usdg/perp-dex-contracts';
import type { ForkClient } from '@arbitrum-usdg/perp-dex-fork-services';
import { USDG } from '@arbitrum-usdg/usdg';
import { erc20Abi, maxUint256, type Address, type Hex } from 'viem';

import { mined, type Wallet } from '../src/server/funding.ts';
import { applyMove, feedPrice } from '../src/server/prices.ts';
import { MARKET_IDS, MARKETS, ORACLE_MAX_AGE_S } from '../src/server/registry.ts';

export { fund, walletOn } from '../src/server/funding.ts';

const require = createRequire(import.meta.url);
const CONTRACTS_DIR = dirname(require.resolve('@arbitrum-usdg/perp-dex-contracts'));

function bytecode(name: string): Hex {
    const artifact = JSON.parse(
        readFileSync(join(CONTRACTS_DIR, `out/${name}.sol/${name}.json`), 'utf8'),
    ) as { bytecode: { object: Hex } };

    return artifact.bytecode.object;
}

// Pushes every market's price from the keeper, at the feed price moved by
// `moves` (basis points per market).
export async function pushPrices(
    client: ForkClient,
    keeper: Wallet,
    oracle: Address,
    moves: Partial<Record<string, number>> = {},
) {
    const prices = await Promise.all(
        MARKET_IDS.map(async (id) =>
            applyMove(await feedPrice(client, MARKETS[id]), moves[id] ?? 0),
        ),
    );

    return mined(
        client,
        await keeper.writeContract({
            address: oracle,
            abi: acmeOracleAbi,
            functionName: 'setPrices',
            args: [MARKET_IDS.map((id) => MARKETS[id].key), prices],
        }),
    );
}

// Deploys the oracle and the vault owned by `operator`, lists both markets,
// prices them, and adds `liquidity` USDG of house liquidity.
export async function deployExchange(
    client: ForkClient,
    operator: Wallet,
    keeper: Wallet,
    liquidity: bigint,
) {
    const oracle = (
        await mined(
            client,
            await operator.deployContract({
                abi: acmeOracleAbi,
                bytecode: bytecode('AcmeOracle'),
                args: [
                    operator.account.address,
                    keeper.account.address,
                    BigInt(ORACLE_MAX_AGE_S),
                ],
            }),
        )
    ).contractAddress!;
    const vault = (
        await mined(
            client,
            await operator.deployContract({
                abi: acmeMarginVaultAbi,
                bytecode: bytecode('AcmeMarginVault'),
                args: [USDG.arbitrumOne.address, oracle, operator.account.address],
            }),
        )
    ).contractAddress!;

    for (const id of MARKET_IDS) {
        await mined(
            client,
            await operator.writeContract({
                address: vault,
                abi: acmeMarginVaultAbi,
                functionName: 'listMarket',
                args: [MARKETS[id].key],
            }),
        );
    }

    await pushPrices(client, keeper, oracle);
    await mined(
        client,
        await operator.writeContract({
            address: USDG.arbitrumOne.address,
            abi: erc20Abi,
            functionName: 'approve',
            args: [vault, maxUint256],
        }),
    );
    await mined(
        client,
        await operator.writeContract({
            address: vault,
            abi: acmeMarginVaultAbi,
            functionName: 'addLiquidity',
            args: [liquidity],
        }),
    );

    return { oracle, vault };
}
