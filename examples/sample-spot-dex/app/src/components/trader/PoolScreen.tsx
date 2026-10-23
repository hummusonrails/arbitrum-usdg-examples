'use client';

import { useState, type FormEvent } from 'react';
import { formatUnits, parseUnits } from 'viem';

import { HOLDING_NOTE, REWARDS_NOTE } from '@/lib/copy';
import { formatAmount, formatMoney } from '@/lib/format';
import type { PoolSnapshot, Snapshot, WalletSnapshot } from '@/lib/types';

import { TourTip } from '../Tour';
import { useAction } from '../useAction';
import { Note, poolOf, SubmitButton } from './parts';

// The base token that goes in beside `usdg` at the pool price, as the server
// computes it (rounded up).
function baseFor(pool: PoolSnapshot, usdg: string): string | null {
    if (!/^\d+(\.\d{1,6})?$/.test(usdg)) {
        return null;
    }

    const quote = parseUnits(usdg, 6);
    const rBase = parseUnits(pool.baseReserve, 18);
    const rQuote = parseUnits(pool.quoteReserve, 6);

    return formatUnits((quote * rBase + rQuote - 1n) / rQuote, 18);
}

export function PoolScreen({ s, wallet }: { s: Snapshot; wallet: WalletSnapshot }) {
    return (
        <div className="space-y-3">
            <TourTip step="pool" block>
                {(aria) => (
                    <div className="space-y-3" {...aria}>
                        {wallet.positions.map((p) => (
                            <Position
                                key={p.poolId}
                                pool={poolOf(s, p.poolId)}
                                position={p}
                                walletId={wallet.id}
                            />
                        ))}
                    </div>
                )}
            </TourTip>
            <AddLiquidity s={s} wallet={wallet} />
            <p className="text-[11.5px] leading-4 text-navy-2/75">
                {REWARDS_NOTE} {HOLDING_NOTE}
            </p>
        </div>
    );
}

function Position({
    pool,
    position,
    walletId,
}: {
    pool: PoolSnapshot;
    position: WalletSnapshot['positions'][number];
    walletId: string;
}) {
    const { busy, message, run } = useAction();
    const hasLp = Number(position.lp) > 0;
    const hasRewards = Number(position.pendingRewards) > 0;

    return (
        <div className="rounded-[2px] border border-sky/60 bg-white p-3">
            <div className="flex items-baseline justify-between">
                <p className="text-[14px] font-semibold">{pool.pair}</p>
                <p className="font-mono text-[12px] text-navy-2/75">
                    {position.share.toFixed(2)}% of the pool
                </p>
            </div>
            <dl className="mt-2 grid grid-cols-2 gap-2 text-[12px]">
                <div>
                    <dt className="text-navy-2/75">Position value</dt>
                    <dd className="font-mono text-[13px]">
                        {formatMoney(position.value)} USDG
                    </dd>
                </div>
                <div>
                    <dt className="text-navy-2/75">USDG rewards ready</dt>
                    <dd className="font-mono text-[13px]">
                        {formatAmount(position.pendingRewards)}
                    </dd>
                </div>
            </dl>
            <div className="mt-3 flex gap-2">
                <button
                    type="button"
                    disabled={!hasRewards || busy !== undefined}
                    onClick={() =>
                        run(
                            'claim',
                            { action: 'claimLp', who: walletId, poolId: pool.id },
                            'Rewards claimed.',
                        )
                    }
                    className="flex-1 rounded-[2px] bg-blue px-3 py-2 text-[13px] font-medium text-white disabled:opacity-40"
                >
                    Claim rewards
                </button>
                <button
                    type="button"
                    disabled={!hasLp || busy !== undefined}
                    onClick={() =>
                        run(
                            'remove',
                            {
                                action: 'remove',
                                who: walletId,
                                poolId: pool.id,
                                amount: 'all',
                            },
                            'Liquidity removed.',
                        )
                    }
                    className="flex-1 rounded-[2px] border border-sky px-3 py-2 text-[13px] font-medium disabled:opacity-40"
                >
                    Remove all
                </button>
            </div>
            {message && <Note ok={message.ok} text={message.text} />}
        </div>
    );
}

function AddLiquidity({ s, wallet }: { s: Snapshot; wallet: WalletSnapshot }) {
    const [poolId, setPoolId] = useState('weth');
    const [amount, setAmount] = useState('');
    const { busy, message, run } = useAction();
    const pool = poolOf(s, poolId);
    const base = amount ? baseFor(pool, amount) : null;

    async function submit(e: FormEvent<HTMLFormElement>) {
        e.preventDefault();

        if (
            await run(
                'add',
                { action: 'add', who: wallet.id, poolId, amount },
                'Liquidity added.',
            )
        ) {
            setAmount('');
        }
    }

    return (
        <form onSubmit={submit} className="space-y-2 rounded-[2px] bg-sky/15 p-3">
            <p className="text-[13px] font-semibold">Add liquidity</p>
            <div className="grid grid-cols-[1fr_1.2fr] gap-2">
                <select
                    value={poolId}
                    onChange={(e) => setPoolId(e.target.value)}
                    aria-label="Pool"
                    className="rounded-[2px] border border-sky bg-white px-2 py-2 text-[13px]"
                >
                    {s.pools.map((p) => (
                        <option key={p.id} value={p.id}>
                            {p.pair}
                        </option>
                    ))}
                </select>
                <input
                    value={amount}
                    onChange={(e) => setAmount(e.target.value.trim())}
                    inputMode="decimal"
                    placeholder="USDG amount"
                    aria-label="USDG to add"
                    className="rounded-[2px] border border-sky bg-white px-2 py-2 font-mono text-[13px]"
                />
            </div>
            <p className="text-[12px] text-navy-2/80">
                With{' '}
                <span className="font-mono">
                    {base ? formatAmount(base) : '0.00'} {pool.baseSymbol}
                </span>{' '}
                at the pool price.
            </p>
            <SubmitButton busy={busy !== undefined} disabled={!base}>
                Add liquidity
            </SubmitButton>
            {message && <Note ok={message.ok} text={message.text} />}
        </form>
    );
}
