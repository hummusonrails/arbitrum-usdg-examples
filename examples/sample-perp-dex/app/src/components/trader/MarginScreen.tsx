'use client';

import { useState, type FormEvent } from 'react';

import { DEPOSIT_NOTE, HOLDING_NOTE, REWARDS_NOTE } from '@/lib/copy';
import { formatAmount } from '@/lib/format';
import type { TraderSnapshot } from '@/lib/types';

import { TourTip } from '../Tour';
import { useAction } from '../useAction';
import { Note, SubmitButton } from './parts';

const AMOUNT = /^\d+(\.\d{1,6})?$/;

export function MarginScreen({ trader }: { trader: TraderSnapshot }) {
    return (
        <div className="space-y-3">
            <TourTip step="deposit" block>
                {(aria) => (
                    <div {...aria}>
                        <MoveForm
                            trader={trader}
                            action="deposit"
                            title="Deposit with one signature"
                            button="Sign and deposit"
                            note={DEPOSIT_NOTE}
                        />
                    </div>
                )}
            </TourTip>
            <Rewards trader={trader} />
            <MoveForm
                trader={trader}
                action="withdraw"
                title="Withdraw free margin"
                button="Withdraw to wallet"
            />
        </div>
    );
}

function MoveForm({
    trader,
    action,
    title,
    button,
    note,
}: {
    trader: TraderSnapshot;
    action: 'deposit' | 'withdraw';
    title: string;
    button: string;
    note?: string;
}) {
    const [amount, setAmount] = useState('');
    const { busy, message, run } = useAction();
    const max = action === 'deposit' ? trader.wallet.usdg : trader.freeMargin;

    async function submit(e: FormEvent<HTMLFormElement>) {
        e.preventDefault();

        if (
            await run(
                action,
                { action, who: trader.id, amount },
                action === 'deposit'
                    ? 'Deposited. The keeper paid the gas.'
                    : 'Withdrawn to the wallet.',
            )
        ) {
            setAmount('');
        }
    }

    return (
        <form onSubmit={submit} className="space-y-2 rounded-[2px] bg-sky/15 p-3">
            <div className="flex items-baseline justify-between">
                <p className="text-[13px] font-semibold">{title}</p>
                <button
                    type="button"
                    onClick={() => setAmount(max)}
                    className="font-mono text-[11.5px] text-blue"
                >
                    Max {formatAmount(max)}
                </button>
            </div>
            <input
                value={amount}
                onChange={(e) => setAmount(e.target.value.trim())}
                inputMode="decimal"
                placeholder="USDG amount"
                aria-label={`USDG to ${action}`}
                className="w-full rounded-[2px] border border-sky bg-white px-2 py-2 font-mono text-[13px]"
            />
            {note && <p className="text-[12px] text-navy-2/80">{note}</p>}
            <SubmitButton
                busy={busy !== undefined}
                disabled={!AMOUNT.test(amount) || Number(amount) === 0}
            >
                {button}
            </SubmitButton>
            {message && <Note ok={message.ok} text={message.text} />}
        </form>
    );
}

function Rewards({ trader }: { trader: TraderSnapshot }) {
    const { busy, message, run } = useAction();
    const ready = Number(trader.pendingRewards) > 0;

    return (
        <div className="rounded-[2px] border border-sky/60 bg-white p-3">
            <div className="flex items-baseline justify-between">
                <p className="text-[13px] font-semibold">USDG rewards ready</p>
                <p className="font-mono text-[13px]">
                    {formatAmount(trader.pendingRewards)}
                </p>
            </div>
            <button
                type="button"
                disabled={!ready || busy !== undefined}
                onClick={() =>
                    run(
                        'claim',
                        { action: 'claimRewards', who: trader.id },
                        'Rewards added to free margin.',
                    )
                }
                className="mt-2 w-full rounded-[2px] bg-blue px-3 py-2 text-[13px] font-medium text-white disabled:opacity-40"
            >
                Add to margin
            </button>
            {message && <Note ok={message.ok} text={message.text} />}
            <p className="mt-2 text-[11.5px] leading-4 text-navy-2/75">
                {REWARDS_NOTE} {HOLDING_NOTE}
            </p>
        </div>
    );
}
