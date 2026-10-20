import 'server-only';

import type { Ctx } from './actions.ts';
import { createCtx } from './context.ts';
import { startLoop } from './loop.ts';

const g = globalThis as typeof globalThis & { __treasuryCtx?: Ctx };

// The single server context, shared by the loop and the API routes even when
// Next.js loads this module more than once.
export function getCtx(): Ctx {
    if (!g.__treasuryCtx) {
        g.__treasuryCtx = createCtx();
        startLoop(g.__treasuryCtx, Number(process.env.LOOP_INTERVAL_MS ?? 5000));
    }

    return g.__treasuryCtx;
}
