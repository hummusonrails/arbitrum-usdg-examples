import { ActionError } from './chain.ts';
import type { Ctx } from './ctx.ts';
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

const g = globalThis as typeof globalThis & { __dexLoop?: LoopState };

g.__dexLoop ??= { listeners: new Set(), queue: Promise.resolve(), started: false };

const state = g.__dexLoop;

// Runs onchain actions one at a time, so each wallet's transactions never race
// for a nonce and every claim is routed before the next one starts.
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

// A message safe to show in the browser. Raw errors can carry RPC URLs, so only
// messages the app wrote itself are passed through.
export function publicMessage(err: unknown): string {
    if (err instanceof ActionError) {
        return err.message;
    }

    console.error('dex', err);

    return 'Something went wrong on the server. Check the server log for details.';
}

export function runOnce(ctx: Ctx): Promise<Snapshot> {
    return withLock(() => runPass(ctx));
}

// One pass: read everything from both forks and publish a snapshot.
async function runPass(ctx: Ctx): Promise<Snapshot> {
    try {
        state.latest = await getSnapshot(ctx);
    } catch (err) {
        console.error('snapshot', err);

        if (!state.latest) {
            throw err;
        }

        state.latest = {
            ...state.latest,
            error: 'Live data is temporarily unavailable.',
        };
    }

    for (const fn of state.listeners) {
        try {
            fn(state.latest);
        } catch {
            state.listeners.delete(fn);
        }
    }

    return state.latest;
}

export function startLoop(ctx: Ctx, intervalMs = 3000): void {
    if (state.started) {
        return;
    }

    state.started = true;
    console.log('dex loop started');

    const run = async () => {
        await runOnce(ctx).catch((err) => console.error('dex loop', err));
        setTimeout(run, intervalMs);
    };

    void run();
}
