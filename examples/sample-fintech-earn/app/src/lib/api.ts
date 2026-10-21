export type ActionResult = { ok: boolean; message?: string; reason?: string };

export async function postAction(body: Record<string, unknown>): Promise<ActionResult> {
    const res = await fetch('/api/actions', {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify(body),
    });

    return (await res.json().catch(() => ({
        ok: false,
        message: 'The server did not respond.',
    }))) as ActionResult;
}
