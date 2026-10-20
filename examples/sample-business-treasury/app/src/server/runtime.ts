import 'server-only';

import type { Ctx } from './actions.ts';
import { createCtx } from './context.ts';
import { startLoop } from './loop.ts';

let ctx: Ctx | undefined;

// The single server context, created on first use and shared by the loop and
// the API routes.
export function getCtx(): Ctx {
    if (!ctx) {
        ctx = createCtx();
        startLoop(ctx, Number(process.env.LOOP_INTERVAL_MS ?? 5000));
    }

    return ctx;
}
