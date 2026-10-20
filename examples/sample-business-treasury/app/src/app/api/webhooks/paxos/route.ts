import { handleWebhook } from '@/server/events';
import { getCtx } from '@/server/runtime';

export const runtime = 'nodejs';

export async function POST(req: Request) {
    const ctx = getCtx();

    return handleWebhook(req, { db: ctx.db, apiKey: ctx.config.webhookApiKey });
}
