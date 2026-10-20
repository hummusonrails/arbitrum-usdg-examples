'use client';

import { useState } from 'react';

import { postAction } from '@/lib/api';
import { formatAmount, shortAddress, timeOf } from '@/lib/format';
import { LEDGER_STATUS } from '@/lib/words';

import { Card } from './Card';
import { ExplorerLink } from './ExplorerLink';
import { useSnapshot } from './useSnapshot';

export function LedgerTable() {
    const s = useSnapshot();
    const [note, setNote] = useState<string>();

    if (!s) {
        return <p className="text-sm text-navy-2/70">Connecting to the treasury</p>;
    }

    async function act(action: 'retry' | 'cancel', refId: string) {
        const res = await postAction({ action, refId });

        setNote(res.ok ? undefined : res.message);
    }

    return (
        <Card title="Reconciliation" count={s.ledger.length} tint="sky">
            {note && <p className="px-4 pt-3 text-[13px] text-error">{note}</p>}
            <div className="overflow-x-auto">
                <table className="w-full min-w-[760px] text-left text-[13px]">
                    <thead className="text-[12px] text-navy-2/70">
                        <tr className="border-b border-sky/50">
                            {[
                                'Movement',
                                'Paxos amount',
                                'On Arbitrum',
                                'Transaction',
                                'Status',
                                'Updated',
                            ].map((h) => (
                                <th key={h} className="px-4 py-2.5 font-medium">
                                    {h}
                                </th>
                            ))}
                        </tr>
                    </thead>
                    <tbody>
                        {s.ledger.map((r) => (
                            <tr
                                key={r.id}
                                className="border-b border-sky/40 align-top last:border-b-0"
                            >
                                <td className="px-4 py-3">
                                    {r.source === 'rule'
                                        ? 'Wire inflow'
                                        : r.direction === 'in'
                                          ? 'Mint'
                                          : 'Redeem'}
                                </td>
                                <td className="px-4 py-3 font-mono">
                                    {formatAmount(r.amount)}
                                </td>
                                <td className="px-4 py-3 font-mono">
                                    {r.onchain_amount
                                        ? formatAmount(r.onchain_amount)
                                        : ''}
                                </td>
                                <td className="px-4 py-3 font-mono text-[12px]">
                                    {r.crypto_tx_hash && (
                                        <ExplorerLink
                                            explorer={s.explorer}
                                            path={`tx/${r.crypto_tx_hash}`}
                                            className="hover:text-blue"
                                        >
                                            {shortAddress(r.crypto_tx_hash)}
                                        </ExplorerLink>
                                    )}
                                </td>
                                <td className="px-4 py-3">
                                    <span
                                        className={
                                            r.status === 'matched'
                                                ? 'font-medium'
                                                : r.status === 'pending'
                                                  ? ''
                                                  : 'font-medium text-error'
                                        }
                                    >
                                        {LEDGER_STATUS[r.status] ?? r.status}
                                    </span>
                                    {r.reason && (
                                        <span className="block max-w-xs text-[12px] text-navy-2/80">
                                            {r.reason}
                                        </span>
                                    )}
                                    {r.status === 'stuck' && r.ref_id && (
                                        <span className="mt-2 flex gap-2">
                                            <button
                                                onClick={() => act('retry', r.ref_id!)}
                                                className="rounded-[2px] bg-navy px-2.5 py-1 text-[12px] text-white"
                                            >
                                                Retry
                                            </button>
                                            <button
                                                onClick={() => act('cancel', r.ref_id!)}
                                                className="rounded-[2px] border border-sky px-2.5 py-1 text-[12px]"
                                            >
                                                Cancel
                                            </button>
                                        </span>
                                    )}
                                </td>
                                <td className="px-4 py-3 font-mono text-[11px] text-navy-2/60">
                                    {timeOf(r.updated_at)}
                                </td>
                            </tr>
                        ))}
                    </tbody>
                </table>
            </div>
        </Card>
    );
}
