// Live vault data, read the same way for every vault: the vault's own rate
// comes from the protocol that runs it, and the incentive boost comes from the
// live DRIP campaigns on Merkl. Each source fails on its own; a source that is
// down leaves its fields empty rather than breaking the page.
import type { Config } from './config.ts';
import { VAULT_IDS, VAULTS } from './vaults/registry.ts';
import type { VaultId } from './vaults/types.ts';

export type Boost = {
    token: string;
    // A fraction, 0.048 for 4.8%.
    apr: number;
    // ISO date the current campaign ends.
    endsAt: string;
    // ARB is claimed from Merkl; the GLV boost is paid into the GLV price.
    paidAs: 'claim' | 'price';
};

export type VaultMarket = {
    id: VaultId;
    // The vault's own variable rate after fees, as a fraction.
    vaultApy: number | null;
    boost: Boost | null;
    tvl: number | null;
    // USDG base units that can be withdrawn right now. Null when the vault
    // does not limit withdrawals this way.
    instantLiquidity: bigint | null;
    performanceFee: number | null;
    withdrawalFee: number | null;
    updatedAt: string;
};

// GMX charges this on GLV withdrawals (docs.gmx.io, providing liquidity).
const GLV_WITHDRAWAL_FEE = 0.0004;
const CACHE_MS = 60_000;

type MerklOpportunity = {
    identifier: string;
    depositUrl?: string;
    status: string;
    apr: number;
    latestCampaignEnd: string;
    rewardsRecord?: { breakdowns?: { token?: { symbol?: string } }[] };
};

async function getJson<T>(url: string, init?: RequestInit): Promise<T> {
    const res = await fetch(url, {
        ...init,
        headers: { 'user-agent': 'acme-money-sample', ...init?.headers },
        signal: AbortSignal.timeout(15_000),
    });

    if (!res.ok) {
        throw new Error(`${url} returned ${res.status}`);
    }

    return res.json() as Promise<T>;
}

async function settle<T>(p: Promise<T>, what: string): Promise<T | null> {
    try {
        return await p;
    } catch (err) {
        console.error(`market data: ${what}`, err);

        return null;
    }
}

const MORPHO_QUERY = `query($chainId: Int!, $address: String!) {
  vaultV2ByAddress(chainId: $chainId, address: $address) {
    totalAssetsUsd netApyExcludingRewards performanceFee
  }
}`;

async function morpho(config: Config, address: string) {
    const [vault, options] = await Promise.all([
        settle(
            getJson<{
                data?: {
                    vaultV2ByAddress?: {
                        totalAssetsUsd: number;
                        netApyExcludingRewards: number;
                        performanceFee: number;
                    };
                };
            }>(`${config.morphoApiUrl}/graphql`, {
                method: 'POST',
                headers: { 'content-type': 'application/json' },
                body: JSON.stringify({
                    query: MORPHO_QUERY,
                    variables: { chainId: 42161, address },
                }),
            }).then((r) => r.data?.vaultV2ByAddress ?? null),
            `Morpho vault ${address}`,
        ),
        settle(
            getJson<{
                data: {
                    idle_assets: string;
                    liquidity_adapter_available_assets: string;
                };
            }>(
                `${config.morphoApiUrl}/v0/vaults-v2/42161:${address}/withdrawal-options`,
            ),
            `Morpho withdrawal options ${address}`,
        ),
    ]);

    return {
        vaultApy: vault?.netApyExcludingRewards ?? null,
        tvl: vault?.totalAssetsUsd ?? null,
        performanceFee: vault?.performanceFee ?? null,
        instantLiquidity: options
            ? BigInt(options.data.idle_assets) +
              BigInt(options.data.liquidity_adapter_available_assets)
            : null,
    };
}

async function gmx(config: Config, glv: string) {
    const lower = glv.toLowerCase();
    const [apy, info] = await Promise.all([
        settle(
            getJson<{ glvs: Record<string, { apy: number }> }>(
                `${config.gmxApiUrl}/apy?period=7d`,
            ),
            'GMX APY',
        ),
        settle(
            getJson<{
                glvs: { glvToken: string; markets: { balanceUsd: string }[] }[];
            }>(`${config.gmxApiUrl}/glvs/info`),
            'GMX GLV info',
        ),
    ]);
    const rate = Object.entries(apy?.glvs ?? {}).find(
        ([a]) => a.toLowerCase() === lower,
    );
    const markets = info?.glvs.find((g) => g.glvToken.toLowerCase() === lower)?.markets;
    // GMX USD values carry 30 decimals.
    const tvl = markets
        ? Number(
              markets.reduce((sum, m) => sum + BigInt(m.balanceUsd), 0n) / 10n ** 24n,
          ) / 1e6
        : null;

    return { vaultApy: rate?.[1].apy ?? null, tvl };
}

// The live DRIP campaign for a vault, if there is one.
export function boostFor(
    opportunities: MerklOpportunity[],
    address: string,
    paidAs: Boost['paidAs'],
): Boost | null {
    const lower = address.toLowerCase();
    const opp = opportunities.find(
        (o) =>
            o.status === 'LIVE' &&
            (o.identifier.toLowerCase() === lower ||
                o.depositUrl?.toLowerCase().includes(lower)),
    );
    const token = opp?.rewardsRecord?.breakdowns?.[0]?.token?.symbol;

    if (!opp || !token || !(opp.apr > 0)) {
        return null;
    }

    return {
        token,
        apr: opp.apr / 100,
        endsAt: new Date(Number(opp.latestCampaignEnd) * 1000).toISOString(),
        paidAs,
    };
}

let cache: { at: number; value: Record<VaultId, VaultMarket> } | undefined;

export async function readMarkets(
    config: Config,
): Promise<Record<VaultId, VaultMarket>> {
    if (cache && Date.now() - cache.at < CACHE_MS) {
        return cache.value;
    }

    const [opportunities, steakhouse, gauntlet, glv] = await Promise.all([
        settle(
            getJson<MerklOpportunity[]>(
                `${config.merklApiUrl}/v4/opportunities?chainId=42161&search=USDG&items=50`,
            ),
            'Merkl opportunities',
        ),
        morpho(config, VAULTS.steakhouse.address),
        morpho(config, VAULTS.gauntlet.address),
        gmx(config, VAULTS.glv.address),
    ]);
    const updatedAt = new Date().toISOString();
    const opps = opportunities ?? [];
    const value = Object.fromEntries(
        VAULT_IDS.map((id) => {
            const config = VAULTS[id];
            const boost = boostFor(
                opps,
                config.address,
                config.merklRewards ? 'claim' : 'price',
            );
            const market: VaultMarket =
                id === 'glv'
                    ? {
                          id,
                          ...glv,
                          boost,
                          instantLiquidity: null,
                          performanceFee: null,
                          withdrawalFee: GLV_WITHDRAWAL_FEE,
                          updatedAt,
                      }
                    : {
                          id,
                          ...(id === 'steakhouse' ? steakhouse : gauntlet),
                          boost,
                          withdrawalFee: 0,
                          updatedAt,
                      };

            return [id, market];
        }),
    ) as Record<VaultId, VaultMarket>;

    cache = { at: Date.now(), value };

    return value;
}
