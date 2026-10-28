'use client';

import { useState, type FormEvent } from 'react';
import { formatUnits, parseUnits } from 'viem';

import { formatAmount } from '@/lib/format';
import { feeOf, liquidationPrice } from '@/lib/math';
import type { Snapshot, TraderSnapshot } from '@/lib/types';

import { TourTip } from '../Tour';
import { useAction } from '../useAction';
import { Note, SubmitButton } from './parts';

const LEVERAGES = [2, 5, 10] as const;

export function usd(value: string) {
    return `$${formatAmount(value).replace(/(\.\d{2})\d*$/, '$1')}`;
}

// What the vault will do with this order at the current oracle price.
function preview(price: string, isLong: boolean, collateral: string, leverage: number) {
    if (!/^\d+(\.\d{1,6})?$/.test(collateral) || Number(collateral) === 0) {
        return null;
    }

    const c = parseUnits(collateral, 6);
    const size = c * BigInt(leverage);
    const fee = feeOf(size);
    const liq = liquidationPrice({
        isLong,
        size,
        collateral: c,
        entryPrice: parseUnits(price, 8),
    });

    return {
        size: formatUnits(size, 6),
        fee: formatUnits(fee, 6),
        needs: c + fee,
        liquidation: formatUnits(liq, 8),
    };
}

export function TradeScreen({ s, trader }: { s: Snapshot; trader: TraderSnapshot }) {
    const [marketId, setMarketId] = useState(s.markets[0]!.id);
    const [side, setSide] = useState<'long' | 'short'>('long');
    const [collateral, setCollateral] = useState('');
    const [leverage, setLeverage] = useState<(typeof LEVERAGES)[number]>(5);
    const { busy, message, run } = useAction();
    const market = s.markets.find((m) => m.id === marketId)!;
    const open = trader.positions.find((p) => p.market === marketId);
    const p = preview(market.price, side === 'long', collateral, leverage);
    const short = p !== null && p.needs > parseUnits(trader.freeMargin, 6);

    async function submit(e: FormEvent<HTMLFormElement>) {
        e.preventDefault();

        if (
            await run(
                'open',
                {
                    action: 'open',
                    who: trader.id,
                    market: marketId,
                    side,
                    collateral,
                    leverage,
                },
                `Opened a ${leverage}x ${side} ${market.name}.`,
            )
        ) {
            setCollateral('');
        }
    }

    return (
        <TourTip step="trade" block>
            {(aria) => (
                <form onSubmit={submit} className="space-y-3" {...aria}>
                    <div className="grid grid-cols-2 gap-2">
                        {s.markets.map((m) => (
                            <button
                                key={m.id}
                                type="button"
                                onClick={() => setMarketId(m.id)}
                                aria-pressed={m.id === marketId}
                                className={`rounded-[2px] border px-3 py-2 text-left ${
                                    m.id === marketId
                                        ? 'border-navy bg-navy text-white'
                                        : 'border-sky bg-white hover:bg-sky/15'
                                }`}
                            >
                                <span className="block text-[13px] font-semibold">
                                    {m.name}
                                </span>
                                <span className="block font-mono text-[12px] opacity-80">
                                    {usd(m.price)}
                                </span>
                            </button>
                        ))}
                    </div>
                    <div className="grid grid-cols-2 gap-1 rounded-[2px] bg-sky/20 p-1">
                        {(['long', 'short'] as const).map((k) => (
                            <button
                                key={k}
                                type="button"
                                onClick={() => setSide(k)}
                                aria-pressed={side === k}
                                className={`rounded-[2px] py-1.5 text-[13px] font-medium capitalize ${
                                    side === k
                                        ? 'bg-white text-navy shadow-sm'
                                        : 'text-navy-2/80'
                                }`}
                            >
                                {k}
                            </button>
                        ))}
                    </div>
                    <label className="block text-[12px] text-navy-2/80">
                        Collateral from free margin
                        <input
                            value={collateral}
                            onChange={(e) => setCollateral(e.target.value.trim())}
                            inputMode="decimal"
                            placeholder="USDG amount"
                            className="mt-1 w-full rounded-[2px] border border-sky bg-white px-2 py-2 font-mono text-[13px] text-navy"
                        />
                    </label>
                    <div className="flex items-center gap-2 text-[12px] text-navy-2/80">
                        Leverage
                        {LEVERAGES.map((l) => (
                            <button
                                key={l}
                                type="button"
                                onClick={() => setLeverage(l)}
                                aria-pressed={leverage === l}
                                className={`rounded-[2px] border px-2.5 py-1 font-mono text-[12px] ${
                                    leverage === l
                                        ? 'border-blue bg-blue text-white'
                                        : 'border-sky bg-white text-navy'
                                }`}
                            >
                                {l}x
                            </button>
                        ))}
                    </div>
                    <dl className="grid grid-cols-2 gap-2 rounded-[2px] border border-sky/60 bg-white p-3 text-[12px]">
                        {(
                            [
                                ['Size', p ? `${formatAmount(p.size)} USD` : '0.00'],
                                [
                                    'Open fee, 0.10%',
                                    p ? `${formatAmount(p.fee)} USDG` : '0.00',
                                ],
                                ['Entry price', usd(market.price)],
                                ['Liquidation price', p ? usd(p.liquidation) : '-'],
                            ] as const
                        ).map(([label, value]) => (
                            <div key={label}>
                                <dt className="text-navy-2/75">{label}</dt>
                                <dd className="font-mono text-[13px]">{value}</dd>
                            </div>
                        ))}
                    </dl>
                    {open && (
                        <p className="text-[12px] text-navy-2/80">
                            {trader.name} already has a position in {market.name}. Close
                            it on the Positions tab to open another.
                        </p>
                    )}
                    {short && !open && (
                        <p className="text-[12px] text-navy-2/80">
                            This needs {formatAmount(formatUnits(p!.needs, 6))} USDG of
                            free margin. Deposit more on the Margin tab.
                        </p>
                    )}
                    <SubmitButton
                        busy={busy !== undefined}
                        disabled={!p || !!open || short}
                    >
                        Open {side} {market.name}
                    </SubmitButton>
                    {message && <Note ok={message.ok} text={message.text} />}
                </form>
            )}
        </TourTip>
    );
}
