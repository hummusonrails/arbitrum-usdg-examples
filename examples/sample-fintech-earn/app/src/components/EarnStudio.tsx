'use client';

import { useState } from 'react';

import { Console } from './console/Console';
import { Phone } from './customer/Phone';
import { FlightLayer } from './Flight';

// The customer's phone and the operator console side by side, so every tap on
// the phone shows its effect on Acme Money's books and on the chain. Narrow
// screens switch between the two.
export function EarnStudio() {
    const [view, setView] = useState<'customer' | 'console'>('customer');

    return (
        <>
            <div className="mb-4 flex gap-1 xl:hidden" role="tablist">
                {(
                    [
                        ['customer', 'Customer app'],
                        ['console', 'Operator console'],
                    ] as const
                ).map(([key, label]) => (
                    <button
                        key={key}
                        type="button"
                        role="tab"
                        aria-selected={view === key}
                        onClick={() => setView(key)}
                        className={`flex-1 rounded-[2px] px-3 py-2 text-sm font-medium ${
                            view === key
                                ? 'bg-navy text-white'
                                : 'border border-sky bg-white/70'
                        }`}
                    >
                        {label}
                    </button>
                ))}
            </div>
            <div className="grid gap-8 xl:grid-cols-[400px_minmax(0,1fr)] xl:items-start">
                <div
                    className={`min-w-0 xl:sticky xl:top-6 ${view === 'customer' ? '' : 'hidden xl:block'}`}
                >
                    <Phone />
                </div>
                <div
                    className={`min-w-0 ${view === 'console' ? '' : 'hidden xl:block'}`}
                >
                    <Console />
                </div>
            </div>
            <FlightLayer />
        </>
    );
}
