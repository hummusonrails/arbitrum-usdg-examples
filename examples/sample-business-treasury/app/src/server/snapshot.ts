import { fromUnits, readWalletHealth } from '@arbitrum-usdg/usdg';

import { currentBand, listActions, type ActionRow, type Ctx } from './actions.ts';
import { getKv } from './db.ts';
import type { PolicyDecision } from './policy.ts';
import { listLedger, type LedgerRow } from './reconcile.ts';

export type FeedLine = { t: string; text: string };

export type Snapshot = {
    mode: string;
    network: string;
    wallet: string;
    explorer: string;
    balances: {
        paxosUsd: string;
        paxosUsdg: string;
        walletUsdg: string;
        inFlight: string;
        converting: string;
    };
    health: {
        paxos: boolean;
        chain: boolean;
        frozen: boolean;
        paused: boolean;
        gasOk: boolean;
    };
    policy: { min: string; target: string; max: string; paused: boolean };
    decision: PolicyDecision | { kind: 'error'; message: string } | null;
    actions: (Omit<ActionRow, 'deposit_raw_tx'> & { amount: string })[];
    ledger: (LedgerRow & { amount: string; onchain_amount: string | null })[];
    feed: FeedLine[];
    history: { t: number; walletUsdg: string }[];
    updatedAt: string;
};

const history: { t: number; walletUsdg: string }[] = [];

function serialize(d: Snapshot['decision']) {
    return d && 'amountUnits' in d
        ? { ...d, amountUnits: d.amountUnits.toString() }
        : d;
}

export async function getSnapshot(
    ctx: Ctx,
    decision: Snapshot['decision'] = null,
): Promise<Snapshot> {
    const band = currentBand(ctx);
    const [paxosBalances, health] = await Promise.all([
        ctx.paxos
            .listProfileBalances(ctx.config.paxos.profileId)
            .catch(() => undefined),
        readWalletHealth(
            ctx.chain.publicClient,
            ctx.config.network,
            ctx.chain.wallet,
        ).catch(() => undefined),
    ]);
    const balanceOf = (asset: string) =>
        paxosBalances?.items?.find((b) => b.asset === asset)?.available ?? '0';
    const actions = listActions(ctx.db);
    const openRedeems = actions.filter(
        (a) => a.kind === 'redeem' && ['processing', 'stuck'].includes(a.status),
    );
    const sum = (rows: typeof actions) =>
        rows.reduce((total, a) => total + BigInt(a.amount_units), 0n);
    // Sent from the wallet but not yet credited at Paxos.
    const inFlight = sum(
        openRedeems.filter((a) => a.step === 'deposit' || a.step === 'travel_rule'),
    );
    // Credited at Paxos and being converted to USD for the bank.
    const converting = sum(openRedeems.filter((a) => a.step === 'convert'));
    const walletUsdg = health ? fromUnits(health.usdg) : '0';

    history.push({ t: Date.now(), walletUsdg });

    if (history.length > 120) {
        history.shift();
    }

    const feed = (
        ctx.db
            .prepare(
                'SELECT id, type, received_at FROM events ORDER BY received_at DESC LIMIT 40',
            )
            .all() as { id: string; type: string; received_at: string }[]
    ).map((e) => ({ t: e.received_at, text: `${e.type}  ${e.id}` }));

    return {
        mode: ctx.config.mode,
        network: ctx.config.network,
        wallet: ctx.chain.wallet,
        explorer:
            ctx.config.network === 'arbitrumSepolia'
                ? 'https://sepolia.arbiscan.io'
                : 'https://arbiscan.io',
        balances: {
            paxosUsd: balanceOf('USD'),
            paxosUsdg: balanceOf('USDG'),
            walletUsdg,
            inFlight: fromUnits(inFlight),
            converting: fromUnits(converting),
        },
        health: {
            paxos: paxosBalances !== undefined,
            chain: health !== undefined,
            frozen: health?.frozen ?? false,
            paused: health?.paused ?? false,
            gasOk: (health?.eth ?? 0n) >= 10n ** 13n,
        },
        policy: {
            min: fromUnits(band.min),
            target: fromUnits(band.target),
            max: fromUnits(band.max),
            paused: getKv(ctx.db, 'policy_paused') === '1',
        },
        decision: serialize(decision) as Snapshot['decision'],
        actions: actions.map(({ deposit_raw_tx: _raw, ...a }) => ({
            ...a,
            amount: fromUnits(BigInt(a.amount_units)),
        })),
        ledger: listLedger(ctx).map((r) => ({
            ...r,
            amount: fromUnits(BigInt(r.amount_units)),
            onchain_amount: r.onchain_amount_units
                ? fromUnits(BigInt(r.onchain_amount_units))
                : null,
        })),
        feed,
        history: [...history],
        updatedAt: new Date().toISOString(),
    };
}
