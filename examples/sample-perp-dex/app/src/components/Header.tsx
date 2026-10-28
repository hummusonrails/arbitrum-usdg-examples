'use client';

import { shortAddress } from '@/lib/format';

import { useSnapshot } from './useSnapshot';

export function Header() {
    const s = useSnapshot();

    return (
        <header className="flex flex-wrap items-center justify-between gap-3 border-b border-sky/60 px-4 py-4 md:px-8">
            <div>
                <p className="text-[15px] font-semibold">Acme Perps</p>
                <p className="text-[13px] text-navy-2/80">
                    Sample perp DEX with USDG margin on Arbitrum One
                </p>
            </div>
            {s && (
                <div className="flex items-center gap-3 text-right">
                    <span>
                        <span className="block text-sm font-semibold">
                            Operator wallet
                        </span>
                        <span className="block font-mono text-xs text-navy-2/70">
                            {shortAddress(s.operator.address)} · payout group{' '}
                            {s.payoutGroupId}
                        </span>
                    </span>
                    <span className="grid size-9 place-items-center rounded-full bg-navy font-mono text-[11px] text-white">
                        {s.operator.address.slice(2, 4).toUpperCase()}
                    </span>
                </div>
            )}
        </header>
    );
}
