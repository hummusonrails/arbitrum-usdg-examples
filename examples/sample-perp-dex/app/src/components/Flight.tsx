'use client';

import { animate, motion, useMotionValue, useReducedMotion } from 'motion/react';
import { useEffect, useState } from 'react';

import { formatAmount } from '@/lib/format';

type Flight = {
    id: number;
    from: DOMRect;
    to: DOMRect;
    amount: string;
};

// The hero motion: routed rewards leave the operator's button as a tile, fly a
// short arc, and land on the vault with a small squash. One flight at a time;
// skipped when the vault is not on screen or motion is reduced.
export function FlightLayer() {
    const [flight, setFlight] = useState<Flight>();
    const reduce = useReducedMotion();

    useEffect(() => {
        function onFlight(e: Event) {
            const { rect, amount } = (e as CustomEvent).detail as {
                rect: DOMRect;
                amount: string;
            };
            const target = document.getElementById('vault-card');

            if (reduce || !target || flight) {
                return;
            }

            const to = target.getBoundingClientRect();

            if (to.bottom < 0 || to.top > window.innerHeight) {
                return;
            }

            setFlight({ id: Date.now(), from: rect, to, amount });
        }

        window.addEventListener('perp:flight', onFlight);

        return () => window.removeEventListener('perp:flight', onFlight);
    }, [flight, reduce]);

    return flight ? (
        <Tile key={flight.id} flight={flight} onDone={() => setFlight(undefined)} />
    ) : null;
}

function Tile({ flight, onDone }: { flight: Flight; onDone: () => void }) {
    const x = useMotionValue(flight.from.left);
    const y = useMotionValue(flight.from.top);
    const scaleY = useMotionValue(1);

    useEffect(() => {
        const toX = flight.to.left + 16;
        const toY = flight.to.top + flight.to.height / 2 - 20;
        // A short arc: up and over, then down onto the vault.
        const peak = Math.min(flight.from.top, toY) - 80;

        animate(x, toX, { duration: 0.75, ease: [0.76, 0, 0.24, 1] });
        animate(y, [flight.from.top, peak, toY], {
            duration: 0.75,
            ease: [0.16, 1, 0.3, 1],
        }).then(async () => {
            // The landing sends a ripple across the vault.
            const row = document.getElementById('vault-card');

            row?.classList.add('cell-ripple');
            await animate(scaleY, [1, 0.82, 1.06, 1], { duration: 0.35 });
            setTimeout(() => row?.classList.remove('cell-ripple'), 700);
            onDone();
        });
    }, [flight, x, y, scaleY, onDone]);

    return (
        <motion.div
            style={{ x, y, scaleY, position: 'fixed', left: 0, top: 0, zIndex: 50 }}
            className="tile pointer-events-none px-3 py-2 font-mono text-[13px] text-navy"
            aria-hidden
        >
            +{formatAmount(flight.amount)} USDG
        </motion.div>
    );
}
