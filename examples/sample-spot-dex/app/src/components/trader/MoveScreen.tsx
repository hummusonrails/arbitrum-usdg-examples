'use client';

import { CheckCircle2, Loader2 } from 'lucide-react';
import { useState, type FormEvent } from 'react';

import { RELAY_STAND_IN } from '@/lib/copy';
import { formatAmount, shortAddress } from '@/lib/format';
import type { Snapshot, WalletSnapshot } from '@/lib/types';

import { TourTip } from '../Tour';
import { useAction } from '../useAction';
import { Note, SubmitButton } from './parts';

const LABEL = { arbitrum: 'Arbitrum', ethereum: 'Ethereum' } as const;

export function MoveScreen({ s, wallet }: { s: Snapshot; wallet: WalletSnapshot }) {
    const [from, setFrom] = useState<'arbitrum' | 'ethereum'>('ethereum');
    const [amount, setAmount] = useState('');
    const { busy, message, run } = useAction();
    const to = from === 'arbitrum' ? 'ethereum' : 'arbitrum';
    const lane = s.lanes[from];
    const mine = s.transfers.filter((t) => t.wallet === wallet.id).slice(0, 5);

    async function submit(e: FormEvent<HTMLFormElement>) {
        e.preventDefault();

        if (
            await run(
                'move',
                { action: 'move', who: wallet.id, from, amount },
                `Sent. It arrives on ${LABEL[to]} once LayerZero delivers it.`,
            )
        ) {
            setAmount('');
        }
    }

    return (
        <TourTip step="move" block>
            {(aria) => (
                <div className="space-y-3" {...aria}>
                    <form onSubmit={submit} className="space-y-3">
                        <label className="flex flex-col gap-1 text-[12px] text-navy-2/80">
                            Send USDG
                            <select
                                value={from}
                                onChange={(e) => setFrom(e.target.value as typeof from)}
                                className="rounded-[2px] border border-sky bg-white px-2 py-2 text-[13px] text-navy"
                            >
                                <option value="ethereum">
                                    From Ethereum to Arbitrum
                                </option>
                                <option value="arbitrum">
                                    From Arbitrum to Ethereum
                                </option>
                            </select>
                        </label>
                        <input
                            value={amount}
                            onChange={(e) => setAmount(e.target.value.trim())}
                            inputMode="decimal"
                            placeholder="0.00"
                            aria-label="USDG to send"
                            className="w-full rounded-[2px] border border-sky bg-white px-3 py-2.5 font-mono text-lg"
                        />
                        <dl className="space-y-1 rounded-[2px] bg-sky/15 px-3 py-2.5 text-[12.5px]">
                            <div className="flex justify-between">
                                <dt className="text-navy-2/80">
                                    Available on {LABEL[from]}
                                </dt>
                                <dd className="font-mono">
                                    {formatAmount(wallet[from].usdg)} USDG
                                </dd>
                            </div>
                            <div className="flex justify-between">
                                <dt className="text-navy-2/80">
                                    LayerZero fee, in ETH
                                </dt>
                                <dd className="font-mono">
                                    {Number(lane.fee).toFixed(6)}
                                </dd>
                            </div>
                            <div className="flex justify-between">
                                <dt className="text-navy-2/80">Daily limit left</dt>
                                <dd className="font-mono">
                                    {formatAmount(lane.canSend)} USDG
                                </dd>
                            </div>
                        </dl>
                        <SubmitButton busy={busy !== undefined} disabled={!amount}>
                            Send to {LABEL[to]}
                        </SubmitButton>
                        {message && <Note ok={message.ok} text={message.text} />}
                    </form>
                    {mine.length > 0 && (
                        <ul className="space-y-1.5">
                            {mine.map((t) => (
                                <li
                                    key={t.guid}
                                    className="flex items-center justify-between rounded-[2px] border border-sky/60 bg-white px-3 py-2 text-[12.5px]"
                                >
                                    <span>
                                        {formatAmount(t.amountSent)} USDG to{' '}
                                        {LABEL[t.to]}
                                        <span className="block font-mono text-[11px] text-navy-2/65">
                                            guid {shortAddress(t.guid)}
                                        </span>
                                    </span>
                                    {t.status === 'delivered' ? (
                                        <span className="flex items-center gap-1 text-blue">
                                            <CheckCircle2
                                                className="size-3.5"
                                                aria-hidden
                                            />
                                            Delivered
                                        </span>
                                    ) : (
                                        <span className="flex items-center gap-1 text-navy-2">
                                            <Loader2
                                                className="size-3.5 animate-spin"
                                                aria-hidden
                                            />
                                            In flight
                                        </span>
                                    )}
                                </li>
                            ))}
                        </ul>
                    )}
                    <p className="text-[11.5px] leading-4 text-navy-2/75">
                        {RELAY_STAND_IN}
                    </p>
                </div>
            )}
        </TourTip>
    );
}
