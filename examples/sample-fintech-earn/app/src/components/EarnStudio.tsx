'use client';

import { useEffect, useState } from 'react';

import { TOUR } from '@/lib/guides';

import { Console } from './console/Console';
import { Phone } from './customer/Phone';
import { FlightLayer } from './Flight';
import { ShowTips, TourProvider, useTour } from './Tour';

// The customer's phone and the operator console side by side, so every tap on
// the phone shows its effect on Acme Money's books and on the chain. Narrow
// screens switch between the two.
export function EarnStudio() {
    return (
        <TourProvider>
            <Studio />
        </TourProvider>
    );
}

function Studio() {
    const [view, setView] = useState<'customer' | 'console'>('customer');
    const tour = useTour();
    const side = tour.step === null ? undefined : TOUR[tour.step]?.side;

    // On narrow screens the tour switches to the half its step points at.
    useEffect(() => {
        if (side) {
            setView(side);
        }
    }, [side]);

    return (
        <>
            <div className="mb-3 hidden justify-end xl:flex">
                <ShowTips />
            </div>
            <div className="mb-4 flex items-center gap-1 xl:hidden" role="tablist">
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
                <span className="ml-2">
                    <ShowTips />
                </span>
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
