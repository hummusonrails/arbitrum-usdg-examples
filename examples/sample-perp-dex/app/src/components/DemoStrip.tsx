'use client';

import { FlaskConical } from 'lucide-react';

const TEXT =
    'Acme Perps is a fictional company. A local fork of Arbitrum One with the real USDG contract and its rewards engine; no real money moves. The margin vault and oracle are unaudited example code.';

// A permanent notice that this app is a demonstration of building with USDG.
export function DemoStrip() {
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
                <span className="text-white/80">{TEXT}</span>
            </p>
        </div>
    );
}
