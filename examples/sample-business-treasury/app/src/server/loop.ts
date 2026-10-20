import {
    ActionFailedError,
    onOrchestration,
    onTransfer,
    PreflightError,
    refreshOpen,
    tick,
    type Ctx,
} from './actions.ts';
import { pollEvents, processPendingEvents } from './events.ts';
import { reconcileAll } from './reconcile.ts';
import { getSnapshot, type Snapshot } from './snapshot.ts';

type Listener = (s: Snapshot) => void;

// Next.js can load server modules more than once (the instrumentation hook
// and the API routes get separate copies), so the loop's state lives on
// globalThis: one loop, one lock, one set of listeners per process.
type LoopState = {
    listeners: Set<Listener>;
    latest?: Snapshot;
    queue: Promise<unknown>;
    started: boolean;
};

const g = globalThis as typeof globalThis & { __treasuryLoop?: LoopState };

g.__treasuryLoop ??= { listeners: new Set(), queue: Promise.resolve(), started: false };

const state = g.__treasuryLoop;

// Runs treasury work one piece at a time, so a dashboard action and a loop
// pass can never both decide to mint or redeem.
export function withLock<T>(fn: () => Promise<T>): Promise<T> {
    const run = state.queue.then(fn, fn);

    state.queue = run.catch(() => {});

    return run;
}

export function subscribe(fn: Listener): () => void {
    state.listeners.add(fn);

    if (state.latest) {
        fn(state.latest);
    }

    return () => state.listeners.delete(fn);
}

export function latestSnapshot(): Snapshot | undefined {
    return state.latest;
}

// A message safe to show in the browser. Raw errors can carry RPC URLs with
// keys in them, so only messages the app wrote itself are passed through.
export function publicMessage(err: unknown): string {
    if (err instanceof PreflightError || err instanceof ActionFailedError) {
        return err.message;
    }

    console.error('treasury', err);

    return 'Something went wrong on the server. Check the server log for details.';
}

export function runOnce(ctx: Ctx): Promise<Snapshot> {
    return withLock(() => runPass(ctx));
}

// One pass of the treasury loop. Each stage catches its own errors so a
// Paxos or RPC hiccup never stops the others.
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
    await refreshOpen(ctx).catch((err) => console.error('refresh', err));
    await reconcileAll(ctx).catch((err) => console.error('reconcile', err));

    try {
        decision = await tick(ctx);
    } catch (err) {
        decision = { kind: 'error', message: publicMessage(err) };
    }

    state.latest = await getSnapshot(ctx, decision);

    for (const fn of state.listeners) {
        try {
            fn(state.latest);
        } catch {
            state.listeners.delete(fn);
        }
    }

    return state.latest;
}

export function startLoop(ctx: Ctx, intervalMs = 5000): void {
    if (state.started) {
        return;
    }

    state.started = true;
    console.log('treasury loop started');

    const run = async () => {
        await runOnce(ctx).catch((err) => console.error('treasury loop', err));
        setTimeout(run, intervalMs);
    };

    void run();
}
