// Everything the customer view and the operator console show, in one
// serializable object. Amounts are decimal strings: USDG and ARB formatted,
// vault shares as raw 18 decimal base units.
import { readWalletHealth } from '@arbitrum-usdg/usdg';
import { erc20Abi, formatUnits } from 'viem';

import type { Ctx } from './ctx.ts';
import { getPosition, listCustomers } from './ledger.ts';
import type { Boost, VaultMarket } from './market.ts';
import { ledgerShares, listActions, readUnassigned, reservedUsdg } from './money.ts';
import { reconcile, type Check } from './reconcile.ts';
import {
    allocatedByCustomer,
    readRewards,
    totalClaimed,
    type RewardsState,
} from './rewards.ts';
import { ARB_TOKEN, VAULT_IDS, VAULTS } from './vaults/registry.ts';
import type { VaultChainState, VaultConfig, VaultId } from './vaults/types.ts';

const ONE_SHARE = 10n ** 18n;
const usdg = (units: bigint) => formatUnits(units, 6);
const arb = (wei: bigint) => formatUnits(wei, 18);

export type VaultView = VaultConfig & {
    vaultApy: number | null;
    boost: Boost | null;
    tvl: number | null;
    instantLiquidity: string | null;
    performanceFee: number | null;
    withdrawalFee: number | null;
    sharePrice: string;
    omnibusShares: string;
    omnibusValue: string;
    depositsOpen: boolean;
    withdrawalsOpen: boolean;
    lamps: { gates: boolean; liquidity: boolean | null; keeper: boolean | null };
};

export type PositionView = {
    vaultId: VaultId;
    shares: string;
    value: string;
    netDeposited: string;
    earnings: string;
};

export type CustomerView = {
    id: string;
    name: string;
    usdg: string;
    accepted: VaultId[];
    positions: PositionView[];
    earnBalance: string;
    earnings: string;
    arbRewards: string;
};

export type ActionView = {
    id: string;
    customerId: string | null;
    vaultId: VaultId | null;
    kind: string;
    status: string;
    mode: string | null;
    amount: string;
    assets: string | null;
    shares: string | null;
    txHash: string | null;
    reason: string | null;
    createdAt: string;
};

export type CheckView = Omit<Check, 'ledger' | 'onchain'> & {
    ledger: string;
    onchain: string;
};

export type FeedLine = { at: string; text: string; txHash?: string };

export type Snapshot = {
    mode: 'fork' | 'mainnet';
    explorer: string | null;
    omnibus: {
        address: string;
        usdg: string;
        eth: string;
        arb: string;
        unassigned: string;
    };
    vaults: VaultView[];
    customers: CustomerView[];
    actions: ActionView[];
    checks: CheckView[];
    rewards: Omit<
        RewardsState,
        'byCustomer' | 'accrued' | 'pending' | 'claimable' | 'claimed' | 'allocated'
    > & {
        accrued: string;
        pending: string;
        claimable: string;
        claimed: string;
        allocated: string;
    };
    feed: FeedLine[];
    error?: string;
    updatedAt: string;
};

function value(shares: bigint, price: bigint) {
    return (shares * price) / ONE_SHARE;
}

// One line per onchain action, newest first, for the console's slate.
function feedFrom(actions: ActionView[]): FeedLine[] {
    return actions
        .filter((a) => a.vaultId && a.txHash)
        .map((a) => {
            const vault = VAULTS[a.vaultId!].name;
            const who = a.customerId ?? 'omnibus';
            const verb = a.kind === 'deposit' ? 'deposit into' : 'withdraw from';
            const amount =
                a.kind === 'deposit' ? `${a.amount} USDG` : `${a.amount} shares`;
            const result =
                a.status === 'executed'
                    ? a.kind === 'deposit'
                        ? `minted ${a.shares} shares`
                        : `paid ${a.assets} USDG`
                    : a.status === 'pending'
                      ? 'waiting for the GMX keeper'
                      : (a.reason ?? a.status);

            return {
                at: a.createdAt,
                text: `${who} ${verb} ${vault}: ${amount}, ${result}`,
                txHash: a.txHash ?? undefined,
            };
        });
}

export async function getSnapshot(ctx: Ctx, error?: string): Promise<Snapshot> {
    const { db, chain, config } = ctx;
    const [markets, health, arbBalance, unassigned, rewards, ...states] =
        await Promise.all([
            ctx.markets(),
            readWalletHealth(chain.publicClient, 'arbitrumOne', chain.omnibus),
            chain.publicClient.readContract({
                address: ARB_TOKEN,
                abi: erc20Abi,
                functionName: 'balanceOf',
                args: [chain.omnibus],
            }),
            readUnassigned(ctx),
            // Rewards come from an outside service; if it is slow, the rest of the
            // page still updates from the chain and the books.
            readRewards(ctx).catch((err): RewardsState => {
                console.error('rewards read', err);

                return {
                    accrued: 0n,
                    pending: 0n,
                    claimable: 0n,
                    claimed: totalClaimed(db),
                    allocated: Object.values(allocatedByCustomer(db)).reduce(
                        (s, v) => s + v,
                        0n,
                    ),
                    byCustomer: allocatedByCustomer(db),
                    lastAllocationAt: null,
                    simulated: config.mode === 'fork',
                    unavailable: true,
                };
            }),
            ...VAULT_IDS.map((id) => ctx.adapters[id].readState()),
        ]);
    const stateOf = Object.fromEntries(
        VAULT_IDS.map((id, i) => [id, states[i]]),
    ) as Record<VaultId, VaultChainState>;
    const vaults: VaultView[] = VAULT_IDS.map((id) => {
        const m: VaultMarket = markets[id];
        const s = stateOf[id];

        return {
            ...VAULTS[id],
            vaultApy: m.vaultApy,
            boost: m.boost,
            tvl: m.tvl,
            instantLiquidity:
                m.instantLiquidity === null ? null : usdg(m.instantLiquidity),
            performanceFee: m.performanceFee,
            withdrawalFee: m.withdrawalFee,
            sharePrice: usdg(s.sharePrice),
            omnibusShares: s.omnibusShares.toString(),
            omnibusValue: usdg(value(s.omnibusShares, s.sharePrice)),
            depositsOpen: s.depositsOpen,
            withdrawalsOpen: s.withdrawalsOpen,
            lamps: {
                gates: s.depositsOpen && s.withdrawalsOpen,
                liquidity: m.instantLiquidity === null ? null : m.instantLiquidity > 0n,
                keeper:
                    VAULTS[id].kind === 'glv'
                        ? config.mode === 'fork'
                            ? true
                            : null
                        : null,
            },
        };
    });
    const allocated = allocatedByCustomer(db);
    const customers: CustomerView[] = listCustomers(db).map((c) => {
        const positions = VAULT_IDS.map((vaultId) => {
            const p = getPosition(db, c.id, vaultId);
            const v = value(p.shares, stateOf[vaultId].sharePrice);

            return {
                vaultId,
                shares: p.shares,
                value: v,
                netDeposited: p.netDeposited,
            };
        });
        const earn = positions.reduce((s, p) => s + p.value, 0n);
        const basis = positions.reduce((s, p) => s + p.netDeposited, 0n);

        return {
            id: c.id,
            name: c.name,
            usdg: usdg(c.usdg),
            accepted: c.accepted,
            positions: positions
                .filter((p) => p.shares > 0n)
                .map((p) => ({
                    vaultId: p.vaultId,
                    shares: p.shares.toString(),
                    value: usdg(p.value),
                    netDeposited: usdg(p.netDeposited),
                    earnings: usdg(p.value - p.netDeposited),
                })),
            earnBalance: usdg(earn),
            earnings: usdg(earn - basis),
            arbRewards: arb(allocated[c.id] ?? 0n),
        };
    });
    const books = ledgerShares(db);
    const customerUsdg = listCustomers(db).reduce((s, c) => s + c.usdg, 0n);
    const checks = reconcile({
        sharesByVault: Object.fromEntries(
            VAULT_IDS.map((id) => [
                id,
                { ledger: books[id], onchain: stateOf[id].omnibusShares },
            ]),
        ) as Record<VaultId, { ledger: bigint; onchain: bigint }>,
        usdg: {
            balances: customerUsdg,
            reserved: reservedUsdg(db),
            onchain: health.usdg,
        },
        arb: {
            claimed: totalClaimed(db),
            allocated: rewards.allocated,
            onchain: arbBalance,
        },
    });
    const actions: ActionView[] = listActions(db).map((a) => ({
        id: a.id,
        customerId: a.customerId,
        vaultId: a.vaultId,
        kind: a.kind,
        status: a.status,
        mode: a.mode,
        amount: a.kind === 'withdraw' ? formatUnits(a.amountIn, 18) : usdg(a.amountIn),
        assets: a.assets === null ? null : usdg(a.assets),
        shares: a.shares === null ? null : formatUnits(a.shares, 18),
        txHash: a.txHash,
        reason: a.reason,
        createdAt: a.createdAt,
    }));

    return {
        mode: config.mode,
        explorer: config.mode === 'fork' ? null : 'https://arbiscan.io',
        omnibus: {
            address: chain.omnibus,
            usdg: usdg(health.usdg),
            eth: formatUnits(health.eth, 18),
            arb: arb(arbBalance),
            unassigned: usdg(unassigned),
        },
        vaults,
        customers,
        actions,
        checks: checks.map((c) => ({
            ...c,
            ledger:
                c.rule === 'shares'
                    ? c.ledger.toString()
                    : c.rule === 'usdg'
                      ? usdg(c.ledger)
                      : arb(c.ledger),
            onchain:
                c.rule === 'shares'
                    ? c.onchain.toString()
                    : c.rule === 'usdg'
                      ? usdg(c.onchain)
                      : arb(c.onchain),
        })),
        rewards: {
            accrued: arb(rewards.accrued),
            pending: arb(rewards.pending),
            claimable: arb(rewards.claimable),
            claimed: arb(rewards.claimed),
            allocated: arb(rewards.allocated),
            lastAllocationAt: rewards.lastAllocationAt,
            simulated: rewards.simulated,
        },
        feed: feedFrom(actions),
        error,
        updatedAt: new Date().toISOString(),
    };
}
