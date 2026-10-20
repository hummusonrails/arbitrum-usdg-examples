'use client';

import { motion, useReducedMotion } from 'motion/react';
import { useEffect, useLayoutEffect, useRef, useState, type RefObject } from 'react';

import { formatAmount, shortAddress } from '@/lib/format';
import type { Snapshot } from '@/lib/types';
import { LEDGER_STATUS } from '@/lib/words';

type Row = Snapshot['ledger'][number];
type Lane = { key: string; title: string; rows: Row[] };
type Flight = { row: Row; from: DOMRect; to: DOMRect };

const CELLS_PER_LANE = 5;

function lanesOf(s: Snapshot): Lane[] {
    return [
        {
            key: 'mints',
            title: 'Mints',
            rows: s.ledger.filter((r) => r.source === 'app' && r.direction === 'in'),
        },
        {
            key: 'redeems',
            title: 'Redeems',
            rows: s.ledger.filter((r) => r.direction === 'out'),
        },
        {
            key: 'inflows',
            title: 'Wire inflows',
            rows: s.ledger.filter((r) => r.source === 'rule'),
        },
    ];
}

function Cell({
    row,
    explorer,
    rippling,
}: {
    row: Row;
    explorer: string;
    rippling: boolean;
}) {
    const alert = ['mismatch', 'stuck', 'failed'].includes(row.status);

    return (
        <li
            data-row={row.id}
            data-lit={row.status === 'matched'}
            data-alert={alert}
            className={`cell flex items-center justify-between gap-3 px-3 py-2.5 ${rippling ? 'cell-ripple' : ''}`}
        >
            <span className="min-w-0">
                <span className="block font-mono text-[15px]">
                    {formatAmount(row.amount)}
                </span>
                {row.crypto_tx_hash ? (
                    <a
                        href={`${explorer}/tx/${row.crypto_tx_hash}`}
                        target="_blank"
                        rel="noreferrer"
                        className="font-mono text-[11px] text-navy-2/60 hover:text-blue"
                    >
                        {shortAddress(row.crypto_tx_hash)}
                    </a>
                ) : (
                    <span className="text-[11px] text-navy-2/50">
                        Waiting for Arbitrum
                    </span>
                )}
            </span>
            <span
                className={`text-[12px] ${alert ? 'font-medium text-error' : 'text-navy-2'}`}
            >
                {LEDGER_STATUS[row.status] ?? row.status}
            </span>
        </li>
    );
}

// The reconciliation board, a desk in front of the slate. When a record
// matches on Arbitrum it lifts off the slate as a tile, flies a short arc, and
// lands in its lane. One flight at a time.
export function TileBoard({
    snapshot,
    slateRef,
    onFlight,
}: {
    snapshot: Snapshot;
    slateRef: RefObject<HTMLDivElement | null>;
    onFlight?: (flying: boolean) => void;
}) {
    const reduce = useReducedMotion();
    const boardRef = useRef<HTMLDivElement>(null);
    const known = useRef<Set<string> | null>(null);
    const [queue, setQueue] = useState<Row[]>([]);
    const [flight, setFlight] = useState<Flight>();
    const [hidden, setHidden] = useState<Set<string>>(new Set());
    const [rippling, setRippling] = useState<string>();
    const lanes = lanesOf(snapshot);

    // Rows already matched on first load stay put; only new matches fly.
    useEffect(() => {
        const matched = snapshot.ledger.filter((r) => r.status === 'matched');

        if (!known.current) {
            known.current = new Set(matched.map((r) => r.id));

            return;
        }

        const fresh = matched.filter((r) => !known.current!.has(r.id));

        if (fresh.length > 0) {
            fresh.forEach((r) => known.current!.add(r.id));

            if (!reduce) {
                setHidden((h) => new Set([...h, ...fresh.map((r) => r.id)]));
                setQueue((q) => [...q, ...fresh]);
            }
        }
    }, [snapshot, reduce]);

    useEffect(() => onFlight?.(flight !== undefined), [flight, onFlight]);

    useLayoutEffect(() => {
        if (flight || queue.length === 0) {
            return;
        }

        const [next, ...rest] = queue;
        const target = boardRef.current?.querySelector(`[data-row="${next!.id}"]`);
        const slate = slateRef.current;

        setQueue(rest);

        if (!target || !slate) {
            setHidden((h) => new Set([...h].filter((id) => id !== next!.id)));

            return;
        }

        const s = slate.getBoundingClientRect();
        const to = target.getBoundingClientRect();

        setFlight({
            row: next!,
            from: new DOMRect(
                s.left + s.width / 2 - to.width / 2,
                s.bottom - to.height - 24,
                to.width,
                to.height,
            ),
            to,
        });
    }, [queue, flight, slateRef]);

    function land(id: string) {
        setFlight(undefined);
        setHidden((h) => new Set([...h].filter((x) => x !== id)));
        setRippling(id);
        setTimeout(() => setRippling((r) => (r === id ? undefined : r)), 700);
    }

    return (
        <>
            <div className="set-floor">
                <div
                    ref={boardRef}
                    className="board board-plane power-on p-3 md:p-4"
                    style={{ ['--power-delay' as string]: '1400ms' }}
                >
                    <div className="grid gap-3 lg:grid-cols-3">
                        {lanes.map((lane) => (
                            <section key={lane.key} aria-label={lane.title}>
                                <header className="flex items-center justify-between px-1 pb-2">
                                    <h2 className="text-[14px] font-semibold">
                                        {lane.title}
                                    </h2>
                                    <span className="font-mono text-xs text-navy-2/70">
                                        {lane.rows.length}
                                    </span>
                                </header>
                                <ul className="space-y-2">
                                    {lane.rows.slice(0, CELLS_PER_LANE).map((row) => (
                                        <div
                                            key={row.id}
                                            style={{
                                                visibility: hidden.has(row.id)
                                                    ? 'hidden'
                                                    : 'visible',
                                            }}
                                        >
                                            <Cell
                                                row={row}
                                                explorer={snapshot.explorer}
                                                rippling={rippling === row.id}
                                            />
                                        </div>
                                    ))}
                                    {Array.from(
                                        {
                                            length: Math.max(
                                                CELLS_PER_LANE - lane.rows.length,
                                                0,
                                            ),
                                        },
                                        (_, i) => (
                                            <li
                                                key={`empty-${i}`}
                                                className={`cell h-[54px] opacity-60 ${i >= 2 ? 'hidden lg:block' : ''}`}
                                                aria-hidden
                                            />
                                        ),
                                    )}
                                </ul>
                            </section>
                        ))}
                    </div>
                </div>
            </div>
            {flight && (
                <motion.div
                    key={flight.row.id}
                    className="cell pointer-events-none fixed top-0 left-0 z-50 flex items-center justify-between px-3"
                    data-lit
                    style={{ width: flight.to.width, height: flight.to.height }}
                    initial={{
                        x: flight.from.left,
                        y: flight.from.top,
                        scaleX: 1,
                        scaleY: 1,
                    }}
                    animate={{
                        // A short wind up, a lifted arc, then a squash and damped wobble on landing.
                        x: [
                            flight.from.left,
                            flight.from.left,
                            (flight.from.left + flight.to.left) / 2,
                            flight.to.left,
                            flight.to.left,
                            flight.to.left,
                        ],
                        y: [
                            flight.from.top,
                            flight.from.top + 4,
                            Math.min(flight.from.top, flight.to.top) - 70,
                            flight.to.top,
                            flight.to.top,
                            flight.to.top,
                        ],
                        scaleX: [1, 1.04, 0.96, 1.08, 0.97, 1],
                        scaleY: [1, 0.9, 1.12, 0.86, 1.04, 1],
                        rotateX: [0, 0, -18, 14, 14, 14],
                    }}
                    transition={{
                        duration: 1.35,
                        times: [0, 0.07, 0.4, 0.74, 0.88, 1],
                        ease: 'easeInOut',
                    }}
                    onAnimationComplete={() => land(flight.row.id)}
                >
                    <span className="font-mono text-[15px]">
                        {formatAmount(flight.row.amount)}
                    </span>
                    <span className="text-[12px] text-navy-2">Matched</span>
                </motion.div>
            )}
        </>
    );
}
