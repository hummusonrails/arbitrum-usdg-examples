'use client';

import { feedText, formatAmount, timeOf } from '@/lib/format';
import { describeStep } from '@/lib/words';

import { ActionBar } from './ActionBar';
import { Card } from './Card';
import { Lamp } from './Lamp';
import { useSnapshot } from './useSnapshot';

export function ActivityView() {
    const s = useSnapshot();

    if (!s) {
        return <p className="text-sm text-navy-2/70">Connecting to the treasury</p>;
    }

    return (
        <div className="space-y-6">
            <ActionBar mode={s.mode} />
            <div className="grid gap-6 xl:grid-cols-[minmax(0,1fr)_420px]">
                <Card title="Treasury actions" count={s.actions.length} tint="sky">
                    <ul>
                        {s.actions.length === 0 && (
                            <li className="px-4 py-6 text-[13px] text-navy-2/60">
                                No mints or redeems yet
                            </li>
                        )}
                        {s.actions.map((a) => (
                            <li
                                key={a.ref_id}
                                className="flex items-start gap-3 border-b border-sky/40 px-4 py-3 last:border-b-0"
                            >
                                <span className="mt-1.5">
                                    <Lamp
                                        on={a.status === 'completed'}
                                        alert={
                                            a.status === 'stuck' ||
                                            a.status === 'failed'
                                        }
                                    />
                                </span>
                                <span className="min-w-0 flex-1">
                                    <span className="flex flex-wrap items-baseline justify-between gap-2">
                                        <span className="text-sm font-semibold">
                                            {a.kind === 'mint' ? 'Mint' : 'Redeem'}{' '}
                                            <span className="font-mono font-normal">
                                                {formatAmount(a.amount)} USDG
                                            </span>
                                        </span>
                                        <span className="font-mono text-[11px] text-navy-2/60">
                                            {timeOf(a.updated_at)}
                                        </span>
                                    </span>
                                    <span className="block text-[13px] text-navy-2">
                                        {describeStep(a.kind, a.step, a.status)}
                                    </span>
                                    {a.error && (
                                        <span className="block text-[12px] text-error">
                                            {a.error}
                                        </span>
                                    )}
                                </span>
                            </li>
                        ))}
                    </ul>
                </Card>
                <section className="slate p-5">
                    <h2 className="mb-3 text-sm font-semibold text-sky">
                        Paxos events
                    </h2>
                    <ol className="space-y-1.5 font-mono text-[12px] leading-5">
                        {s.feed.map((l) => (
                            <li key={l.text} className="truncate text-white/85">
                                <span className="mr-2 text-white/40">
                                    {timeOf(l.t)}
                                </span>
                                {feedText(l.text)}
                            </li>
                        ))}
                    </ol>
                </section>
            </div>
        </div>
    );
}
