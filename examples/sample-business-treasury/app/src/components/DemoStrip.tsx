'use client';

import { FlaskConical } from 'lucide-react';

import { useSnapshot } from './useSnapshot';

const TEXT: Record<string, string> = {
    mock: 'Acme Co. is a fictional company. Simulated Paxos on a local fork of Arbitrum One; no real money moves.',
    sandbox:
        'Acme Co. is a fictional company. Paxos sandbox and Arbitrum Sepolia; test funds only.',
    production:
        'Acme Co. is a fictional company. Example code, unaudited; do not use it to manage real funds as is.',
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
                    {TEXT[s?.mode ?? 'mock'] ?? TEXT.mock}
                </span>
            </p>
        </div>
    );
}
