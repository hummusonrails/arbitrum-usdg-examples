import 'server-only';

import { openDb, type Db } from './db.ts';

let db: Db | undefined;

// One database handle per server process.
export function getDb(): Db {
    db ??= openDb();

    return db;
}
