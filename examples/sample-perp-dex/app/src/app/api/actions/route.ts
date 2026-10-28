import { parseUnits } from 'viem';

import { DEMO_TOP_UP, fund } from '@/server/funding';
import { MARKET_MOVES, setMarketMove, type MarketMove } from '@/server/keeper';
import { latestSnapshot, publicMessage, runOnce, withLock } from '@/server/loop';
import { claimRewards, deposit, withdraw } from '@/server/margin';
import { LEVERAGES, MARKET_IDS, type MarketId } from '@/server/registry';
import {
    accept,
    ADVANCE_DAYS,
    advanceTime,
    cancel,
    claimAndRoute,
    propose,
} from '@/server/rewards';
import { getCtx } from '@/server/runtime';
import { close, open, type Leverage, type Side } from '@/server/trade';
import { WALLET_IDS, type WalletId } from '@/server/wallets';

export const runtime = 'nodejs';

type Body = Record<string, unknown> & { action?: string };

class BadRequest extends Error {}

function fail(status: number, message: string) {
    return Response.json({ ok: false, message }, { status });
}

function oneOf<T extends string | number>(
    value: unknown,
    options: readonly T[],
    what: string,
): T {
    if (!options.includes(value as T)) {
        throw new BadRequest(`Choose ${what}.`);
    }

    return value as T;
}

function usdgAmount(value: unknown): bigint {
    if (
        typeof value !== 'string' ||
        !/^\d+(\.\d{1,6})?$/.test(value) ||
        parseUnits(value, 6) === 0n
    ) {
        throw new BadRequest(
            'Enter a USDG amount like 250 or 12.5, with at most 6 decimals.',
        );
    }

    return parseUnits(value, 6);
}

export async function POST(req: Request) {
    const ctx = await getCtx();
    const body = (await req.json().catch(() => null)) as Body | null;

    try {
        const wallet = () =>
            oneOf<WalletId>(body?.who, WALLET_IDS, 'one of the demo traders');
        const market = () => oneOf<MarketId>(body?.market, MARKET_IDS, 'a market');

        await withLock(async () => {
            switch (body?.action) {
                case 'deposit':
                    return deposit(ctx, wallet(), usdgAmount(body.amount));
                case 'withdraw':
                    return withdraw(
                        ctx,
                        wallet(),
                        body.amount === 'all' ? 'all' : usdgAmount(body.amount),
                    );
                case 'claimRewards':
                    return claimRewards(ctx, wallet());
                case 'open':
                    return open(
                        ctx,
                        wallet(),
                        market(),
                        oneOf<Side>(body.side, ['long', 'short'], 'long or short'),
                        usdgAmount(body.collateral),
                        oneOf<Leverage>(
                            body.leverage,
                            LEVERAGES,
                            '2x, 5x, or 10x leverage',
                        ),
                    );
                case 'close':
                    return close(ctx, wallet(), market());
                case 'propose':
                    return propose(ctx);
                case 'accept':
                    return accept(ctx);
                case 'cancel':
                    return cancel(ctx);
                case 'route':
                    return claimAndRoute(ctx);
                case 'advance':
                    return advanceTime(
                        ctx,
                        oneOf(body.days, ADVANCE_DAYS, '1, 7, or 30 days'),
                    );
                case 'move':
                    return setMarketMove(
                        ctx,
                        market(),
                        oneOf<MarketMove>(body.bps, MARKET_MOVES, 'a market move'),
                    );
                case 'fundDemo':
                    return fund(
                        ctx.chain.client,
                        ctx.config.walletKeys[wallet()],
                        DEMO_TOP_UP,
                    );
                default:
                    throw new BadRequest('Unknown action.');
            }
        });

        // Push a fresh snapshot so the page reflects the action at once.
        void runOnce(ctx).catch(() => latestSnapshot());

        return Response.json({ ok: true });
    } catch (err) {
        if (err instanceof BadRequest) {
            return fail(400, err.message);
        }

        const message = publicMessage(err);

        return fail(message.startsWith('Something went wrong') ? 500 : 409, message);
    }
}
