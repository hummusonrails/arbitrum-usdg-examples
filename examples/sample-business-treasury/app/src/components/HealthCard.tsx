import type { Snapshot } from '@/lib/types';

import { Card } from './Card';
import { Lamp } from './Lamp';

export function HealthCard({ snapshot }: { snapshot: Snapshot }) {
    const h = snapshot.health;
    const lamps = [
        { label: 'Paxos connected', on: h.paxos, alert: !h.paxos },
        { label: 'Arbitrum connected', on: h.chain, alert: !h.chain },
        {
            label: h.frozen ? 'Wallet frozen by the issuer' : 'Wallet can send USDG',
            on: !h.frozen,
            alert: h.frozen,
        },
        {
            label: h.paused ? 'USDG transfers paused' : 'USDG transfers active',
            on: !h.paused,
            alert: h.paused,
        },
        {
            label: h.gasOk ? 'ETH for gas' : 'Add ETH for gas',
            on: h.gasOk,
            alert: !h.gasOk,
        },
    ];

    return (
        <Card title="Health">
            <ul className="space-y-2.5 p-4 text-[13px]">
                {lamps.map((l, i) => (
                    <li key={l.label} className="flex items-center gap-3">
                        <Lamp on={l.on} alert={l.alert} delay={i * 250} />
                        {l.label}
                    </li>
                ))}
            </ul>
        </Card>
    );
}
