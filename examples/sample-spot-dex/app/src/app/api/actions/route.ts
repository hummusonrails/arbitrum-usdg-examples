import { parseUnits } from 'viem';

import { move } from '@/server/bridge';
import type { Network } from '@/server/chain';
import { DEMO_TOP_UP, fund } from '@/server/funding';
import { latestSnapshot, publicMessage, runOnce, withLock } from '@/server/loop';
import { POOL_IDS, POOLS, type PoolId } from '@/server/registry';
import {
    accept,
    ADVANCE_DAYS,
    advanceTime,
    cancel,
    claimAndRoute,
    propose,
} from '@/server/rewards';
import { getCtx } from '@/server/runtime';
import {
    addLiquidity,
    claimLpRewards,
    removeLiquidity,
    swap,
    type Side,
} from '@/server/trade';
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

function amount(value: unknown, decimals: number, symbol: string): bigint {
    const pattern = new RegExp(`^\\d+(\\.\\d{1,${decimals}})?$`);

    if (
        typeof value !== 'string' ||
        !pattern.test(value) ||
        parseUnits(value, decimals) === 0n
    ) {
        throw new BadRequest(
            `Enter a ${symbol} amount like 250 or 12.5, with at most ${decimals} decimals.`,
        );
    }

    return parseUnits(value, decimals);
}

export async function POST(req: Request) {
    const ctx = await getCtx();
    const body = (await req.json().catch(() => null)) as Body | null;

    try {
        const wallet = () =>
            oneOf<WalletId>(body?.who, WALLET_IDS, 'one of the demo wallets');
        const pool = () => oneOf<PoolId>(body?.poolId, POOL_IDS, 'one of the pools');

        await withLock(async () => {
            switch (body?.action) {
                case 'swap': {
                    const id = pool();
                    const side = oneOf<Side>(body.side, ['buy', 'sell'], 'buy or sell');
                    const base = POOLS[id].base;

                    return swap(
                        ctx,
                        wallet(),
                        id,
                        side,
                        side === 'buy'
                            ? amount(body.amount, 6, 'USDG')
                            : amount(body.amount, base.decimals, base.symbol),
                    );
                }
                case 'add':
                    return addLiquidity(
                        ctx,
                        wallet(),
                        pool(),
                        amount(body.amount, 6, 'USDG'),
                    );
                case 'remove':
                    return removeLiquidity(
                        ctx,
                        wallet(),
                        pool(),
                        body.amount === 'all'
                            ? 'all'
                            : amount(body.amount, 18, 'LP token'),
                    );
                case 'claimLp':
                    return claimLpRewards(ctx, wallet(), pool());
                case 'propose':
                    return propose(ctx, pool());
                case 'accept':
                    return accept(ctx, pool());
                case 'cancel':
                    return cancel(ctx, pool());
                case 'route':
                    return claimAndRoute(ctx, pool());
                case 'advance':
                    return advanceTime(
                        ctx,
                        oneOf(body.days, ADVANCE_DAYS, '1, 7, or 30 days'),
                    );
                case 'move':
                    return move(
                        ctx,
                        wallet(),
                        oneOf<Network>(
                            body.from,
                            ['arbitrum', 'ethereum'],
                            'a chain to send from',
                        ),
                        amount(body.amount, 6, 'USDG'),
                    );
                case 'fundDemo': {
                    const who = wallet();

                    return fund(
                        ctx.chains.clients.arbitrum,
                        ctx.chains.clients.ethereum,
                        ctx.config.walletKeys[who],
                        DEMO_TOP_UP,
                    );
                }
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
