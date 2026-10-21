// Acme Money's own books: each customer's app balance in USDG and, per vault,
// the vault shares the omnibus wallet holds on their behalf.
import { ActionError } from './chain.ts';
import type { Db } from './db.ts';
import type { VaultId } from './vaults/types.ts';

export type Customer = { id: string; name: string; usdg: bigint; accepted: VaultId[] };
export type Position = { shares: bigint; netDeposited: bigint };

// Three fictional customers, so sharing and allocation have something to show.
export const DEMO_CUSTOMERS = [
    { id: 'maya', name: 'Maya Chen' },
    { id: 'diego', name: 'Diego Alvarez' },
    { id: 'priya', name: 'Priya Nair' },
];

export function seedCustomers(db: Db): void {
    const insert = db.prepare(
        'INSERT OR IGNORE INTO customers (id, name) VALUES (?, ?)',
    );

    for (const c of DEMO_CUSTOMERS) {
        insert.run(c.id, c.name);
    }
}

export function listCustomers(db: Db): Customer[] {
    const rows = db.prepare('SELECT id FROM customers ORDER BY rowid').all() as {
        id: string;
    }[];

    return rows.map((r) => getCustomer(db, r.id));
}

export function getCustomer(db: Db, id: string): Customer {
    const row = db
        .prepare('SELECT id, name, usdg_units FROM customers WHERE id = ?')
        .get(id) as { id: string; name: string; usdg_units: string } | undefined;

    if (!row) {
        throw new ActionError(`Unknown customer ${id}.`);
    }

    const accepted = db
        .prepare('SELECT vault_id FROM disclosures WHERE customer_id = ?')
        .all(id) as { vault_id: VaultId }[];

    return {
        id: row.id,
        name: row.name,
        usdg: BigInt(row.usdg_units),
        accepted: accepted.map((a) => a.vault_id),
    };
}

export function addUsdg(db: Db, customerId: string, delta: bigint): void {
    const current = getCustomer(db, customerId).usdg;

    if (current + delta < 0n) {
        throw new Error(`Customer ${customerId} balance would go negative`);
    }

    db.prepare('UPDATE customers SET usdg_units = ? WHERE id = ?').run(
        (current + delta).toString(),
        customerId,
    );
}

export function getPosition(db: Db, customerId: string, vaultId: VaultId): Position {
    const row = db
        .prepare(
            'SELECT shares, net_deposited_units FROM positions WHERE customer_id = ? AND vault_id = ?',
        )
        .get(customerId, vaultId) as
        { shares: string; net_deposited_units: string } | undefined;

    return {
        shares: BigInt(row?.shares ?? '0'),
        netDeposited: BigInt(row?.net_deposited_units ?? '0'),
    };
}

// Writes a position and records the new share balance with a timestamp, which
// is what time weighted reward sharing is computed from.
export function setPosition(
    db: Db,
    customerId: string,
    vaultId: VaultId,
    position: Position,
    at = Date.now(),
): void {
    db.prepare(
        `INSERT INTO positions (customer_id, vault_id, shares, net_deposited_units) VALUES (?, ?, ?, ?)
         ON CONFLICT(customer_id, vault_id) DO UPDATE SET shares = excluded.shares, net_deposited_units = excluded.net_deposited_units`,
    ).run(
        customerId,
        vaultId,
        position.shares.toString(),
        position.netDeposited.toString(),
    );
    db.prepare(
        'INSERT INTO share_history (customer_id, vault_id, shares, at) VALUES (?, ?, ?, ?)',
    ).run(customerId, vaultId, position.shares.toString(), at);
}

export function sharesByVault(db: Db): Record<VaultId, bigint> {
    const out: Record<VaultId, bigint> = { steakhouse: 0n, gauntlet: 0n, glv: 0n };
    const rows = db.prepare('SELECT vault_id, shares FROM positions').all() as {
        vault_id: VaultId;
        shares: string;
    }[];

    for (const r of rows) {
        out[r.vault_id] += BigInt(r.shares);
    }

    return out;
}

export function totalCustomerUsdg(db: Db): bigint {
    const rows = db.prepare('SELECT usdg_units FROM customers').all() as {
        usdg_units: string;
    }[];

    return rows.reduce((sum, r) => sum + BigInt(r.usdg_units), 0n);
}

export type ShareChange = {
    customerId: string;
    vaultId: VaultId;
    shares: bigint;
    at: number;
};

export function shareHistory(db: Db): ShareChange[] {
    const rows = db
        .prepare(
            'SELECT customer_id, vault_id, shares, at FROM share_history ORDER BY at, id',
        )
        .all() as {
        customer_id: string;
        vault_id: VaultId;
        shares: string;
        at: number;
    }[];

    return rows.map((r) => ({
        customerId: r.customer_id,
        vaultId: r.vault_id,
        shares: BigInt(r.shares),
        at: r.at,
    }));
}
