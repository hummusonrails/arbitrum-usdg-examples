'use client';

import { Loader2, Plus } from 'lucide-react';
import { useEffect, useState } from 'react';

import { formatAmount } from '@/lib/format';
import type { WalletSnapshot } from '@/lib/types';

import { AcmeMark } from '../Sidebar';
import { useTour } from '../Tour';
import { useAction } from '../useAction';
import { useSnapshot } from '../useSnapshot';
import { MoveScreen } from './MoveScreen';
import { Note } from './parts';
import { PoolScreen } from './PoolScreen';
import { SwapScreen } from './SwapScreen';

type Tab = 'swap' | 'pool' | 'move';

const TABS: [Tab, string][] = [
    ['swap', 'Swap'],
    ['pool', 'Pool'],
    ['move', 'Move'],
];

// What an Acme Swap user sees, for one of three demo wallets. Each wallet's
// key stays on the server, which signs on its behalf.
export function TraderApp() {
    const s = useSnapshot();
    const [walletId, setWalletId] = useState('lena');
    const [tab, setTab] = useState<Tab>('swap');
    const wallet = s?.wallets.find((w) => w.id === walletId);
    const tour = useTour();
    const tourTab = TABS.find(([key]) => tour.active(key))?.[0];

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
                    <span className="text-[15px] font-semibold">Acme Swap</span>
                </div>
                <label className="text-[12px] text-navy-2">
                    <span className="sr-only">Wallet</span>
                    <select
                        value={walletId}
                        onChange={(e) => setWalletId(e.target.value)}
                        className="rounded-[2px] border border-sky bg-white px-2 py-1 font-medium"
                    >
                        {(s?.wallets ?? []).map((w) => (
                            <option key={w.id} value={w.id}>
                                {w.name} ({w.role === 'lp' ? 'LP' : 'trader'})
                            </option>
                        ))}
                    </select>
                </label>
            </div>
            {!s || !wallet ? (
                <p className="flex items-center justify-center gap-2 py-24 text-sm text-navy-2">
                    <Loader2 className="size-4 animate-spin" /> Loading
                </p>
            ) : (
                <div className="relative p-4">
                    <Balances wallet={wallet} />
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
                            </button>
                        ))}
                    </div>
                    <div className="mt-4">
                        {tab === 'swap' ? (
                            <SwapScreen s={s} wallet={wallet} />
                        ) : tab === 'pool' ? (
                            <PoolScreen s={s} wallet={wallet} />
                        ) : (
                            <MoveScreen s={s} wallet={wallet} />
                        )}
                    </div>
                </div>
            )}
        </div>
    );
}

function Balances({ wallet }: { wallet: WalletSnapshot }) {
    const { busy, message, run } = useAction();
    const rows: [string, string][] = [
        ['USDG on Arbitrum', wallet.arbitrum.usdg],
        ['USDG on Ethereum', wallet.ethereum.usdg],
        ['WETH', wallet.arbitrum.weth],
        ['ARB', wallet.arbitrum.arb],
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
                        { action: 'fundDemo', who: wallet.id },
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
