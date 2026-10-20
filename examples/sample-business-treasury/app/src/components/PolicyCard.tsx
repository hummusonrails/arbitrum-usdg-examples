import { formatAmount } from '@/lib/format';
import type { Snapshot } from '@/lib/types';
import { describeDecision } from '@/lib/words';

import { Card } from './Card';

// Where the wallet sits inside its min, target, and max band.
export function PolicyCard({ snapshot }: { snapshot: Snapshot }) {
    const { min, target, max, paused } = snapshot.policy;
    const span = Number(max) * 1.25 || 1;
    const at = (v: string) => `${Math.min((Number(v) / span) * 100, 100)}%`;

    return (
        <Card title="Policy">
            <div className="space-y-4 p-4">
                <div className="relative h-2 rounded-[1px] bg-sky/30">
                    <div
                        className="absolute inset-y-0 bg-blue/25"
                        style={{
                            left: at(min),
                            width: `calc(${at(max)} - ${at(min)})`,
                        }}
                    />
                    <div
                        className="absolute inset-y-[-3px] w-px bg-navy"
                        style={{ left: at(target) }}
                    />
                    <div
                        className="absolute top-1/2 size-3 -translate-x-1/2 -translate-y-1/2 rounded-full border-2 border-white bg-blue shadow"
                        style={{ left: at(snapshot.balances.walletUsdg) }}
                        aria-label="Wallet balance"
                    />
                </div>
                <dl className="grid grid-cols-3 gap-2 text-[12px]">
                    {[
                        ['Min', min],
                        ['Target', target],
                        ['Max', max],
                    ].map(([label, value]) => (
                        <div key={label}>
                            <dt className="text-navy-2/70">{label}</dt>
                            <dd className="font-mono text-[13px]">
                                {formatAmount(value)}
                            </dd>
                        </div>
                    ))}
                </dl>
                <p className="border-t border-sky/50 pt-3 text-[13px]">
                    {paused ? 'Policy paused' : describeDecision(snapshot.decision)}
                </p>
            </div>
        </Card>
    );
}
