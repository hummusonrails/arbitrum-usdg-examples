import { toUnits } from '@arbitrum-usdg/usdg';

import { latestSnapshot, publicMessage, runOnce, withLock } from '@/server/loop';
import {
    acceptDisclosure,
    assignUnassigned,
    cancelRequest,
    fundDemoCustomer,
    startDeposit,
    startWithdraw,
} from '@/server/money';
import { claimAndAllocate } from '@/server/rewards';
import { getCtx } from '@/server/runtime';
import { VAULT_IDS } from '@/server/vaults/registry';
import type { VaultId } from '@/server/vaults/types';

export const runtime = 'nodejs';

type Body =
    | { action: 'deposit'; customerId: string; vaultId: VaultId; amount: string }
    | { action: 'withdraw'; customerId: string; vaultId: VaultId; amount: string }
    | { action: 'accept'; customerId: string; vaultId: VaultId }
    | { action: 'fund' | 'assign'; customerId: string; amount: string }
    | { action: 'claim' }
    | { action: 'cancel'; actionId: string };

const USDG_AMOUNT = /^\d+(\.\d{1,6})?$/;

class BadRequest extends Error {}

function fail(status: number, message: string) {
    return Response.json({ ok: false, message }, { status });
}

function amount(value: unknown): bigint {
    if (
        typeof value !== 'string' ||
        !USDG_AMOUNT.test(value) ||
        toUnits(value) === 0n
    ) {
        throw new BadRequest(
            'Enter a USDG amount like 250 or 1234.50, with at most six decimals.',
        );
    }

    return toUnits(value);
}

function vault(value: unknown): VaultId {
    if (!VAULT_IDS.includes(value as VaultId)) {
        throw new BadRequest('Choose one of the listed vaults.');
    }

    return value as VaultId;
}

export async function POST(req: Request) {
    const ctx = getCtx();
    const body = (await req.json().catch(() => null)) as Body | null;

    try {
        const actionId = await withLock(async (): Promise<string | undefined> => {
            switch (body?.action) {
                case 'deposit':
                    return startDeposit(
                        ctx,
                        body.customerId,
                        vault(body.vaultId),
                        amount(body.amount),
                    );
                case 'withdraw':
                    return startWithdraw(
                        ctx,
                        body.customerId,
                        vault(body.vaultId),
                        body.amount === 'all' ? 'all' : amount(body.amount),
                    );
                case 'accept':
                    acceptDisclosure(ctx, body.customerId, vault(body.vaultId));

                    return undefined;
                case 'fund':
                    if (ctx.config.mode !== 'fork') {
                        throw new BadRequest(
                            'Demo funding is only available on a local fork.',
                        );
                    }

                    await fundDemoCustomer(ctx, body.customerId, amount(body.amount));

                    return undefined;
                case 'assign':
                    await assignUnassigned(ctx, body.customerId, amount(body.amount));

                    return undefined;
                case 'claim':
                    await claimAndAllocate(ctx);

                    return undefined;
                case 'cancel':
                    await cancelRequest(ctx, body.actionId);

                    return undefined;
                default:
                    throw new BadRequest('Unknown action.');
            }
        });

        // Push a fresh snapshot so the page reflects the action at once.
        void runOnce(ctx).catch(() => latestSnapshot());

        return Response.json({ ok: true, actionId });
    } catch (err) {
        if (err instanceof BadRequest) {
            return fail(400, err.message);
        }

        const message = publicMessage(err);

        return fail(message.startsWith('Something went wrong') ? 500 : 409, message);
    }
}
