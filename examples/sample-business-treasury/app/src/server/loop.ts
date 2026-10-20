import {
    onOrchestration,
    onTransfer,
    PreflightError,
    resumeInFlight,
    tick,
    type Ctx,
} from './actions.ts';
import { pollEvents, processPendingEvents } from './events.ts';
import { reconcileAll } from './reconcile.ts';
import { getSnapshot, type Snapshot } from './snapshot.ts';

type Listener = (s: Snapshot) => void;

const listeners = new Set<Listener>();
let queue: Promise<unknown> = Promise.resolve();

// Runs treasury work one piece at a time, so a dashboard action and a loop
// pass can never both decide to mint or redeem.
export function withLock<T>(fn: () => Promise<T>): Promise<T> {
    const run = queue.then(fn, fn);

    queue = run.catch(() => {});

    return run;
}
let latest: Snapshot | undefined;

export function subscribe(fn: Listener): () => void {
    listeners.add(fn);

    if (latest) {
        fn(latest);
    }

    return () => listeners.delete(fn);
}

export function latestSnapshot(): Snapshot | undefined {
    return latest;
}

// One pass of the treasury loop. Each stage catches its own errors so a
// Paxos or RPC hiccup never stops the others.
export function runOnce(ctx: Ctx): Promise<Snapshot> {
    return withLock(() => runPass(ctx));
}

async function runPass(ctx: Ctx): Promise<Snapshot> {
    const handlers = {
        onOrchestration: (o: Parameters<typeof onOrchestration>[1]) =>
            onOrchestration(ctx, o),
        onTransfer: (t: Parameters<typeof onTransfer>[1]) => onTransfer(ctx, t),
    };
    let decision: Snapshot['decision'] = null;

    await pollEvents(ctx.db, ctx.paxos).catch((err) =>
        console.error('poll events', err),
    );
    await processPendingEvents(ctx.db, ctx.paxos, handlers).catch((err) =>
        console.error('process events', err),
    );
    await reconcileAll(ctx).catch((err) => console.error('reconcile', err));

    try {
        decision = await tick(ctx);
    } catch (err) {
        decision = {
            kind: 'error',
            message: err instanceof PreflightError ? err.message : String(err),
        };
    }

    latest = await getSnapshot(ctx, decision);

    for (const fn of listeners) {
        fn(latest);
    }

    return latest;
}

let started = false;

export function startLoop(ctx: Ctx, intervalMs = 5000): void {
    if (started) {
        return;
    }

    started = true;

    const run = async () => {
        await runOnce(ctx).catch((err) => console.error('treasury loop', err));
        setTimeout(run, intervalMs);
    };

    withLock(() => resumeInFlight(ctx))
        .catch((err) => console.error('resume', err))
        .finally(run);
}
