import { timingSafeEqual } from 'node:crypto';

import type { Orchestration, PaxosClient, Transfer } from '@arbitrum-usdg/paxos-client';

import { getKv, setKv, type Db } from './db.ts';

export type EventHandlers = {
    onOrchestration(o: Orchestration): Promise<void>;
    onTransfer(t: Transfer): Promise<void>;
};

const CHECKPOINT = 'events_checkpoint';
const LAST_POLL = 'events_last_poll';
const POLL_EVERY_MS = 15_000;
// An event that still cannot be fetched after this many tries is set aside,
// so it never blocks the events behind it.
const MAX_ATTEMPTS = 20;
const LOOKBACK_MS = 5 * 60_000;
const FIRST_RUN_LOOKBACK_MS = 24 * 60 * 60_000;

// Stores an event id the first time it is seen. Returns false for a repeat,
// whichever path (webhook or poll) delivered it first.
export function recordEvent(
    db: Db,
    id: string,
    type: string,
    via: 'webhook' | 'poll',
    isTest = false,
): boolean {
    const result = db
        .prepare(
            `INSERT OR IGNORE INTO events (id, type, received_via, received_at, is_test)
             VALUES (?, ?, ?, ?, ?)`,
        )
        .run(id, type, via, new Date().toISOString(), isTest ? 1 : 0);

    return result.changes > 0;
}

function sameKey(given: string, expected: string): boolean {
    const a = Buffer.from(given);
    const b = Buffer.from(expected);

    return a.length === b.length && timingSafeEqual(a, b);
}

// Paxos webhooks are not signed, so the body is only a hint: the handler
// records the event id and every detail is fetched back from the API.
export async function handleWebhook(
    req: Request,
    deps: { db: Db; apiKey: string },
): Promise<Response> {
    if (!deps.apiKey || !sameKey(req.headers.get('x-api-key') ?? '', deps.apiKey)) {
        return new Response('unauthorized', { status: 401 });
    }

    const body = (await req.json().catch(() => null)) as {
        id?: string;
        type?: string;
        is_test?: boolean;
    } | null;

    if (!body?.id || !body.type) {
        return new Response('bad request', { status: 400 });
    }

    recordEvent(deps.db, body.id, body.type, 'webhook', body.is_test === true);

    return new Response('ok', { status: 200 });
}

// Fetches each unprocessed event, then the current orchestration or transfer
// it refers to, and hands that record to the handlers. An event is marked
// processed only after its handler succeeds, so failures are retried.
export async function processPendingEvents(
    db: Db,
    paxos: PaxosClient,
    handlers: EventHandlers,
): Promise<number> {
    const pending = db
        .prepare(
            'SELECT id, is_test FROM events WHERE processed_at IS NULL ORDER BY received_at LIMIT 100',
        )
        .all() as { id: string; is_test: number }[];
    let done = 0;

    for (const row of pending) {
        // Dashboard test pings are not real treasury events.
        if (row.is_test) {
            db.prepare('UPDATE events SET processed_at = ? WHERE id = ?').run(
                new Date().toISOString(),
                row.id,
            );
            continue;
        }

        try {
            const event = await paxos.getEvent(row.id);
            const objectId = (event.object as { id?: string } | undefined)?.id;

            if (objectId && event.object_type?.startsWith('orchestration')) {
                await handlers.onOrchestration(await paxos.getOrchestration(objectId));
            } else if (objectId && event.object_type?.startsWith('transfer')) {
                await handlers.onTransfer(await paxos.getTransfer(objectId));
            }

            db.prepare(
                'UPDATE events SET processed_at = ?, payload_json = ?, attempts = attempts + 1 WHERE id = ?',
            ).run(new Date().toISOString(), JSON.stringify(event), row.id);
            done += 1;
        } catch (err) {
            db.prepare(
                `UPDATE events SET attempts = attempts + 1, last_error = ?,
                  processed_at = CASE WHEN attempts + 1 >= ? THEN ? ELSE NULL END
                 WHERE id = ?`,
            ).run(
                err instanceof Error ? err.message : String(err),
                MAX_ATTEMPTS,
                new Date().toISOString(),
                row.id,
            );
        }
    }

    return done;
}

// Catches up on events through List Events, so the app works without a
// public webhook URL and recovers anything a webhook missed.
export async function pollEvents(db: Db, paxos: PaxosClient): Promise<number> {
    const lastPoll = Number(getKv(db, LAST_POLL) ?? '0');
    const every = Number(process.env.EVENT_POLL_MS ?? POLL_EVERY_MS);

    if (Date.now() - lastPoll < every) {
        return 0;
    }

    setKv(db, LAST_POLL, String(Date.now()));

    const checkpoint = getKv(db, CHECKPOINT);
    const from = checkpoint
        ? new Date(Date.parse(checkpoint) - LOOKBACK_MS)
        : new Date(Date.now() - FIRST_RUN_LOOKBACK_MS);
    let cursor: string | undefined;
    let newest = checkpoint ? Date.parse(checkpoint) : 0;
    let added = 0;

    do {
        const page = await paxos.listEvents({
            'created_at.gte': from.toISOString(),
            limit: 100,
            ...(cursor ? { page_cursor: cursor } : {}),
        });

        for (const e of page.events ?? []) {
            if (e.id && e.type && recordEvent(db, e.id, e.type, 'poll')) {
                added += 1;
            }

            if (e.created_at) {
                newest = Math.max(newest, Date.parse(e.created_at));
            }
        }

        cursor = page.next_page_cursor || undefined;
    } while (cursor);

    if (newest > 0) {
        setKv(db, CHECKPOINT, new Date(newest).toISOString());
    }

    return added;
}
