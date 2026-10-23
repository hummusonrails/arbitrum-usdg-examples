import 'server-only';

import { createCtx } from './context.ts';
import type { Ctx } from './ctx.ts';
import { startLoop } from './loop.ts';

const g = globalThis as typeof globalThis & { __dexCtx?: Promise<Ctx> };

// The single server context, shared by the loop and the API routes even when
// Next.js loads this module more than once.
export function getCtx(): Promise<Ctx> {
    g.__dexCtx ??= createCtx().then((ctx) => {
        startLoop(ctx, ctx.config.loopMs);

        return ctx;
    });

    return g.__dexCtx;
}
