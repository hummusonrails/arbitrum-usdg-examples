import { DatabaseSync } from 'node:sqlite';

export type Db = DatabaseSync;

// Amounts are stored as decimal strings of base units (USDG 6 decimals), so
// nothing is ever rounded through a float. LayerZero transfers are not stored:
// they are rebuilt from OFTSent and OFTReceived logs on every pass.
const SCHEMA = `
CREATE TABLE IF NOT EXISTS reward_claims (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    pool_id TEXT NOT NULL,
    tx_hash TEXT NOT NULL,
    amount TEXT NOT NULL,
    at INTEGER NOT NULL
);
CREATE TABLE IF NOT EXISTS reward_routes (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    claim_id INTEGER NOT NULL,
    pool_id TEXT NOT NULL,
    tx_hash TEXT NOT NULL,
    amount TEXT NOT NULL,
    at INTEGER NOT NULL
);
CREATE TABLE IF NOT EXISTS activity (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    kind TEXT NOT NULL,
    who TEXT NOT NULL,
    summary TEXT NOT NULL,
    network TEXT NOT NULL,
    tx_hash TEXT,
    at INTEGER NOT NULL
);
CREATE TABLE IF NOT EXISTS kv (
    key TEXT PRIMARY KEY,
    value TEXT NOT NULL
);
`;

export function openDb(path = process.env.DB_PATH ?? 'dex.db'): Db {
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

export type Activity = {
    kind: string;
    who: string;
    summary: string;
    network: 'arbitrum' | 'ethereum';
    txHash?: string;
};

// One line on the console slate for each onchain action.
export function record(db: Db, a: Activity): void {
    db.prepare(
        'INSERT INTO activity (kind, who, summary, network, tx_hash, at) VALUES (?, ?, ?, ?, ?, ?)',
    ).run(a.kind, a.who, a.summary, a.network, a.txHash ?? null, Date.now());
}
