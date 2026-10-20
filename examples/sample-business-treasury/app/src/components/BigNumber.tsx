import { formatAmount } from '@/lib/format';

export function BigNumber({ value, unit }: { value: string; unit: string }) {
    const [whole, frac] = formatAmount(value).split('.');

    return (
        <p className="flex items-baseline gap-3 font-mono tracking-tight">
            <span className="text-5xl font-medium md:text-6xl">
                {whole}
                <span className="text-white/55">.{frac}</span>
            </span>
            <span className="text-sm font-semibold text-sky">{unit}</span>
        </p>
    );
}
