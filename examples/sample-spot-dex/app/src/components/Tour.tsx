'use client';

import {
    createContext,
    useContext,
    useEffect,
    useState,
    type ReactElement,
    type ReactNode,
} from 'react';

import { GUIDES, TOUR, type TourStep } from '@/lib/guides';

import { Tip } from './Tip';

const TOUR_KEY = 'sample-spot-dex.tour.done';

type Tour = {
    step: number | null;
    active: (s: TourStep) => boolean;
    next: () => void;
    finish: () => void;
    restart: () => void;
};

// Pages without the tour (the console on its own) get one that never runs.
const TourContext = createContext<Tour>({
    step: null,
    active: () => false,
    next: () => {},
    finish: () => {},
    restart: () => {},
});

// A short first visit tour across the trader app and the console,
// remembered per browser.
export function TourProvider({ children }: { children: ReactNode }) {
    const [step, setStep] = useState<number | null>(null);

    useEffect(() => {
        try {
            if (localStorage.getItem(TOUR_KEY) !== '1') {
                setStep(0);
            }
        } catch {}
    }, []);

    function finish() {
        setStep(null);

        try {
            localStorage.setItem(TOUR_KEY, '1');
        } catch {}
    }

    const tour: Tour = {
        step,
        active: (s) => step !== null && TOUR[step]?.step === s,
        next: () =>
            step !== null && step < TOUR.length - 1 ? setStep(step + 1) : finish(),
        finish,
        restart: () => setStep(0),
    };

    return <TourContext.Provider value={tour}>{children}</TourContext.Provider>;
}

export function useTour(): Tour {
    return useContext(TourContext);
}

// A guide tip on one part of the demo: shown on hover or focus, and opened in
// turn by the tour with Skip and Next.
export function TourTip({
    step,
    block = false,
    children,
}: {
    step: TourStep;
    block?: boolean;
    children: (props: { 'aria-describedby': string }) => ReactElement;
}) {
    const tour = useTour();
    const active = tour.active(step);
    const last = tour.step === TOUR.length - 1;
    const footer =
        active && tour.step !== null ? (
            <div className="mt-4 flex items-center justify-between border-t border-white/10 pt-3">
                <span className="font-mono text-[11px] text-white/60">
                    {tour.step + 1} of {TOUR.length}
                </span>
                <span className="flex gap-2">
                    <button
                        type="button"
                        onClick={tour.finish}
                        className="rounded-[2px] px-2.5 py-1 text-[12px] text-white/70 hover:text-white"
                    >
                        Skip
                    </button>
                    <button
                        type="button"
                        onClick={last ? tour.finish : tour.next}
                        className="rounded-[2px] bg-blue px-3 py-1 text-[12px] font-medium text-white hover:bg-blue/90"
                    >
                        {last ? 'Got it' : 'Next'}
                    </button>
                </span>
            </div>
        ) : undefined;

    return (
        <Tip
            guide={GUIDES[step]}
            open={active || undefined}
            footer={footer}
            block={block}
        >
            {children}
        </Tip>
    );
}

export function ShowTips() {
    const tour = useTour();

    return tour.step === null ? (
        <button
            type="button"
            onClick={tour.restart}
            className="text-[13px] text-navy-2/70 underline-offset-4 hover:text-blue hover:underline"
        >
            Show tips
        </button>
    ) : null;
}
