'use client';

import { formatAmount } from '@/lib/format';
import type { PositionSnapshot, Snapshot, TraderSnapshot } from '@/lib/types';

import { useAction } from '../useAction';
import { Note } from './parts';
import { usd } from './TradeScreen';

export function PositionsScreen({
    s,
    trader,
}: {
    s: Snapshot;
    trader: TraderSnapshot;
}) {
    if (trader.positions.length === 0) {
        return (
            <p className="rounded-[2px] border border-sky/60 bg-white p-4 text-[13px] text-navy-2/80">
                {trader.name} has no open positions. Open one on the Trade tab.
            </p>
        );
    }

    return (
        <div className="space-y-3">
            {trader.positions.map((p) => (
                <Position
                    key={p.market}
                    position={p}
                    name={s.markets.find((m) => m.id === p.market)!.name}
                    traderId={trader.id}
                />
            ))}
            <p className="text-[11.5px] leading-4 text-navy-2/75">
                The keeper liquidates a position once its equity falls to 1% of its
                size. Its collateral then goes to the house.
            </p>
        </div>
    );
}

function Position({
    position: p,
    name,
    traderId,
}: {
    position: PositionSnapshot;
    name: string;
    traderId: string;
}) {
    const { busy, message, run } = useAction();
    const loss = p.pnl.startsWith('-');

    return (
        <div className="rounded-[2px] border border-sky/60 bg-white p-3">
            <div className="flex items-baseline justify-between">
                <p className="text-[14px] font-semibold">
                    {name}{' '}
                    <span
                        className={`text-[12px] font-medium capitalize ${p.side === 'long' ? 'text-blue' : 'text-navy-2'}`}
                    >
                        {p.leverage}x {p.side}
                    </span>
                </p>
                <p
                    className={`font-mono text-[13px] font-medium ${loss ? 'text-error' : 'text-blue'}`}
                >
                    {loss ? '' : '+'}
                    {formatAmount(p.pnl)} USDG
                </p>
            </div>
            <dl className="mt-2 grid grid-cols-2 gap-2 text-[12px]">
                {(
                    [
                        ['Size', `${formatAmount(p.size)} USD`],
                        ['Collateral', `${formatAmount(p.collateral)} USDG`],
                        ['Entry, mark', `${usd(p.entryPrice)}, ${usd(p.markPrice)}`],
                        ['Liquidation price', usd(p.liquidationPrice)],
                    ] as const
                ).map(([label, value]) => (
                    <div key={label}>
                        <dt className="text-navy-2/75">{label}</dt>
                        <dd className="font-mono text-[12.5px]">{value}</dd>
                    </div>
                ))}
            </dl>
            <button
                type="button"
                disabled={busy !== undefined}
                onClick={() =>
                    run(
                        'close',
                        { action: 'close', who: traderId, market: p.market },
                        'Position closed. The payout is in free margin.',
                    )
                }
                className="mt-3 w-full rounded-[2px] border border-sky px-3 py-2 text-[13px] font-medium disabled:opacity-40"
            >
                Close at the oracle price
            </button>
            {message && <Note ok={message.ok} text={message.text} />}
        </div>
    );
}
