// Moving a customer's money into and out of vaults. The rule throughout: a
// customer's balances change only once the chain says the money moved. For
// GLV that means after the keeper executes the request, not when it is sent.
import { randomUUID } from 'node:crypto';

import { USDG, usdgAbi } from '@arbitrum-usdg/usdg';
import { formatUnits, type Hex } from 'viem';

import { ActionError } from './chain.ts';
import type { Ctx } from './ctx.ts';
import { tx, type Db } from './db.ts';
import {
    addUsdg,
    getCustomer,
    getPosition,
    setPosition,
    sharesByVault,
    totalCustomerUsdg,
} from './ledger.ts';
import { VAULTS } from './vaults/registry.ts';
import type { Settlement, Submitted, VaultId } from './vaults/types.ts';

// A request the app refused before anything was sent. Its message is written
// for the customer.
export class PreflightError extends Error {
    constructor(
        message: string,
        readonly maxNow?: bigint,
    ) {
        super(message);
    }
}

export type ActionKind = 'deposit' | 'withdraw' | 'fund' | 'assign';
export type ActionStatus =
    'submitted' | 'pending' | 'executed' | 'cancelled' | 'failed';

export type Action = {
    id: string;
    customerId: string | null;
    vaultId: VaultId | null;
    kind: ActionKind;
    amountIn: bigint;
    assets: bigint | null;
    shares: bigint | null;
    status: ActionStatus;
    mode: 'sync' | 'async' | null;
    txHash: string | null;
    requestKey: string | null;
    reason: string | null;
    createdAt: string;
    updatedAt: string;
};

type ActionRow = {
    id: string;
    customer_id: string | null;
    vault_id: VaultId | null;
    kind: ActionKind;
    amount_in: string;
    assets_units: string | null;
    shares: string | null;
    status: ActionStatus;
    mode: 'sync' | 'async' | null;
    tx_hash: string | null;
    request_key: string | null;
    reason: string | null;
    created_at: string;
    updated_at: string;
};

function toAction(r: ActionRow): Action {
    return {
        id: r.id,
        customerId: r.customer_id,
        vaultId: r.vault_id,
        kind: r.kind,
        amountIn: BigInt(r.amount_in),
        assets: r.assets_units === null ? null : BigInt(r.assets_units),
        shares: r.shares === null ? null : BigInt(r.shares),
        status: r.status,
        mode: r.mode,
        txHash: r.tx_hash,
        requestKey: r.request_key,
        reason: r.reason,
        createdAt: r.created_at,
        updatedAt: r.updated_at,
    };
}

export function listActions(db: Db, limit = 50): Action[] {
    return (
        db
            .prepare(
                'SELECT * FROM actions ORDER BY created_at DESC, rowid DESC LIMIT ?',
            )
            .all(limit) as ActionRow[]
    ).map(toAction);
}

function getAction(db: Db, id: string): Action {
    const row = db.prepare('SELECT * FROM actions WHERE id = ?').get(id) as
        ActionRow | undefined;

    if (!row) {
        throw new ActionError('That request no longer exists.');
    }

    return toAction(row);
}

function insertAction(
    db: Db,
    a: Pick<Action, 'customerId' | 'vaultId' | 'kind' | 'amountIn' | 'status'> &
        Partial<Pick<Action, 'assets' | 'shares'>>,
): string {
    const id = randomUUID();
    const now = new Date().toISOString();

    db.prepare(
        `INSERT INTO actions (id, customer_id, vault_id, kind, amount_in, assets_units, shares, status, created_at, updated_at)
         VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
    ).run(
        id,
        a.customerId,
        a.vaultId,
        a.kind,
        a.amountIn.toString(),
        a.assets?.toString() ?? null,
        a.shares?.toString() ?? null,
        a.status,
        now,
        now,
    );

    return id;
}

function updateAction(
    db: Db,
    id: string,
    fields: Partial<Record<keyof ActionRow, string | null>>,
) {
    const keys = Object.keys(fields);

    db.prepare(
        `UPDATE actions SET ${keys.map((k) => `${k} = ?`).join(', ')}, updated_at = ? WHERE id = ?`,
    ).run(
        ...keys.map((k) => fields[k as keyof ActionRow] ?? null),
        new Date().toISOString(),
        id,
    );
}

const usdg = (units: bigint) => `${formatUnits(units, 6)} USDG`;

function requireAccepted(ctx: Ctx, customerId: string, vaultId: VaultId) {
    if (!getCustomer(ctx.db, customerId).accepted.includes(vaultId)) {
        throw new PreflightError(
            `Review and accept the ${VAULTS[vaultId].name} disclosure before your first deposit.`,
        );
    }
}

export function acceptDisclosure(ctx: Ctx, customerId: string, vaultId: VaultId): void {
    getCustomer(ctx.db, customerId);
    ctx.db
        .prepare(
            'INSERT OR IGNORE INTO disclosures (customer_id, vault_id, accepted_at) VALUES (?, ?, ?)',
        )
        .run(customerId, vaultId, new Date().toISOString());
}

// Sends the transaction, then settles it at once if the vault settles in the
// same transaction. The hash is recorded the moment the transaction is
// broadcast; from then on the action is pending and only the chain decides
// how it ends. Whatever was reserved goes back only if nothing was sent.
async function send(
    ctx: Ctx,
    id: string,
    run: (onSent: (hash: Hex) => void) => Promise<Submitted>,
    undo: () => void,
): Promise<string> {
    let sent = false;
    const onSent = (hash: Hex) => {
        sent = true;
        updateAction(ctx.db, id, { status: 'pending', tx_hash: hash });
    };
    let sub: Submitted;

    try {
        sub = await run(onSent);
    } catch (err) {
        if (sent) {
            // The transaction is out; the loop settles it from its receipt.
            console.error(`action ${id} sent but not confirmed yet`, err);

            return id;
        }

        tx(ctx.db, () => {
            undo();
            updateAction(ctx.db, id, {
                status: 'failed',
                reason:
                    err instanceof ActionError
                        ? err.message
                        : 'The transaction could not be sent.',
            });
        });
        throw err;
    }

    updateAction(ctx.db, id, {
        status: 'pending',
        mode: sub.mode,
        tx_hash: sub.txHash,
        request_key: sub.requestKey ?? null,
    });

    if (sub.mode === 'sync') {
        await settleAction(ctx, getAction(ctx.db, id));
    }

    return id;
}

export async function startDeposit(
    ctx: Ctx,
    customerId: string,
    vaultId: VaultId,
    assets: bigint,
): Promise<string> {
    requireAccepted(ctx, customerId, vaultId);

    const balance = getCustomer(ctx.db, customerId).usdg;

    if (assets > balance) {
        throw new PreflightError(`Your balance is ${usdg(balance)}.`, balance);
    }

    const adapter = ctx.adapters[vaultId];
    const check = await adapter.preflight('deposit', assets);

    if (!check.ok) {
        throw new PreflightError(check.reason, check.maxNow);
    }

    // Reserve the USDG so it cannot be spent twice while the deposit is in flight.
    const id = tx(ctx.db, () => {
        addUsdg(ctx.db, customerId, -assets);

        return insertAction(ctx.db, {
            customerId,
            vaultId,
            kind: 'deposit',
            amountIn: assets,
            status: 'submitted',
        });
    });

    return send(
        ctx,
        id,
        (onSent) => adapter.deposit(assets, onSent),
        () => addUsdg(ctx.db, customerId, assets),
    );
}

export async function startWithdraw(
    ctx: Ctx,
    customerId: string,
    vaultId: VaultId,
    amount: bigint | 'all',
): Promise<string> {
    const adapter = ctx.adapters[vaultId];
    const owned = getPosition(ctx.db, customerId, vaultId).shares;

    if (owned === 0n) {
        throw new PreflightError(`You have nothing in ${VAULTS[vaultId].name}.`);
    }

    const inFlight = ctx.db
        .prepare(
            `SELECT 1 FROM actions WHERE customer_id = ? AND vault_id = ? AND kind = 'withdraw' AND status IN ('submitted', 'pending')`,
        )
        .get(customerId, vaultId);

    if (inFlight) {
        throw new PreflightError('A withdrawal from this vault is already on its way.');
    }

    if (amount !== 'all') {
        const held = await adapter.assetsForShares(owned);

        if (amount > held) {
            throw new PreflightError(
                `You have ${usdg(held)} in ${VAULTS[vaultId].name}.`,
                held,
            );
        }
    }

    const shares =
        amount === 'all'
            ? owned
            : await adapter
                  .sharesForAssets(amount)
                  .then((s) => (s > owned ? owned : s));
    const assets = amount === 'all' ? await adapter.assetsForShares(shares) : amount;
    const market = (await ctx.markets())[vaultId];
    const check = await adapter.preflight('withdraw', assets, market.instantLiquidity);

    if (!check.ok) {
        throw new PreflightError(check.reason, check.maxNow);
    }

    // Shares stay on the customer's books until the withdrawal executes.
    const id = insertAction(ctx.db, {
        customerId,
        vaultId,
        kind: 'withdraw',
        amountIn: shares,
        shares,
        status: 'submitted',
    });

    return send(
        ctx,
        id,
        (onSent) => adapter.withdraw(shares, onSent),
        () => {},
    );
}

function applySettlement(ctx: Ctx, action: Action, result: Settlement) {
    const { db } = ctx;
    const customerId = action.customerId!;
    const vaultId = action.vaultId!;

    // Only a pending action can settle, so settling twice changes nothing.
    const claimed = db
        .prepare(
            `UPDATE actions SET status = ?, updated_at = ? WHERE id = ? AND status IN ('pending', 'submitted')`,
        )
        .run(result.status, new Date().toISOString(), action.id);

    if (claimed.changes !== 1) {
        return;
    }

    if (result.status === 'cancelled') {
        if (action.kind === 'deposit') {
            addUsdg(db, customerId, action.amountIn);
        }

        updateAction(db, action.id, { reason: result.reason });

        return;
    }

    const position = getPosition(db, customerId, vaultId);

    if (action.kind === 'deposit') {
        setPosition(db, customerId, vaultId, {
            shares: position.shares + result.shares,
            netDeposited: position.netDeposited + result.assets,
        });
    } else {
        const remaining = position.shares - result.shares;
        // Cost basis shrinks in proportion to the shares that left.
        const basisOut =
            position.shares === 0n
                ? position.netDeposited
                : (position.netDeposited * result.shares) / position.shares;

        setPosition(db, customerId, vaultId, {
            shares: remaining < 0n ? 0n : remaining,
            netDeposited: position.netDeposited - basisOut,
        });
        addUsdg(db, customerId, result.assets);
    }

    updateAction(db, action.id, {
        assets_units: result.assets.toString(),
        shares: result.shares.toString(),
    });
}

async function settleAction(ctx: Ctx, action: Action): Promise<void> {
    if (!action.txHash || !action.vaultId) {
        return;
    }

    const result = await ctx.adapters[action.vaultId].settle({
        txHash: action.txHash as `0x${string}`,
        mode: action.mode ?? 'sync',
        amount: action.amountIn,
        requestKey: (action.requestKey ?? undefined) as `0x${string}` | undefined,
    });

    if (result) {
        tx(ctx.db, () => applySettlement(ctx, action, result));
    }
}

// Settles every action still waiting on the chain. Runs on every loop pass and
// at startup, so a request that finished while the app was down is picked up.
export async function settleOpen(ctx: Ctx): Promise<void> {
    releaseUnsent(ctx);

    const open = (
        ctx.db
            .prepare(
                `SELECT * FROM actions WHERE status = 'pending' ORDER BY created_at`,
            )
            .all() as ActionRow[]
    ).map(toAction);

    for (const action of open) {
        await settleAction(ctx, action).catch((err) =>
            console.error(`settle ${action.kind} ${action.id}`, err),
        );
    }
}

// An action still marked submitted with no transaction after this long was
// interrupted before it was sent (actions run one at a time and send within
// seconds), so its reservation goes back to the customer.
const UNSENT_AFTER_MS = 120_000;

function releaseUnsent(ctx: Ctx): void {
    const stale = (
        ctx.db
            .prepare(
                `SELECT * FROM actions WHERE status = 'submitted' AND tx_hash IS NULL`,
            )
            .all() as ActionRow[]
    )
        .map(toAction)
        .filter((a) => Date.now() - Date.parse(a.createdAt) > UNSENT_AFTER_MS);

    for (const action of stale) {
        tx(ctx.db, () => {
            if (action.kind === 'deposit' && action.customerId) {
                addUsdg(ctx.db, action.customerId, action.amountIn);
            }

            updateAction(ctx.db, action.id, {
                status: 'failed',
                reason: 'The app stopped before this was sent, so nothing moved.',
            });
        });
    }
}

// GMX lets the creator cancel a request that is still pending after five
// minutes. The Cancelled event then settles it like any other result.
export async function cancelRequest(ctx: Ctx, actionId: string): Promise<void> {
    const action = getAction(ctx.db, actionId);
    const adapter = action.vaultId ? ctx.adapters[action.vaultId] : undefined;

    if (action.status !== 'pending' || action.mode !== 'async' || !adapter?.cancel) {
        throw new PreflightError('Only a pending GMX request can be cancelled.');
    }

    if (Date.now() - Date.parse(action.createdAt) < 300_000) {
        throw new PreflightError('GMX allows cancelling a request after five minutes.');
    }

    await adapter.cancel({
        txHash: action.txHash as `0x${string}`,
        mode: 'async',
        amount: action.amountIn,
        requestKey: action.requestKey as `0x${string}`,
    });
}

// USDG in the omnibus wallet that no customer owns yet.
export async function readUnassigned(ctx: Ctx): Promise<bigint> {
    const onchain = await ctx.chain.publicClient.readContract({
        address: USDG.arbitrumOne.address,
        abi: usdgAbi,
        functionName: 'balanceOf',
        args: [ctx.chain.omnibus],
    });
    const owed = totalCustomerUsdg(ctx.db) + reservedUsdg(ctx.db);

    return onchain > owed ? onchain - owed : 0n;
}

// USDG taken from customer balances for deposits whose transaction has not
// left the omnibus wallet yet.
export function reservedUsdg(db: Db): bigint {
    const rows = db
        .prepare(
            `SELECT amount_in FROM actions WHERE kind = 'deposit' AND status = 'submitted'`,
        )
        .all() as { amount_in: string }[];

    return rows.reduce((sum, r) => sum + BigInt(r.amount_in), 0n);
}

// Shares sent to GMX for a withdrawal that has not executed yet. They have left
// the omnibus wallet but are still on the customer's books.
export function sharesInFlight(db: Db): Record<VaultId, bigint> {
    const out: Record<VaultId, bigint> = { steakhouse: 0n, gauntlet: 0n, glv: 0n };
    const rows = db
        .prepare(
            `SELECT vault_id, amount_in FROM actions WHERE kind = 'withdraw' AND status = 'pending' AND mode = 'async'`,
        )
        .all() as { vault_id: VaultId; amount_in: string }[];

    for (const r of rows) {
        out[r.vault_id] += BigInt(r.amount_in);
    }

    return out;
}

export function ledgerShares(db: Db): Record<VaultId, bigint> {
    const books = sharesByVault(db);
    const away = sharesInFlight(db);

    return {
        steakhouse: books.steakhouse - away.steakhouse,
        gauntlet: books.gauntlet - away.gauntlet,
        glv: books.glv - away.glv,
    };
}

export async function assignUnassigned(
    ctx: Ctx,
    customerId: string,
    assets: bigint,
): Promise<void> {
    const unassigned = await readUnassigned(ctx);

    if (assets > unassigned) {
        throw new PreflightError(
            `Only ${usdg(unassigned)} in the omnibus wallet is unassigned.`,
            unassigned,
        );
    }

    tx(ctx.db, () => {
        addUsdg(ctx.db, customerId, assets);
        insertAction(ctx.db, {
            customerId,
            vaultId: null,
            kind: 'assign',
            amountIn: assets,
            assets,
            status: 'executed',
        });
    });
}

// Fork mode only: brings real USDG into the omnibus wallet from a holder on
// the fork, then assigns it to the customer.
export async function fundDemoCustomer(
    ctx: Ctx,
    customerId: string,
    assets: bigint,
): Promise<void> {
    if (!ctx.fundOmnibus) {
        throw new PreflightError('Demo funding is only available on a local fork.');
    }

    getCustomer(ctx.db, customerId);
    await ctx.fundOmnibus(assets);
    tx(ctx.db, () => {
        addUsdg(ctx.db, customerId, assets);
        insertAction(ctx.db, {
            customerId,
            vaultId: null,
            kind: 'fund',
            amountIn: assets,
            assets,
            status: 'executed',
        });
    });
}
