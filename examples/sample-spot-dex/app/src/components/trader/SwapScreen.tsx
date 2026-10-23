'use client';

import { useState, type FormEvent } from 'react';
import { formatUnits, parseUnits } from 'viem';

import { formatAmount } from '@/lib/format';
import type { PoolSnapshot, Snapshot, WalletSnapshot } from '@/lib/types';

import { TourTip } from '../Tour';
import { useAction } from '../useAction';
import { Note, poolOf, SubmitButton } from './parts';

const SLIPPAGE_BPS = 50n;

// The pool's own formula with its 0.30% fee, so the quote matches what
// pool.getAmountOut returns for the same reserves.
function quote(pool: PoolSnapshot, side: 'buy' | 'sell', amount: string) {
    const decimalsIn = side === 'buy' ? 6 : 18;
    const decimalsOut = side === 'buy' ? 18 : 6;
    const pattern = new RegExp(`^\\d+(\\.\\d{1,${decimalsIn}})?$`);

    if (!pattern.test(amount)) {
        return null;
    }

    const rBase = parseUnits(pool.baseReserve, 18);
    const rQuote = parseUnits(pool.quoteReserve, 6);
    const [rIn, rOut] = side === 'buy' ? [rQuote, rBase] : [rBase, rQuote];
    const withFee = parseUnits(amount, decimalsIn) * 997n;
    const out = (withFee * rOut) / (rIn * 1000n + withFee);

    return {
        out: formatUnits(out, decimalsOut),
        min: formatUnits((out * (10_000n - SLIPPAGE_BPS)) / 10_000n, decimalsOut),
    };
}

export function SwapScreen({ s, wallet }: { s: Snapshot; wallet: WalletSnapshot }) {
    const [poolId, setPoolId] = useState('weth');
    const [side, setSide] = useState<'buy' | 'sell'>('buy');
    const [amount, setAmount] = useState('');
    const { busy, message, run } = useAction();
    const pool = poolOf(s, poolId);
    const q = amount ? quote(pool, side, amount) : null;
    const [inSymbol, outSymbol] =
        side === 'buy' ? ['USDG', pool.baseSymbol] : [pool.baseSymbol, 'USDG'];

    async function submit(e: FormEvent<HTMLFormElement>) {
        e.preventDefault();

        if (
            await run(
                'swap',
                {
                    action: 'swap',
                    who: wallet.id,
                    poolId,
                    side,
                    amount,
                    minOut: q?.min,
                },
                `Swapped ${amount} ${inSymbol}.`,
            )
        ) {
            setAmount('');
        }
    }

    return (
        <TourTip step="swap" block>
            {(aria) => (
                <form onSubmit={submit} className="space-y-3" {...aria}>
                    <div className="grid grid-cols-2 gap-2">
                        <label className="flex flex-col gap-1 text-[12px] text-navy-2/80">
                            Pool
                            <select
                                value={poolId}
                                onChange={(e) => setPoolId(e.target.value)}
                                className="rounded-[2px] border border-sky bg-white px-2 py-2 text-[13px] text-navy"
                            >
                                {s.pools.map((p) => (
                                    <option key={p.id} value={p.id}>
                                        {p.pair}
                                    </option>
                                ))}
                            </select>
                        </label>
                        <label className="flex flex-col gap-1 text-[12px] text-navy-2/80">
                            Direction
                            <select
                                value={side}
                                onChange={(e) =>
                                    setSide(e.target.value as 'buy' | 'sell')
                                }
                                className="rounded-[2px] border border-sky bg-white px-2 py-2 text-[13px] text-navy"
                            >
                                <option value="buy">
                                    Buy {pool.baseSymbol} with USDG
                                </option>
                                <option value="sell">
                                    Sell {pool.baseSymbol} for USDG
                                </option>
                            </select>
                        </label>
                    </div>
                    <label className="flex flex-col gap-1 text-[12px] text-navy-2/80">
                        You pay, {inSymbol}
                        <input
                            value={amount}
                            onChange={(e) => setAmount(e.target.value.trim())}
                            inputMode="decimal"
                            placeholder="0.00"
                            className="rounded-[2px] border border-sky bg-white px-3 py-2.5 font-mono text-lg text-navy"
                        />
                    </label>
                    <dl className="space-y-1 rounded-[2px] bg-sky/15 px-3 py-2.5 text-[12.5px]">
                        <div className="flex justify-between">
                            <dt className="text-navy-2/80">You receive about</dt>
                            <dd className="font-mono">
                                {q ? `${formatAmount(q.out)} ${outSymbol}` : '0.00'}
                            </dd>
                        </div>
                        <div className="flex justify-between">
                            <dt className="text-navy-2/80">Minimum, 0.5% slippage</dt>
                            <dd className="font-mono">
                                {q ? `${formatAmount(q.min)} ${outSymbol}` : '0.00'}
                            </dd>
                        </div>
                        <div className="flex justify-between">
                            <dt className="text-navy-2/80">Pool price</dt>
                            <dd className="font-mono">
                                1 {pool.baseSymbol} = {formatAmount(pool.price)} USDG
                            </dd>
                        </div>
                    </dl>
                    <SubmitButton busy={busy !== undefined} disabled={!q}>
                        Swap
                    </SubmitButton>
                    {message && <Note ok={message.ok} text={message.text} />}
                </form>
            )}
        </TourTip>
    );
}
