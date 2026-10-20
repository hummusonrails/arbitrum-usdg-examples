import { handleWebhook } from '@/server/events';
import { getDb } from '@/server/store';

export const runtime = 'nodejs';

export async function POST(req: Request) {
    return handleWebhook(req, {
        db: getDb(),
        apiKey: process.env.WEBHOOK_API_KEY ?? '',
    });
}
