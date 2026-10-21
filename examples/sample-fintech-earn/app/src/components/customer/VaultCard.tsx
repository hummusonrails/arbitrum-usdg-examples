import { ChevronRight } from 'lucide-react';

import { percent, shortDate, usd } from '@/lib/copy';
import { formatAmount } from '@/lib/format';
import type { VaultView } from '@/lib/types';

// The total rate is always shown with its parts: the vault's own variable rate,
// and the boost with its token and end date.
export function totalRate(v: VaultView): number | null {
    if (v.vaultApy == null) {
        return v.boost?.apr ?? null;
    }

    return v.vaultApy + (v.boost?.apr ?? 0);
}

export function RateLines({ vault }: { vault: VaultView }) {
    return (
        <dl className="space-y-1 text-[12.5px] text-navy-2">
            <div className="flex justify-between gap-3">
                <dt>Vault rate, variable</dt>
                <dd className="font-mono">{percent(vault.vaultApy)}</dd>
            </div>
            <div className="flex justify-between gap-3">
                <dt>
                    {vault.boost
                        ? `${vault.boost.token} boost until ${shortDate(vault.boost.endsAt)}`
                        : 'No boost right now'}
                </dt>
                <dd className="font-mono">
                    {vault.boost ? percent(vault.boost.apr) : 'None'}
                </dd>
            </div>
        </dl>
    );
}

export function ProtocolMark({ vault }: { vault: VaultView }) {
    return (
        <span className="text-[11.5px] font-medium text-navy-2/80">
            {vault.protocol === 'Morpho' ? 'Powered by Morpho' : 'Powered by GMX'}
        </span>
    );
}

export function VaultCard({ vault, onOpen }: { vault: VaultView; onOpen: () => void }) {
    return (
        <button
            type="button"
            onClick={onOpen}
            className="tile block w-full p-4 text-left transition-transform hover:-translate-y-0.5"
        >
            <div className="flex items-start justify-between gap-3">
                <div>
                    {vault.isDefault && (
                        <p className="mb-1 text-[11.5px] font-semibold text-blue">
                            Suggested
                        </p>
                    )}
                    <h3 className="text-[15px] font-semibold">{vault.name}</h3>
                    <p className="text-[12px] text-navy-2/80">
                        Curated by {vault.curator}
                    </p>
                </div>
                <div className="text-right">
                    <p className="font-mono text-xl font-medium">
                        {percent(totalRate(vault))}
                    </p>
                    <p className="text-[11px] text-navy-2/70">total, variable</p>
                </div>
            </div>
            <div className="mt-3">
                <RateLines vault={vault} />
            </div>
            <div className="mt-3 flex items-center justify-between border-t border-sky/50 pt-2.5 text-[11.5px] text-navy-2/80">
                <span>
                    TVL {usd(vault.tvl)}
                    {vault.instantLiquidity !== null &&
                        ` · ${formatAmount(vault.instantLiquidity.split('.')[0])} USDG withdrawable now`}
                </span>
                <ChevronRight className="size-4" aria-hidden />
            </div>
            <div className="mt-1.5">
                <ProtocolMark vault={vault} />
            </div>
        </button>
    );
}
