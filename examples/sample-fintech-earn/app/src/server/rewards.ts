// ARB rewards for the Morpho vaults. Merkl credits them to whoever holds the
// vault shares, which is the omnibus wallet, so Acme Money claims them and then
// shares each claim among customers by how many shares they held, for how long.
import { randomUUID } from 'node:crypto';

import type { Address, Hex } from 'viem';

import { merklDistributorAbi } from './abi.ts';
import { submit } from './chain.ts';
import type { Ctx } from './ctx.ts';
import { getKv, setKv, tx, type Db } from './db.ts';
import { shareHistory, type ShareChange } from './ledger.ts';
import { ARB_TOKEN, MERKL_DISTRIBUTOR, VAULT_IDS, VAULTS } from './vaults/registry.ts';
import type { VaultId } from './vaults/types.ts';

type ByVault = Record<VaultId, bigint>;

const none = (): ByVault => ({ steakhouse: 0n, gauntlet: 0n, glv: 0n });

export type Allocation = { customerId: string; vaultId: VaultId; amount: bigint };

// Splits each vault's reward among customers by share-seconds over [from, to].
// Each customer gets the floor of their share; what rounding leaves over is
// carried into the next allocation, so nothing is ever handed out twice.
export function allocate(input: {
    amountByVault: ByVault;
    history: ShareChange[];
    from: number;
    to: number;
    carry: ByVault;
}): { allocations: Allocation[]; carry: ByVault } {
    const allocations: Allocation[] = [];
    const carry = none();

    for (const vaultId of VAULT_IDS) {
        const pot = input.amountByVault[vaultId] + input.carry[vaultId];
        const weights = new Map<string, bigint>();
        const byCustomer = new Map<string, ShareChange[]>();

        for (const change of input.history) {
            if (change.vaultId === vaultId) {
                byCustomer.set(change.customerId, [
                    ...(byCustomer.get(change.customerId) ?? []),
                    change,
                ]);
            }
        }

        for (const [customerId, changes] of byCustomer) {
            let weight = 0n;
            let shares = 0n;
            let since = input.from;

            for (const c of changes) {
                if (c.at <= input.from) {
                    shares = c.shares;
                    continue;
                }

                if (c.at >= input.to) {
                    break;
                }

                weight += shares * BigInt(c.at - since);
                shares = c.shares;
                since = c.at;
            }

            weight += shares * BigInt(input.to - since);

            if (weight > 0n) {
                weights.set(customerId, weight);
            }
        }

        const total = [...weights.values()].reduce((s, w) => s + w, 0n);
        let given = 0n;

        if (total > 0n) {
            for (const [customerId, weight] of weights) {
                const amount = (pot * weight) / total;

                if (amount > 0n) {
                    allocations.push({ customerId, vaultId, amount });
                    given += amount;
                }
            }
        }

        carry[vaultId] = pot - given;
    }

    return { allocations, carry };
}

// How much of a claim is new reward per vault. Merkl's per vault breakdown is
// cumulative, so new reward is the growth since what was already counted,
// which never goes down. What is shared can never exceed what the claim just
// paid, so if the books and the breakdown disagree (records reset, a crash
// between claim and bookkeeping) each vault's part is scaled down to fit.
export function splitClaim(
    cumulative: ByVault,
    counted: ByVault,
    claimed: bigint,
): { fresh: ByVault; counted: ByVault } {
    const next = none();
    const fresh = none();

    for (const v of VAULT_IDS) {
        next[v] = cumulative[v] > counted[v] ? cumulative[v] : counted[v];
        fresh[v] = next[v] - counted[v];
    }

    const total = VAULT_IDS.reduce((s, v) => s + fresh[v], 0n);

    if (total > claimed) {
        for (const v of VAULT_IDS) {
            fresh[v] = (fresh[v] * claimed) / total;
        }
    }

    return { fresh, counted: next };
}

type MerklReward = {
    token: { address: string };
    amount: string;
    claimed: string;
    pending: string;
    proofs: Hex[];
    breakdowns: { reason: string; amount: string; pending: string }[];
};

// The omnibus wallet's ARB from the Merkl API (or the fork stand in, which
// serves the same shape).
async function readMerkl(ctx: Ctx): Promise<MerklReward | null> {
    const url = `${ctx.config.merklApiUrl}/v4/users/${ctx.chain.omnibus}/rewards?chainId=42161&reloadChainId=42161`;
    const res = await fetch(url, { signal: AbortSignal.timeout(15_000) });

    if (!res.ok) {
        throw new Error(`${url} returned ${res.status}`);
    }

    const chains = (await res.json()) as { rewards: MerklReward[] }[];

    return (
        chains
            .flatMap((c) => c.rewards)
            .find((r) => r.token.address.toLowerCase() === ARB_TOKEN.toLowerCase()) ??
        null
    );
}

// Cumulative reward per vault, from Merkl's breakdown reasons, which name the
// vault token: "ERC20_<vault address>".
function byVault(reward: MerklReward | null, field: 'amount' | 'pending'): ByVault {
    const out = none();

    for (const b of reward?.breakdowns ?? []) {
        const id = VAULT_IDS.find((v) =>
            b.reason.toLowerCase().endsWith(VAULTS[v].address.toLowerCase()),
        );

        if (id) {
            out[id] += BigInt(b[field]);
        }
    }

    return out;
}

async function claimedOnchain(ctx: Ctx): Promise<bigint> {
    const [amount] = await ctx.chain.publicClient.readContract({
        address: MERKL_DISTRIBUTOR,
        abi: merklDistributorAbi,
        functionName: 'claimed',
        args: [ctx.chain.omnibus, ARB_TOKEN],
    });

    return amount;
}

const readByVault = (db: Db, key: string): ByVault => {
    const raw = getKv(db, key);
    const parsed = raw ? (JSON.parse(raw) as Record<VaultId, string>) : undefined;

    return {
        steakhouse: BigInt(parsed?.steakhouse ?? 0),
        gauntlet: BigInt(parsed?.gauntlet ?? 0),
        glv: BigInt(parsed?.glv ?? 0),
    };
};

const writeByVault = (db: Db, key: string, value: ByVault) =>
    setKv(
        db,
        key,
        JSON.stringify(
            Object.fromEntries(VAULT_IDS.map((v) => [v, value[v].toString()])),
        ),
    );

export function allocatedByCustomer(db: Db): Record<string, bigint> {
    const rows = db
        .prepare('SELECT customer_id, amount FROM reward_allocations')
        .all() as {
        customer_id: string;
        amount: string;
    }[];
    const out: Record<string, bigint> = {};

    for (const r of rows) {
        out[r.customer_id] = (out[r.customer_id] ?? 0n) + BigInt(r.amount);
    }

    return out;
}

export function totalClaimed(db: Db): bigint {
    const rows = db.prepare('SELECT amount FROM reward_claims').all() as {
        amount: string;
    }[];

    return rows.reduce((s, r) => s + BigInt(r.amount), 0n);
}

export type RewardsState = {
    // Everything Merkl has credited so far, in the live root or still pending.
    accrued: bigint;
    // Earned but not yet in a Merkle root, so not claimable yet.
    pending: bigint;
    claimable: bigint;
    claimed: bigint;
    allocated: bigint;
    byCustomer: Record<string, bigint>;
    lastAllocationAt: string | null;
    simulated: boolean;
    // Set when the rewards service could not be reached this pass.
    unavailable?: boolean;
};

export async function readRewards(ctx: Ctx): Promise<RewardsState> {
    const [reward, claimed] = await Promise.all([readMerkl(ctx), claimedOnchain(ctx)]);
    const amount = BigInt(reward?.amount ?? 0);
    const pending = BigInt(reward?.pending ?? 0);
    const byCustomer = allocatedByCustomer(ctx.db);
    const last = getKv(ctx.db, 'rewards_last_allocation_at');

    return {
        accrued: amount + pending,
        pending,
        claimable: amount > claimed ? amount - claimed : 0n,
        claimed,
        allocated: Object.values(byCustomer).reduce((s, v) => s + v, 0n),
        byCustomer,
        lastAllocationAt: last ? new Date(Number(last)).toISOString() : null,
        simulated: ctx.config.mode === 'fork',
    };
}

// Claims everything claimable for the omnibus wallet, then shares the newly
// claimed ARB among customers.
export async function claimAndAllocate(
    ctx: Ctx,
): Promise<{ claimed: bigint; allocated: bigint }> {
    const reward = await readMerkl(ctx);
    const before = await claimedOnchain(ctx);
    const amount = BigInt(reward?.amount ?? 0);

    if (!reward || amount <= before) {
        return { claimed: 0n, allocated: 0n };
    }

    const receipt = await submit(ctx.chain, {
        address: MERKL_DISTRIBUTOR,
        abi: merklDistributorAbi,
        functionName: 'claim',
        args: [[ctx.chain.omnibus as Address], [ARB_TOKEN], [amount], [reward.proofs]],
    });
    const claimed = amount - before;
    const { fresh, counted } = splitClaim(
        byVault(reward, 'amount'),
        readByVault(ctx.db, 'rewards_claimed_by_vault'),
        claimed,
    );

    const now = Date.now();
    const history = shareHistory(ctx.db);
    const from = Number(
        getKv(ctx.db, 'rewards_last_allocation_at') ?? history[0]?.at ?? now,
    );
    const result = allocate({
        amountByVault: fresh,
        history,
        from,
        to: now,
        carry: readByVault(ctx.db, 'rewards_carry'),
    });
    const id = randomUUID();

    tx(ctx.db, () => {
        ctx.db
            .prepare(
                'INSERT INTO reward_claims (id, tx_hash, amount, at) VALUES (?, ?, ?, ?)',
            )
            .run(id, receipt.transactionHash, claimed.toString(), now);

        for (const a of result.allocations) {
            ctx.db
                .prepare(
                    'INSERT INTO reward_allocations (claim_id, customer_id, vault_id, amount) VALUES (?, ?, ?, ?)',
                )
                .run(id, a.customerId, a.vaultId, a.amount.toString());
        }

        writeByVault(ctx.db, 'rewards_claimed_by_vault', counted);
        writeByVault(ctx.db, 'rewards_carry', result.carry);
        setKv(ctx.db, 'rewards_last_allocation_at', String(now));
    });

    return {
        claimed,
        allocated: result.allocations.reduce((s, a) => s + a.amount, 0n),
    };
}
