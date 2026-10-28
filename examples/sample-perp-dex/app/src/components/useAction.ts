'use client';

import { useState } from 'react';

import { postAction } from '@/lib/api';

// Runs one action at a time from a control, with its busy state and message.
export function useAction() {
    const [busy, setBusy] = useState<string>();
    const [message, setMessage] = useState<{ ok: boolean; text: string }>();

    async function run(key: string, body: Record<string, unknown>, done?: string) {
        setBusy(key);
        setMessage(undefined);

        const r = await postAction(body);

        setBusy(undefined);
        setMessage(
            r.ok
                ? done
                    ? { ok: true, text: done }
                    : undefined
                : { ok: false, text: r.message ?? 'The action failed.' },
        );

        return r.ok;
    }

    return { busy, message, run };
}
