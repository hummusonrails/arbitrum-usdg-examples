import { DatabaseSync } from 'node:sqlite';

export type Db = DatabaseSync;

const SCHEMA = `
CREATE TABLE IF NOT EXISTS events (
    id TEXT PRIMARY KEY,
    type TEXT NOT NULL,
    received_via TEXT NOT NULL,
    received_at TEXT NOT NULL,
    is_test INTEGER NOT NULL DEFAULT 0,
    processed_at TEXT,
    attempts INTEGER NOT NULL DEFAULT 0,
    last_error TEXT,
    payload_json TEXT
);
CREATE TABLE IF NOT EXISTS actions (
    ref_id TEXT PRIMARY KEY,
    kind TEXT NOT NULL,
    amount_units TEXT NOT NULL,
    status TEXT NOT NULL,
    step TEXT NOT NULL,
    orchestration_id TEXT,
    deposit_tx_hash TEXT,
    transfer_id TEXT,
    error TEXT,
    created_at TEXT NOT NULL,
    updated_at TEXT NOT NULL
);
CREATE TABLE IF NOT EXISTS ledger (
    id TEXT PRIMARY KEY,
    ref_id TEXT,
    source TEXT NOT NULL,
    direction TEXT NOT NULL,
    amount_units TEXT NOT NULL,
    paxos_status TEXT,
    orchestration_id TEXT,
    transfer_id TEXT,
    crypto_tx_hash TEXT,
    onchain_amount_units TEXT,
    onchain_to TEXT,
    status TEXT NOT NULL,
    reason TEXT,
    updated_at TEXT NOT NULL
);
CREATE TABLE IF NOT EXISTS kv (
    key TEXT PRIMARY KEY,
    value TEXT NOT NULL
);
`;

export function openDb(path = process.env.DB_PATH ?? 'treasury.db'): Db {
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
