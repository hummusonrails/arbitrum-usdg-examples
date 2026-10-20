// Treasury actions: minting USD into USDG on Arbitrum, and redeeming USDG
// back to USD in the bank. Every step is written to the database before it
// happens, so a restart picks up where it left off without repeating work.
import {
    PaxosApiError,
    type Orchestration,
    type PaxosClient,
    type Transfer,
} from '@arbitrum-usdg/paxos-client';
import {
    decodeUsdgError,
    fromPaxosAmount,
    fromUnits,
    readWalletHealth,
} from '@arbitrum-usdg/usdg';
import { parseTransaction, type Address, type Hex } from 'viem';

import type { Chain } from './chain.ts';
import type { Config } from './config.ts';
import { getKv, setKv, type Db } from './db.ts';
import { decide, type Band, type PolicyDecision } from './policy.ts';

export type Ctx = { db: Db; paxos: PaxosClient; chain: Chain; config: Config };

export type ActionKind = 'mint' | 'redeem';
export type ActionStatus =
    'processing' | 'stuck' | 'completed' | 'failed' | 'cancelled';
// Redeem steps: deposit (USDG sent to Paxos), travel_rule (answering the
// deposit hold), convert (USDG to USD to the bank), done.
export type ActionStep =
    'orchestration' | 'deposit' | 'travel_rule' | 'convert' | 'done';

export type ActionRow = {
    ref_id: string;
    kind: ActionKind;
    amount_units: string;
    status: ActionStatus;
    step: ActionStep;
    orchestration_id: string | null;
    deposit_tx_hash: string | null;
    deposit_raw_tx: string | null;
    transfer_id: string | null;
    convert_attempt: number;
    error: string | null;
    created_at: string;
    updated_at: string;
};

export class PreflightError extends Error {
    constructor(
        readonly reason:
            | 'frozen'
            | 'paused'
            | 'no_gas'
            | 'insufficient'
            | 'no_deposit_address'
            | 'no_bank'
            | 'chain',
        message: string,
    ) {
        super(message);
        this.name = 'PreflightError';
    }
}

// An action that was recorded but that Paxos or the chain refused. The
// action row holds the same reason.
export class ActionFailedError extends Error {
    constructor(message: string) {
        super(message);
        this.name = 'ActionFailedError';
    }
}

// Enough ETH on Arbitrum for a handful of token transfers.
const MIN_GAS_WEI = 10n ** 13n;
const CENT_UNITS = 10_000n;
const TERMINAL: ActionStatus[] = ['completed', 'failed', 'cancelled'];

const now = () => new Date().toISOString();

export function refIdFor(db: Db, kind: ActionKind): string {
    const key = `seq_${kind}`;
    const next = Number(getKv(db, key) ?? '0') + 1;

    setKv(db, key, String(next));

    return `treasury-${kind}-${Date.now()}-${next}`;
}

export function getAction(db: Db, refId: string): ActionRow | undefined {
    return db.prepare('SELECT * FROM actions WHERE ref_id = ?').get(refId) as
        ActionRow | undefined;
}

export function listActions(db: Db): ActionRow[] {
    return db
        .prepare('SELECT * FROM actions ORDER BY created_at DESC')
        .all() as ActionRow[];
}

function updateAction(db: Db, refId: string, fields: Partial<ActionRow>) {
    const keys = Object.keys(fields);

    db.prepare(
        `UPDATE actions SET ${keys.map((k) => `${k} = ?`).join(', ')}, updated_at = ? WHERE ref_id = ?`,
    ).run(
        ...keys.map((k) => fields[k as keyof ActionRow] as string | number | null),
        now(),
        refId,
    );
}

type LedgerFields = {
    id: string;
    ref_id?: string | null;
    source?: 'app' | 'rule';
    direction?: 'in' | 'out';
    amount_units?: string;
    paxos_status?: string | null;
    orchestration_id?: string | null;
    transfer_id?: string | null;
    crypto_tx_hash?: string | null;
    status?: string;
    reason?: string | null;
};

// Inserts or updates one ledger row; reconciliation fills the onchain side.
export function upsertLedger(db: Db, row: LedgerFields) {
    const existing = db.prepare('SELECT id FROM ledger WHERE id = ?').get(row.id);

    if (!existing) {
        db.prepare(
            `INSERT INTO ledger (id, ref_id, source, direction, amount_units, paxos_status,
              orchestration_id, transfer_id, crypto_tx_hash, status, reason, updated_at)
             VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
        ).run(
            row.id,
            row.ref_id ?? null,
            row.source ?? 'app',
            row.direction ?? 'in',
            row.amount_units ?? '0',
            row.paxos_status ?? null,
            row.orchestration_id ?? null,
            row.transfer_id ?? null,
            row.crypto_tx_hash ?? null,
            row.status ?? 'pending',
            row.reason ?? null,
            now(),
        );

        return;
    }

    const fields = Object.entries(row).filter(
        ([k, v]) => k !== 'id' && v !== undefined,
    );

    if (fields.length > 0) {
        db.prepare(
            `UPDATE ledger SET ${fields.map(([k]) => `${k} = ?`).join(', ')}, updated_at = ? WHERE id = ?`,
        ).run(...fields.map(([, v]) => v as string | null), now(), row.id);
    }
}

function reasonOf(t: Transfer | undefined, o?: Orchestration): string | null {
    const details = o?.status_details as
        Record<string, { message?: string }> | undefined;

    return (
        t?.secondary_status?.detail ??
        t?.secondary_status?.name ??
        Object.keys(t?.status_details ?? {})[0] ??
        o?.fail_reason?.detail ??
        (details ? Object.values(details)[0]?.message : undefined) ??
        null
    );
}

// A readable reason from a Paxos API error, for the dashboard and the log.
function paxosReason(err: unknown): string {
    if (err instanceof PaxosApiError) {
        const body = err.body as { detail?: string; title?: string } | null;

        return body?.detail ?? body?.title ?? `Paxos returned ${err.status}`;
    }

    return err instanceof Error ? err.message : String(err);
}

async function createOrReuseOrchestration(
    paxos: PaxosClient,
    body: Parameters<PaxosClient['createOrchestration']>[0],
): Promise<Orchestration> {
    try {
        return await paxos.createOrchestration(body);
    } catch (err) {
        // A 409 means this ref_id already exists, for example after a restart.
        if (err instanceof PaxosApiError && err.status === 409) {
            const existing = (err.body as { meta?: { existing?: Orchestration } })?.meta
                ?.existing;

            if (existing?.id) {
                return existing;
            }

            const list = await paxos.listOrchestrations({ ref_id: [body.ref_id] });

            if (list.items?.[0]) {
                return list.items[0];
            }
        }

        throw err;
    }
}

function mintBody(ctx: Ctx, refId: string, units: bigint) {
    return {
        ref_id: refId,
        source_asset: 'USD',
        source_amount: fromUnits(units),
        destination_asset: 'USDG',
        source: { profile: { profile_id: ctx.config.paxos.profileId } },
        destination: { crypto: { address: ctx.chain.wallet, network: 'ARBITRUM_ONE' } },
    };
}

function fail(ctx: Ctx, refId: string, status: 'failed' | 'stuck', reason: string) {
    updateAction(ctx.db, refId, { status, error: reason });
    upsertLedger(ctx.db, { id: refId, status, reason });
}

export async function startMint(ctx: Ctx, amountUnits: bigint): Promise<ActionRow> {
    // USD moves in cents, so round the mint up to the next cent.
    const units = ((amountUnits + CENT_UNITS - 1n) / CENT_UNITS) * CENT_UNITS;
    const refId = refIdFor(ctx.db, 'mint');

    ctx.db
        .prepare(
            `INSERT INTO actions (ref_id, kind, amount_units, status, step, created_at, updated_at)
             VALUES (?, 'mint', ?, 'processing', 'orchestration', ?, ?)`,
        )
        .run(refId, units.toString(), now(), now());
    upsertLedger(ctx.db, {
        id: refId,
        ref_id: refId,
        source: 'app',
        direction: 'in',
        amount_units: units.toString(),
    });

    let o: Orchestration;

    try {
        o = await createOrReuseOrchestration(ctx.paxos, mintBody(ctx, refId, units));
    } catch (err) {
        const reason = paxosReason(err);

        fail(ctx, refId, 'failed', reason);
        throw new ActionFailedError(reason);
    }

    updateAction(ctx.db, refId, { orchestration_id: o.id ?? null });
    await onOrchestration(ctx, o);

    return getAction(ctx.db, refId)!;
}

function bankAccountId(ctx: Ctx): string | undefined {
    return ctx.config.paxos.bankAccountId ?? getKv(ctx.db, 'bank_account_id');
}

async function preflightRedeem(ctx: Ctx, units: bigint): Promise<Address> {
    const health = await readWalletHealth(
        ctx.chain.publicClient,
        ctx.config.network,
        ctx.chain.wallet,
    );

    if (health.frozen) {
        throw new PreflightError(
            'frozen',
            'This wallet is frozen by the token issuer, so USDG cannot move from it.',
        );
    }

    if (health.paused) {
        throw new PreflightError(
            'paused',
            'USDG transfers are paused by the token issuer.',
        );
    }

    if (health.eth < MIN_GAS_WEI) {
        throw new PreflightError(
            'no_gas',
            'Add ETH to the treasury wallet to pay for gas.',
        );
    }

    if (health.usdg < units) {
        throw new PreflightError(
            'insufficient',
            `The wallet holds ${fromUnits(health.usdg)} USDG, less than ${fromUnits(units)}.`,
        );
    }

    const depositAddress = getKv(ctx.db, 'deposit_address');

    if (!depositAddress) {
        throw new PreflightError(
            'no_deposit_address',
            'Run setup first so the app has a Paxos deposit address on Arbitrum.',
        );
    }

    // USDG only leaves the wallet when the bank it will pay out to is ready.
    const bankId = bankAccountId(ctx);
    const bank = bankId
        ? await ctx.paxos.getFiatAccount(bankId).catch(() => undefined)
        : undefined;

    if (bank?.status !== 'APPROVED') {
        throw new PreflightError(
            'no_bank',
            bankId
                ? `The bank account is ${bank?.status ?? 'not reachable'}. Redeems wait until it is APPROVED.`
                : 'Set up a bank account first. Run setup or set PAXOS_BANK_ACCOUNT_ID.',
        );
    }

    return depositAddress as Address;
}

export async function startRedeem(ctx: Ctx, amountUnits: bigint): Promise<ActionRow> {
    const depositAddress = await preflightRedeem(ctx, amountUnits);
    let signed: { hash: Hex; raw: Hex };

    try {
        signed = await ctx.chain.signUsdgTransfer(depositAddress, amountUnits);
    } catch (err) {
        throw new PreflightError('chain', decodeUsdgError(err).message);
    }

    const refId = refIdFor(ctx.db, 'redeem');

    // Record the signed transaction before broadcasting it, so a restart can
    // rebroadcast the same transaction instead of sending a second one.
    ctx.db
        .prepare(
            `INSERT INTO actions (ref_id, kind, amount_units, status, step, deposit_tx_hash,
              deposit_raw_tx, created_at, updated_at)
             VALUES (?, 'redeem', ?, 'processing', 'deposit', ?, ?, ?, ?)`,
        )
        .run(refId, amountUnits.toString(), signed.hash, signed.raw, now(), now());
    upsertLedger(ctx.db, {
        id: refId,
        ref_id: refId,
        source: 'app',
        direction: 'out',
        amount_units: amountUnits.toString(),
        crypto_tx_hash: signed.hash,
    });

    try {
        await ctx.chain.broadcast(signed.raw);
    } catch (err) {
        const reason = `The USDG transfer was not accepted by Arbitrum: ${decodeUsdgError(err).message}`;

        fail(ctx, refId, 'stuck', reason);
        throw new ActionFailedError(reason);
    }

    return getAction(ctx.db, refId)!;
}

async function startConvert(ctx: Ctx, action: ActionRow) {
    const bankId = bankAccountId(ctx);
    const attempt = action.convert_attempt;
    const refId =
        attempt === 0
            ? `${action.ref_id}-convert`
            : `${action.ref_id}-convert-${attempt}`;

    if (!bankId) {
        fail(
            ctx,
            action.ref_id,
            'stuck',
            'No bank account is set up. Run setup or set PAXOS_BANK_ACCOUNT_ID.',
        );
        updateAction(ctx.db, action.ref_id, { step: 'convert' });

        return;
    }

    updateAction(ctx.db, action.ref_id, {
        step: 'convert',
        status: 'processing',
        error: null,
    });

    let o: Orchestration;

    try {
        o = await createOrReuseOrchestration(ctx.paxos, {
            ref_id: refId,
            source_asset: 'USDG',
            source_amount: fromUnits(BigInt(action.amount_units)),
            destination_asset: 'USD',
            source: { profile: { profile_id: ctx.config.paxos.profileId } },
            destination: { fiat: { bank_account_id: bankId, memo: action.ref_id } },
        });
    } catch (err) {
        // The USDG is safe in the Paxos account; the operator can retry.
        fail(
            ctx,
            action.ref_id,
            'stuck',
            `Paxos did not start the conversion to USD: ${paxosReason(err)}`,
        );

        return;
    }

    updateAction(ctx.db, action.ref_id, { orchestration_id: o.id ?? null });
    await onOrchestration(ctx, o);
}

function actionForOrchestration(db: Db, o: Orchestration): ActionRow | undefined {
    const ref = o.ref_id ?? '';
    const base = ref.replace(/-convert(-\d+)?$/, '');

    return getAction(db, base);
}

// Evaluates a mint from its orchestration and, above all, its withdrawal
// transfer: the orchestration can read COMPLETED before the withdrawal has
// settled or after it has failed.
async function evaluateMint(ctx: Ctx, action: ActionRow, o: Orchestration) {
    const status = o.status ?? 'PENDING';
    const transferId = o.destination_transfer?.transfer_id;
    const transfer = transferId ? await ctx.paxos.getTransfer(transferId) : undefined;

    upsertLedger(ctx.db, {
        id: action.ref_id,
        paxos_status: transfer?.status ?? status,
        orchestration_id: o.id ?? null,
        transfer_id: transferId ?? null,
        crypto_tx_hash: transfer?.crypto_tx_hash || null,
    });

    if (transfer?.status === 'FAILED' || status === 'FAILED' || status === 'REJECTED') {
        fail(
            ctx,
            action.ref_id,
            'failed',
            reasonOf(transfer, o) ?? 'Paxos did not deliver the USDG.',
        );
    } else if (status === 'COMPLETED' && transfer?.status === 'COMPLETED') {
        updateAction(ctx.db, action.ref_id, {
            status: 'completed',
            step: 'done',
            error: null,
        });
    }
}

export async function onOrchestration(ctx: Ctx, o: Orchestration): Promise<void> {
    const action = actionForOrchestration(ctx.db, o);
    const status = o.status ?? 'PENDING';

    if (!action) {
        if (o.orchestration_rule_id && o.id) {
            await recordRuleInflow(ctx, o);
        }

        return;
    }

    if (TERMINAL.includes(action.status)) {
        return;
    }

    if (action.kind === 'mint') {
        await evaluateMint(ctx, action, o);

        return;
    }

    if (action.step !== 'convert' || !(o.ref_id ?? '').includes('-convert')) {
        return;
    }

    upsertLedger(ctx.db, { id: action.ref_id, orchestration_id: o.id ?? null });

    if (status === 'COMPLETED') {
        updateAction(ctx.db, action.ref_id, {
            status: 'completed',
            step: 'done',
            error: null,
        });
    } else if (status === 'FAILED' || status === 'REJECTED') {
        fail(
            ctx,
            action.ref_id,
            'stuck',
            reasonOf(undefined, o) ?? 'The conversion to USD did not complete.',
        );
    }
}

// Inflows from the auto mint rule that setup created, delivered to this
// treasury wallet. Other rules on the account are not this app's business.
async function recordRuleInflow(ctx: Ctx, o: Orchestration) {
    const ruleId = getKv(ctx.db, 'rule_id');
    const destination = (o.destination as { crypto?: { address?: string } } | undefined)
        ?.crypto?.address;

    if (
        o.orchestration_rule_id !== ruleId ||
        (destination && destination.toLowerCase() !== ctx.chain.wallet.toLowerCase())
    ) {
        return;
    }

    const transferId = o.destination_transfer?.transfer_id;
    const transfer = transferId ? await ctx.paxos.getTransfer(transferId) : undefined;
    const failed =
        transfer?.status === 'FAILED' ||
        o.status === 'FAILED' ||
        o.status === 'REJECTED';

    upsertLedger(ctx.db, {
        id: o.id!,
        ref_id: o.ref_id ?? null,
        source: 'rule',
        direction: 'in',
        amount_units: fromPaxosAmount(o.source_amount ?? '0').toString(),
        paxos_status: transfer?.status ?? o.status ?? null,
        orchestration_id: o.id ?? null,
        transfer_id: transferId ?? null,
        crypto_tx_hash: transfer?.crypto_tx_hash || null,
        ...(failed ? { status: 'failed', reason: reasonOf(transfer, o) } : {}),
    });
}

export async function onTransfer(ctx: Ctx, t: Transfer): Promise<void> {
    if (t.type === 'CRYPTO_WITHDRAWAL') {
        await onWithdrawal(ctx, t);

        return;
    }

    if (t.type !== 'CRYPTO_DEPOSIT' || !t.crypto_tx_hash) {
        return;
    }

    const action = ctx.db
        .prepare(
            "SELECT * FROM actions WHERE kind = 'redeem' AND lower(deposit_tx_hash) = lower(?)",
        )
        .get(t.crypto_tx_hash) as ActionRow | undefined;

    if (!action || TERMINAL.includes(action.status) || action.step === 'convert') {
        return;
    }

    updateAction(ctx.db, action.ref_id, { transfer_id: t.id ?? null });
    upsertLedger(ctx.db, {
        id: action.ref_id,
        transfer_id: t.id ?? null,
        paxos_status: t.status,
    });

    if (t.status === 'FAILED') {
        fail(
            ctx,
            action.ref_id,
            'stuck',
            reasonOf(t) ?? 'Paxos did not accept the deposit.',
        );

        return;
    }

    if (t.secondary_status?.name === 'TRAVEL_RULE_INFO_REQUESTED') {
        await answerTravelRule(ctx, action, t);

        return;
    }

    if (t.status === 'COMPLETED') {
        await startConvert(ctx, getAction(ctx.db, action.ref_id)!);
    }
}

// A mint or rule withdrawal settled after its orchestration was seen:
// evaluate the orchestration again with the settled transfer.
async function onWithdrawal(ctx: Ctx, t: Transfer) {
    const row = ctx.db
        .prepare('SELECT orchestration_id FROM ledger WHERE transfer_id = ?')
        .get(t.id ?? '') as { orchestration_id: string | null } | undefined;

    if (row?.orchestration_id) {
        await onOrchestration(
            ctx,
            await ctx.paxos.getOrchestration(row.orchestration_id),
        );
    }
}

// Paxos holds deposits from a new sending address until it knows who sent
// them. The treasury wallet belongs to the business, so the answer is the
// business itself.
async function answerTravelRule(ctx: Ctx, action: ActionRow, t: Transfer) {
    const identityId = ctx.config.paxos.identityId ?? t.identity_id;

    if (!identityId) {
        fail(
            ctx,
            action.ref_id,
            'stuck',
            'Paxos needs the sender of this deposit. Set PAXOS_IDENTITY_ID.',
        );
        updateAction(ctx.db, action.ref_id, { step: 'travel_rule' });

        return;
    }

    try {
        await ctx.paxos.updateCryptoDeposit(t.id!, {
            identity_id: identityId,
            originator_address_info: {
                institution_info: {
                    institution_name: ctx.config.paxos.institutionName,
                },
            },
        });
    } catch (err) {
        if (!(err instanceof PaxosApiError && err.status === 409)) {
            fail(
                ctx,
                action.ref_id,
                'stuck',
                `Paxos did not accept the sender details: ${paxosReason(err)}`,
            );
            updateAction(ctx.db, action.ref_id, { step: 'travel_rule' });

            return;
        }
    }

    updateAction(ctx.db, action.ref_id, {
        step: 'travel_rule',
        status: 'processing',
        error: null,
    });
}

export async function retryStuck(ctx: Ctx, refId: string): Promise<ActionRow> {
    const action = getAction(ctx.db, refId);

    if (!action || action.status !== 'stuck') {
        throw new Error(`No stuck action ${refId}`);
    }

    upsertLedger(ctx.db, { id: refId, status: 'pending', reason: null });

    if (action.step === 'convert') {
        updateAction(ctx.db, refId, { convert_attempt: action.convert_attempt + 1 });
        await startConvert(ctx, getAction(ctx.db, refId)!);
    } else {
        updateAction(ctx.db, refId, { status: 'processing', error: null });

        if (action.transfer_id) {
            await onTransfer(ctx, await ctx.paxos.getTransfer(action.transfer_id));
        }
    }

    return getAction(ctx.db, refId)!;
}

// Leaves the USDG where it is and stops tracking the redeem.
export function cancelStuck(ctx: Ctx, refId: string): ActionRow {
    const action = getAction(ctx.db, refId);

    if (!action || action.status !== 'stuck') {
        throw new Error(`No stuck action ${refId}`);
    }

    updateAction(ctx.db, refId, { status: 'cancelled' });
    upsertLedger(ctx.db, {
        id: refId,
        status: 'failed',
        reason:
            action.step === 'deposit'
                ? 'Cancelled. The USDG did not leave the wallet.'
                : 'Cancelled. The USDG stays in the Paxos account.',
    });

    return getAction(ctx.db, refId)!;
}

// The deposit leg of a redeem: rebroadcast the stored transaction if the
// chain has not seen it, and notice a revert or a replaced nonce.
async function checkDeposit(ctx: Ctx, action: ActionRow) {
    const hash = action.deposit_tx_hash as Hex;
    const receipt = await ctx.chain.publicClient
        .getTransactionReceipt({ hash })
        .catch(() => undefined);

    if (receipt?.status === 'reverted') {
        fail(
            ctx,
            action.ref_id,
            'stuck',
            'The USDG transfer reverted on Arbitrum. Cancel it and redeem again.',
        );

        return;
    }

    if (receipt || !action.deposit_raw_tx) {
        return;
    }

    const nonce = parseTransaction(action.deposit_raw_tx as Hex).nonce ?? 0;
    const confirmed = await ctx.chain.publicClient.getTransactionCount({
        address: ctx.chain.wallet,
        blockTag: 'latest',
    });

    if (confirmed > nonce) {
        fail(
            ctx,
            action.ref_id,
            'stuck',
            'Another transaction from the wallet replaced this USDG transfer. Cancel it and redeem again.',
        );

        return;
    }

    await ctx.chain.broadcast(action.deposit_raw_tx as Hex);
}

// Brings every unfinished action and rule inflow up to date from Paxos and the
// chain. Runs on boot and on every loop pass, so a missed event or a restart
// never leaves work hanging. Nothing is sent twice: mints reuse their ref_id,
// and a redeem rebroadcasts its stored signed transaction.
export async function refreshOpen(ctx: Ctx): Promise<void> {
    const open = ctx.db
        .prepare("SELECT * FROM actions WHERE status = 'processing'")
        .all() as ActionRow[];

    for (const action of open) {
        try {
            if (action.kind === 'mint') {
                const o = action.orchestration_id
                    ? await ctx.paxos.getOrchestration(action.orchestration_id)
                    : ((await ctx.paxos.listOrchestrations({ ref_id: [action.ref_id] }))
                          .items?.[0] ??
                      (await createOrReuseOrchestration(
                          ctx.paxos,
                          mintBody(ctx, action.ref_id, BigInt(action.amount_units)),
                      )));

                updateAction(ctx.db, action.ref_id, { orchestration_id: o.id ?? null });
                await onOrchestration(ctx, o);
                continue;
            }

            if (action.step === 'deposit') {
                await checkDeposit(ctx, action);
            }

            if (action.transfer_id && action.step !== 'convert') {
                await onTransfer(ctx, await ctx.paxos.getTransfer(action.transfer_id));
            }

            if (action.step === 'convert') {
                const suffix =
                    action.convert_attempt === 0
                        ? '-convert'
                        : `-convert-${action.convert_attempt}`;
                const list = await ctx.paxos.listOrchestrations({
                    ref_id: [`${action.ref_id}${suffix}`],
                });

                if (list.items?.[0]) {
                    await onOrchestration(ctx, list.items[0]);
                } else {
                    await startConvert(ctx, action);
                }
            }
        } catch (err) {
            console.error(`refresh ${action.ref_id}`, err);
        }
    }

    const rules = ctx.db
        .prepare(
            "SELECT orchestration_id FROM ledger WHERE source = 'rule' AND status = 'pending' AND (crypto_tx_hash IS NULL OR paxos_status != 'COMPLETED')",
        )
        .all() as { orchestration_id: string }[];

    for (const row of rules) {
        try {
            await onOrchestration(
                ctx,
                await ctx.paxos.getOrchestration(row.orchestration_id),
            );
        } catch (err) {
            console.error(`refresh rule inflow ${row.orchestration_id}`, err);
        }
    }
}

export function currentBand(ctx: Ctx): Band {
    const stored = getKv(ctx.db, 'policy_band');

    if (!stored) {
        return ctx.config.policy;
    }

    const b = JSON.parse(stored) as { min: string; target: string; max: string };

    return { min: BigInt(b.min), target: BigInt(b.target), max: BigInt(b.max) };
}

// One policy evaluation: read the chain and the database, decide, and start
// at most one action.
export async function tick(ctx: Ctx): Promise<PolicyDecision> {
    const health = await readWalletHealth(
        ctx.chain.publicClient,
        ctx.config.network,
        ctx.chain.wallet,
    );
    const open = ctx.db
        .prepare("SELECT * FROM actions WHERE status IN ('processing', 'stuck')")
        .all() as ActionRow[];
    const inFlightUnits = open
        .filter((a) => a.kind === 'redeem')
        .reduce((sum, a) => sum + BigInt(a.amount_units), 0n);
    const pendingRule = ctx.db
        .prepare(
            "SELECT 1 FROM ledger WHERE source = 'rule' AND status = 'pending' AND paxos_status IN ('PENDING', 'PROCESSING') LIMIT 1",
        )
        .get();
    const decision = decide({
        walletUnits: health.usdg,
        inFlightUnits,
        pending:
            open.some((a) => a.status === 'processing') || pendingRule !== undefined,
        stuck: open.some((a) => a.status === 'stuck'),
        paused: getKv(ctx.db, 'policy_paused') === '1',
        band: currentBand(ctx),
    });

    if (decision.kind === 'mint') {
        await startMint(ctx, decision.amountUnits);
    } else if (decision.kind === 'redeem') {
        await startRedeem(ctx, decision.amountUnits);
    }

    return decision;
}
