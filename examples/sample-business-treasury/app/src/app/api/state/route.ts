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
    let stop = () => {};
    const stream = new ReadableStream({
        start(controller) {
            const send = (text: string) => {
                try {
                    controller.enqueue(encoder.encode(text));
                } catch {
                    stop();
                }
            };
            const unsubscribe = subscribe((s) =>
                send(`data: ${JSON.stringify(s)}\n\n`),
            );
            // A comment line every 15 seconds keeps idle proxies from closing the stream.
            const heartbeat = setInterval(() => send(': ping\n\n'), 15_000);

            stop = () => {
                clearInterval(heartbeat);
                unsubscribe();
            };
        },
        cancel() {
            stop();
        },
    });

    req.signal.addEventListener('abort', () => stop());

    return new Response(stream, {
        headers: {
            'content-type': 'text/event-stream',
            'cache-control': 'no-cache, no-transform',
            connection: 'keep-alive',
        },
    });
}
