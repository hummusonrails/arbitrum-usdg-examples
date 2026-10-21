import 'server-only';

import { createCtx } from './context.ts';
import type { Ctx } from './ctx.ts';
import { startLoop } from './loop.ts';

const g = globalThis as typeof globalThis & { __earnCtx?: Ctx };

// The single server context, shared by the loop and the API routes even when
// Next.js loads this module more than once.
export function getCtx(): Ctx {
    if (!g.__earnCtx) {
        g.__earnCtx = createCtx();
        startLoop(g.__earnCtx, g.__earnCtx.config.loopMs);
    }

    return g.__earnCtx;
}
