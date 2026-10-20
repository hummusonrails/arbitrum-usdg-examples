import { latestSnapshot, subscribe } from '@/server/loop';
import { getCtx } from '@/server/runtime';
import { getSnapshot } from '@/server/snapshot';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

// Streams the treasury snapshot as server sent events. `?once=1` returns a
// single JSON snapshot instead.
export async function GET(req: Request) {
    const ctx = getCtx();

    if (new URL(req.url).searchParams.has('once')) {
        return Response.json(latestSnapshot() ?? (await getSnapshot(ctx)));
    }

    const encoder = new TextEncoder();
    let unsubscribe = () => {};
    const stream = new ReadableStream({
        start(controller) {
            unsubscribe = subscribe((s) => {
                controller.enqueue(encoder.encode(`data: ${JSON.stringify(s)}\n\n`));
            });
        },
        cancel() {
            unsubscribe();
        },
    });

    req.signal.addEventListener('abort', () => unsubscribe());

    return new Response(stream, {
        headers: {
            'content-type': 'text/event-stream',
            'cache-control': 'no-cache, no-transform',
            connection: 'keep-alive',
        },
    });
}
