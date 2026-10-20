'use client';

import { ArrowDownToLine, ArrowUpFromLine, Landmark } from 'lucide-react';
import { useEffect, useState, type FormEvent } from 'react';

import { postAction } from '@/lib/api';
import { formatAmount } from '@/lib/format';
import { GUIDES, TOUR_ORDER } from '@/lib/guides';

import { Tip } from './Tip';

type Mode = 'mint' | 'redeem' | null;
type Step = (typeof TOUR_ORDER)[number];

const TOUR_KEY = 'sample-business-treasury.tour.done';

// A short first visit tour across the three actions, remembered per browser.
function useTour() {
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

    return {
        active: (s: Step) => step !== null && TOUR_ORDER[step] === s,
        step,
        next: () =>
            step !== null && step < TOUR_ORDER.length - 1
                ? setStep(step + 1)
                : finish(),
        finish,
        restart: () => setStep(0),
    };
}

export function ActionBar({ mode }: { mode: string }) {
    const [open, setOpen] = useState<Mode>(null);
    const [amount, setAmount] = useState('');
    const [busy, setBusy] = useState(false);
    const [note, setNote] = useState<{ ok: boolean; text: string }>();
    const tour = useTour();
    const sandboxLike = mode !== 'production';

    async function run(body: Record<string, unknown>, done: string) {
        setBusy(true);
        setNote(undefined);

        const res = await postAction(body);

        setBusy(false);
        setNote({
            ok: res.ok,
            text: res.ok ? done : (res.message ?? 'Something went wrong.'),
        });

        if (res.ok) {
            setOpen(null);
            setAmount('');
        }
    }

    function submit(e: FormEvent) {
        e.preventDefault();

        // A mint spends USD, which moves in cents; a redeem sends USDG, which has six decimals.
        const valid = open === 'mint' ? /^\d+(\.\d{1,2})?$/ : /^\d+(\.\d{1,6})?$/;

        if (!valid.test(amount)) {
            setNote({
                ok: false,
                text:
                    open === 'mint'
                        ? 'Enter a USD amount like 250 or 1234.50'
                        : 'Enter a USDG amount with at most six decimals',
            });

            return;
        }

        run(
            { action: open, amount },
            open === 'mint'
                ? `Minting ${formatAmount(amount)} USDG`
                : `Redeeming ${formatAmount(amount)} USDG`,
        );
    }

    function tourFooter(s: Step) {
        if (!tour.active(s) || tour.step === null) {
            return undefined;
        }

        const last =
            tour.step === (sandboxLike ? TOUR_ORDER.length : TOUR_ORDER.length - 1) - 1;

        return (
            <div className="mt-4 flex items-center justify-between border-t border-white/10 pt-3">
                <span className="font-mono text-[11px] text-white/60">
                    {tour.step + 1} of{' '}
                    {sandboxLike ? TOUR_ORDER.length : TOUR_ORDER.length - 1}
                </span>
                <span className="flex gap-2">
                    <button
                        onClick={tour.finish}
                        className="rounded-[2px] px-2.5 py-1 text-[12px] text-white/70 hover:text-white"
                    >
                        Skip
                    </button>
                    <button
                        onClick={last ? tour.finish : tour.next}
                        className="rounded-[2px] bg-blue px-3 py-1 text-[12px] font-medium text-white hover:bg-blue/90"
                    >
                        {last ? 'Got it' : 'Next'}
                    </button>
                </span>
            </div>
        );
    }

    const button =
        'flex items-center gap-2 rounded-[2px] border px-4 py-2.5 text-sm font-medium transition-colors disabled:opacity-50';

    return (
        <div className="tile overflow-visible p-4">
            <div className="relative flex flex-wrap items-center gap-3">
                <Tip
                    guide={GUIDES.mint}
                    open={tour.active('mint') || undefined}
                    footer={tourFooter('mint')}
                >
                    {(a11y) => (
                        <button
                            {...a11y}
                            className={`${button} border-navy bg-navy text-white hover:bg-navy-2`}
                            onClick={() => setOpen(open === 'mint' ? null : 'mint')}
                            disabled={busy}
                        >
                            <ArrowDownToLine className="size-4" /> Mint now
                        </button>
                    )}
                </Tip>
                <Tip
                    guide={GUIDES.redeem}
                    open={tour.active('redeem') || undefined}
                    footer={tourFooter('redeem')}
                >
                    {(a11y) => (
                        <button
                            {...a11y}
                            className={`${button} border-sky bg-white hover:bg-sky/20`}
                            onClick={() => setOpen(open === 'redeem' ? null : 'redeem')}
                            disabled={busy}
                        >
                            <ArrowUpFromLine className="size-4" /> Redeem now
                        </button>
                    )}
                </Tip>
                {sandboxLike && (
                    <Tip
                        guide={GUIDES.wire}
                        open={tour.active('wire') || undefined}
                        footer={tourFooter('wire')}
                    >
                        {(a11y) => (
                            <button
                                {...a11y}
                                className={`${button} border-sky bg-white hover:bg-sky/20`}
                                onClick={() =>
                                    run(
                                        { action: 'simulateWire' },
                                        'Wire sent. The auto mint rule takes it from here.',
                                    )
                                }
                                disabled={busy}
                            >
                                <Landmark className="size-4" /> Simulate wire deposit
                            </button>
                        )}
                    </Tip>
                )}
                {note && (
                    <p
                        role="status"
                        className={`text-[13px] ${note.ok ? 'text-navy-2' : 'text-error'}`}
                    >
                        {note.text}
                    </p>
                )}
                {tour.step === null && (
                    <button
                        onClick={tour.restart}
                        className="ml-auto text-[13px] text-navy-2/70 underline-offset-4 hover:text-blue hover:underline"
                    >
                        Show tips
                    </button>
                )}
            </div>
            {open && (
                <form
                    onSubmit={submit}
                    className="relative mt-4 flex flex-wrap items-center gap-3 border-t border-sky/50 pt-4"
                >
                    <label className="text-sm" htmlFor="amount">
                        {open === 'mint'
                            ? 'USD to mint as USDG'
                            : 'USDG to redeem to the bank'}
                    </label>
                    <input
                        id="amount"
                        inputMode="decimal"
                        autoFocus
                        value={amount}
                        onChange={(e) => setAmount(e.target.value.trim())}
                        placeholder="0.00"
                        className="w-40 rounded-[2px] border border-sky bg-white px-3 py-2 font-mono text-sm outline-none focus:border-blue focus:ring-2 focus:ring-blue/20"
                    />
                    <button
                        className={`${button} border-blue bg-blue text-white hover:bg-blue/90`}
                        disabled={busy}
                    >
                        {open === 'mint' ? 'Mint' : 'Redeem'}
                    </button>
                </form>
            )}
        </div>
    );
}
