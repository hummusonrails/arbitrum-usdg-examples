import { formatAmount } from '@/lib/format';

export function BigNumber({
    value,
    unit,
    compact = false,
}: {
    value: string;
    unit: string;
    compact?: boolean;
}) {
    const [whole, frac] = formatAmount(value).split('.');

    return (
        <p className="flex items-baseline gap-3 font-mono tracking-tight">
            <span
                className={
                    compact
                        ? 'text-4xl font-medium'
                        : 'text-5xl font-medium md:text-6xl'
                }
            >
                {whole}
                <span className="text-white/55">.{frac}</span>
            </span>
            <span className="text-sm font-semibold text-sky">{unit}</span>
        </p>
    );
}
