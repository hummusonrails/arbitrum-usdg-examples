'use client';

import { Loader2, Plus } from 'lucide-react';
import { useEffect, useState } from 'react';

import { formatAmount } from '@/lib/format';
import type { TraderSnapshot } from '@/lib/types';

import { AcmeMark } from '../Sidebar';
import { useTour } from '../Tour';
import { useAction } from '../useAction';
import { useSnapshot } from '../useSnapshot';
import { MarginScreen } from './MarginScreen';
import { Note } from './parts';
import { PositionsScreen } from './PositionsScreen';
import { TradeScreen } from './TradeScreen';

type Tab = 'trade' | 'positions' | 'margin';

const TABS: [Tab, string][] = [
    ['trade', 'Trade'],
    ['positions', 'Positions'],
    ['margin', 'Margin'],
];

// Which tab each tour step on this side points at.
const TOUR_TABS: Partial<Record<string, Tab>> = { deposit: 'margin', trade: 'trade' };

// What an Acme Perps trader sees, for one of three demo traders. Each trader's
// key stays on the server, which signs on their behalf.
export function TraderApp() {
    const s = useSnapshot();
    const [traderId, setTraderId] = useState('mei');
    const [tab, setTab] = useState<Tab>('margin');
    const trader = s?.traders.find((t) => t.id === traderId);
    const tour = useTour();
    const tourTab = Object.entries(TOUR_TABS).find(([step]) =>
        tour.active(step as 'deposit' | 'trade'),
    )?.[1];

    // A tour step on one of the tabs opens that tab, so its tip has a target.
    useEffect(() => {
        if (tourTab) {
            setTab(tourTab);
        }
    }, [tourTab]);

    return (
        // Visible overflow lets the tour tips extend past the frame.
        <div className="tile mx-auto w-full max-w-[420px] overflow-visible">
            <div className="flex items-center justify-between border-b border-sky/60 bg-white/80 px-4 py-3">
                <div className="flex items-center gap-2">
                    <AcmeMark size={26} />
                    <span className="text-[15px] font-semibold">Acme Perps</span>
                </div>
                <label className="text-[12px] text-navy-2">
                    <span className="sr-only">Trader</span>
                    <select
                        value={traderId}
                        onChange={(e) => setTraderId(e.target.value)}
                        className="rounded-[2px] border border-sky bg-white px-2 py-1 font-medium"
                    >
                        {(s?.traders ?? []).map((t) => (
                            <option key={t.id} value={t.id}>
                                {t.name}
                            </option>
                        ))}
                    </select>
                </label>
            </div>
            {!s || !trader ? (
                <p className="flex items-center justify-center gap-2 py-24 text-sm text-navy-2">
                    <Loader2 className="size-4 animate-spin" /> Loading
                </p>
            ) : (
                <div className="relative p-4">
                    <Balances trader={trader} />
                    <div className="mt-4 flex gap-1" role="tablist">
                        {TABS.map(([key, label]) => (
                            <button
                                key={key}
                                type="button"
                                role="tab"
                                aria-selected={tab === key}
                                onClick={() => setTab(key)}
                                className={`flex-1 rounded-[2px] px-3 py-2 text-sm font-medium ${
                                    tab === key
                                        ? 'bg-navy text-white'
                                        : 'border border-sky bg-white/70 hover:bg-sky/15'
                                }`}
                            >
                                {label}
                                {key === 'positions' && trader.positions.length > 0
                                    ? ` (${trader.positions.length})`
                                    : ''}
                            </button>
                        ))}
                    </div>
                    <div className="mt-4">
                        {tab === 'trade' ? (
                            <TradeScreen s={s} trader={trader} />
                        ) : tab === 'positions' ? (
                            <PositionsScreen s={s} trader={trader} />
                        ) : (
                            <MarginScreen trader={trader} />
                        )}
                    </div>
                </div>
            )}
        </div>
    );
}

function Balances({ trader }: { trader: TraderSnapshot }) {
    const { busy, message, run } = useAction();
    const rows: [string, string][] = [
        ['USDG in wallet', trader.wallet.usdg],
        ['Free margin', trader.freeMargin],
        ['In positions', trader.locked],
        ['USDG rewards ready', trader.pendingRewards],
    ];

    return (
        <div className="rounded-[2px] border border-sky/60 bg-[#f4f9fd] p-3">
            <dl className="grid grid-cols-2 gap-x-4 gap-y-2 text-[12px]">
                {rows.map(([label, value]) => (
                    <div key={label}>
                        <dt className="text-navy-2/75">{label}</dt>
                        <dd className="font-mono text-[13px]">{formatAmount(value)}</dd>
                    </div>
                ))}
            </dl>
            <button
                type="button"
                disabled={busy !== undefined}
                onClick={() =>
                    run(
                        'fund',
                        { action: 'fundDemo', who: trader.id },
                        'Demo funds added.',
                    )
                }
                className="mt-3 inline-flex items-center gap-1.5 text-[12.5px] font-medium text-blue disabled:opacity-50"
            >
                {busy ? (
                    <Loader2 className="size-3.5 animate-spin" aria-hidden />
                ) : (
                    <Plus className="size-3.5" aria-hidden />
                )}
                Add demo funds (local fork)
            </button>
            {message && <Note ok={message.ok} text={message.text} />}
        </div>
    );
}
