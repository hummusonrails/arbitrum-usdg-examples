'use client';

import { FlaskConical } from 'lucide-react';

const TEXT =
    'Acme Swap is a fictional company. Local forks of Arbitrum One and Ethereum with the real USDG and LayerZero contracts; no real money moves. The pool contract is unaudited example code.';

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
