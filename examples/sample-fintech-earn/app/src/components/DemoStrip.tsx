'use client';

import { FlaskConical } from 'lucide-react';

import { useSnapshot } from './useSnapshot';

const TEXT: Record<string, string> = {
    fork: 'Acme Money is a fictional company. A local fork of Arbitrum One with real vault contracts; no real money moves, and rewards are simulated.',
    mainnet:
        'Acme Money is a fictional company. Example code, unaudited; do not use it to manage real funds as is.',
};

// A permanent notice that this app is a demonstration of building with USDG.
export function DemoStrip() {
    const s = useSnapshot();

    return (
        <div
            className="demo-strip flex items-center gap-3 px-4 py-2 text-[13px] md:px-8"
            role="note"
        >
            <FlaskConical
                className="size-4 flex-none text-sky"
                strokeWidth={1.75}
                aria-hidden
            />
            <p>
                <span className="font-semibold">Demonstration app.</span>{' '}
                <span className="text-white/80">
                    {TEXT[s?.mode ?? 'fork'] ?? TEXT.fork}
                </span>
            </p>
        </div>
    );
}
