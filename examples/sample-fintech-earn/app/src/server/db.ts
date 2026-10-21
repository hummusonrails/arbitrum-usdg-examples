import { DatabaseSync } from 'node:sqlite';

export type Db = DatabaseSync;

// Amounts are stored as decimal strings of base units (USDG 6 decimals, vault
// shares and ARB 18), so nothing is ever rounded through a float.
const SCHEMA = `
CREATE TABLE IF NOT EXISTS customers (
    id TEXT PRIMARY KEY,
    name TEXT NOT NULL,
    usdg_units TEXT NOT NULL DEFAULT '0'
);
CREATE TABLE IF NOT EXISTS disclosures (
    customer_id TEXT NOT NULL,
    vault_id TEXT NOT NULL,
    accepted_at TEXT NOT NULL,
    PRIMARY KEY (customer_id, vault_id)
);
CREATE TABLE IF NOT EXISTS positions (
    customer_id TEXT NOT NULL,
    vault_id TEXT NOT NULL,
    shares TEXT NOT NULL DEFAULT '0',
    net_deposited_units TEXT NOT NULL DEFAULT '0',
    PRIMARY KEY (customer_id, vault_id)
);
CREATE TABLE IF NOT EXISTS share_history (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    customer_id TEXT NOT NULL,
    vault_id TEXT NOT NULL,
    shares TEXT NOT NULL,
    at INTEGER NOT NULL
);
CREATE TABLE IF NOT EXISTS actions (
    id TEXT PRIMARY KEY,
    customer_id TEXT,
    vault_id TEXT,
    kind TEXT NOT NULL,
    amount_in TEXT NOT NULL,
    assets_units TEXT,
    shares TEXT,
    status TEXT NOT NULL,
    mode TEXT,
    tx_hash TEXT,
    request_key TEXT,
    reason TEXT,
    created_at TEXT NOT NULL,
    updated_at TEXT NOT NULL
);
CREATE TABLE IF NOT EXISTS reward_claims (
    id TEXT PRIMARY KEY,
    tx_hash TEXT,
    amount TEXT NOT NULL,
    at INTEGER NOT NULL
);
CREATE TABLE IF NOT EXISTS reward_allocations (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    claim_id TEXT NOT NULL,
    customer_id TEXT NOT NULL,
    vault_id TEXT NOT NULL,
    amount TEXT NOT NULL
);
CREATE TABLE IF NOT EXISTS kv (
    key TEXT PRIMARY KEY,
    value TEXT NOT NULL
);
`;

export function openDb(path = process.env.DB_PATH ?? 'earn.db'): Db {
    const db = new DatabaseSync(path);

    if (path !== ':memory:') {
        db.exec('PRAGMA journal_mode = WAL;');
    }

    db.exec(SCHEMA);

    return db;
}

export function getKv(db: Db, key: string): string | undefined {
    const row = db.prepare('SELECT value FROM kv WHERE key = ?').get(key) as
        { value: string } | undefined;

    return row?.value;
}

export function setKv(db: Db, key: string, value: string): void {
    db.prepare(
        'INSERT INTO kv (key, value) VALUES (?, ?) ON CONFLICT(key) DO UPDATE SET value = excluded.value',
    ).run(key, value);
}

// Runs fn inside one SQLite transaction.
export function tx<T>(db: Db, fn: () => T): T {
    db.exec('BEGIN');

    try {
        const out = fn();

        db.exec('COMMIT');

        return out;
    } catch (err) {
        db.exec('ROLLBACK');
        throw err;
    }
}
