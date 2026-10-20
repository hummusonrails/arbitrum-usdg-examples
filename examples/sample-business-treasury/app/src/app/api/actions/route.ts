import { toUnits } from '@arbitrum-usdg/usdg';

import {
    cancelStuck,
    PreflightError,
    retryStuck,
    startMint,
    startRedeem,
} from '@/server/actions';
import { getKv, setKv } from '@/server/db';
import { runOnce, withLock } from '@/server/loop';
import { getCtx } from '@/server/runtime';
import { simulateWire } from '@/server/wire';

export const runtime = 'nodejs';

type Body =
    | { action: 'mint' | 'redeem'; amount: string }
    | { action: 'retry' | 'cancel'; refId: string }
    | { action: 'simulateWire'; amount?: string }
    | { action: 'setPolicy'; min: string; target: string; max: string }
    | { action: 'pausePolicy'; paused: boolean };

function fail(status: number, message: string, reason?: string) {
    return Response.json({ ok: false, message, reason }, { status });
}

export async function POST(req: Request) {
    const ctx = getCtx();
    const body = (await req.json().catch(() => null)) as Body | null;

    try {
        const early = await withLock(async () => {
            switch (body?.action) {
                case 'mint':
                    await startMint(ctx, toUnits(body.amount));
                    break;
                case 'redeem':
                    await startRedeem(ctx, toUnits(body.amount));
                    break;
                case 'retry':
                    await retryStuck(ctx, body.refId);
                    break;
                case 'cancel':
                    cancelStuck(ctx, body.refId);
                    break;
                case 'simulateWire': {
                    const memo = getKv(ctx.db, 'rule_memo_id');

                    if (!memo) {
                        return fail(
                            409,
                            'Run setup first so the auto mint rule exists.',
                        );
                    }

                    await simulateWire(
                        ctx.paxos,
                        memo,
                        body.amount ?? ctx.config.demoWireAmount,
                    );
                    break;
                }
                case 'setPolicy': {
                    const band = {
                        min: toUnits(body.min),
                        target: toUnits(body.target),
                        max: toUnits(body.max),
                    };

                    if (!(band.min < band.target && band.target < band.max)) {
                        return fail(
                            400,
                            'Min, target, and max must increase in that order.',
                        );
                    }

                    setKv(
                        ctx.db,
                        'policy_band',
                        JSON.stringify({
                            min: band.min.toString(),
                            target: band.target.toString(),
                            max: band.max.toString(),
                        }),
                    );
                    break;
                }
                case 'pausePolicy':
                    setKv(ctx.db, 'policy_paused', body.paused ? '1' : '0');
                    break;
                default:
                    return fail(400, 'Unknown action.');
            }

            return undefined;
        });

        if (early) {
            return early;
        }
    } catch (err) {
        if (err instanceof PreflightError) {
            return fail(409, err.message, err.reason);
        }

        return fail(500, err instanceof Error ? err.message : String(err));
    }

    return Response.json({ ok: true, snapshot: await runOnce(ctx) });
}
