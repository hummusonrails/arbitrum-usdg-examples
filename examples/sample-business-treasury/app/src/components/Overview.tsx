'use client';

import { fromUnits, toUnits } from '@arbitrum-usdg/usdg';
import { useState, useRef } from 'react';

import { Card } from './Card';
import { Donut } from './Donut';
import { HealthCard } from './HealthCard';
import { PolicyCard } from './PolicyCard';
import { Slate } from './Slate';
import { TileBoard } from './TileBoard';
import { useSnapshot } from './useSnapshot';

export function Overview({ actions }: { actions?: React.ReactNode }) {
    const snapshot = useSnapshot();
    const slateRef = useRef<HTMLDivElement>(null);
    const [flying, setFlying] = useState(false);

    if (!snapshot) {
        return <p className="text-sm text-navy-2/70">Connecting to the treasury</p>;
    }

    const b = snapshot.balances;
    const slices = [
        { label: 'Paxos USD', value: b.paxosUsd, color: '#213147' },
        { label: 'Paxos USDG', value: b.paxosUsdg, color: '#9DCCED' },
        { label: 'Arbitrum USDG', value: b.walletUsdg, color: '#12AAFF' },
        { label: 'In flight', value: b.inFlight, color: '#D3E8F6' },
    ];
    const total = fromUnits(
        slices.reduce(
            (sum, s) => sum + toUnits(s.value.includes('.') ? trim(s.value) : s.value),
            0n,
        ),
    );

    return (
        <div className="grid gap-6 xl:grid-cols-[minmax(0,1fr)_320px]">
            <div className="min-w-0 space-y-6">
                <Slate ref={slateRef} snapshot={snapshot} hold={flying} />
                {actions}
                <TileBoard
                    snapshot={snapshot}
                    slateRef={slateRef}
                    onFlight={setFlying}
                />
            </div>
            <div className="space-y-6">
                <Card title="Allocation" className="power-on">
                    <Donut slices={slices} total={total} />
                </Card>
                <PolicyCard snapshot={snapshot} />
                <HealthCard snapshot={snapshot} />
            </div>
        </div>
    );
}

// Paxos balances can carry more decimals than USDG; drawing only needs six.
function trim(value: string): string {
    const [whole, frac = ''] = value.split('.');

    return `${whole}.${frac.slice(0, 6) || '0'}`;
}
