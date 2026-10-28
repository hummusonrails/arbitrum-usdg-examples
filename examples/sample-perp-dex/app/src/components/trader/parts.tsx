'use client';

import { Loader2 } from 'lucide-react';
import type { ReactNode } from 'react';

export function Note({ ok, text }: { ok: boolean; text: string }) {
    return (
        <p
            className={`mt-2 text-[12.5px] ${ok ? 'text-navy-2' : 'text-error'}`}
            role={ok ? 'status' : 'alert'}
        >
            {text}
        </p>
    );
}

export function SubmitButton({
    busy,
    disabled = false,
    children,
}: {
    busy: boolean;
    disabled?: boolean;
    children: ReactNode;
}) {
    return (
        <button
            type="submit"
            disabled={busy || disabled}
            className="inline-flex w-full items-center justify-center gap-2 rounded-[2px] bg-blue px-4 py-2.5 text-sm font-medium text-white hover:bg-blue/90 disabled:opacity-50"
        >
            {busy && <Loader2 className="size-4 animate-spin" aria-hidden />}
            {children}
        </button>
    );
}
