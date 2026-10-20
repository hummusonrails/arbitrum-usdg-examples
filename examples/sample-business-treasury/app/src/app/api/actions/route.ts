import { toUnits } from '@arbitrum-usdg/usdg';

import {
    ActionFailedError,
    cancelStuck,
    PreflightError,
    retryStuck,
    startMint,
    startRedeem,
} from '@/server/actions';
import { getKv, setKv } from '@/server/db';
import { latestSnapshot, publicMessage, runOnce, withLock } from '@/server/loop';
import { getCtx } from '@/server/runtime';
import { simulateWire } from '@/server/wire';

export const runtime = 'nodejs';

type Body =
    | { action: 'mint' | 'redeem'; amount: string }
    | { action: 'retry' | 'cancel'; refId: string }
    | { action: 'simulateWire'; amount?: string }
    | { action: 'setPolicy'; min: string; target: string; max: string }
    | { action: 'pausePolicy'; paused: boolean };

// USDG amounts carry up to six decimals; USD moves in cents.
const USDG_AMOUNT = /^\d+(\.\d{1,6})?$/;
const USD_AMOUNT = /^\d+(\.\d{1,2})?$/;

class BadRequest extends Error {}

function fail(status: number, message: string, reason?: string) {
    return Response.json({ ok: false, message, reason }, { status });
}

function amount(value: unknown, pattern: RegExp, hint: string): bigint {
    if (typeof value !== 'string' || !pattern.test(value) || toUnits(value) === 0n) {
        throw new BadRequest(hint);
    }

    return toUnits(value);
}

export async function POST(req: Request) {
    const ctx = getCtx();
    const body = (await req.json().catch(() => null)) as Body | null;

    try {
        const early = await withLock(async () => {
            switch (body?.action) {
                case 'mint':
                    await startMint(
                        ctx,
                        amount(
                            body.amount,
                            USD_AMOUNT,
                            'Enter a USD amount like 250 or 1234.50.',
                        ),
                    );
                    break;
                case 'redeem':
                    await startRedeem(
                        ctx,
                        amount(
                            body.amount,
                            USDG_AMOUNT,
                            'Enter a USDG amount with at most six decimals.',
                        ),
                    );
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

                    const wire = body.amount ?? ctx.config.demoWireAmount;

                    amount(
                        wire,
                        USD_AMOUNT,
                        'Enter a USD amount like 2500 or 2500.00.',
                    );
                    await simulateWire(ctx.paxos, memo, wire);
                    break;
                }
                case 'setPolicy': {
                    const hint = 'Enter min, target, and max as USDG amounts.';
                    const band = {
                        min: amount(body.min, USDG_AMOUNT, hint),
                        target: amount(body.target, USDG_AMOUNT, hint),
                        max: amount(body.max, USDG_AMOUNT, hint),
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
        if (err instanceof BadRequest) {
            return fail(400, err.message);
        }

        if (err instanceof PreflightError) {
            return fail(409, err.message, err.reason);
        }

        if (err instanceof ActionFailedError) {
            return fail(409, err.message);
        }

        return fail(500, publicMessage(err));
    }

    // The action is recorded; a hiccup while refreshing the view must not
    // read as a failure, or the operator would try again.
    const snapshot = await runOnce(ctx).catch(() => latestSnapshot());

    return Response.json({ ok: true, snapshot });
}
