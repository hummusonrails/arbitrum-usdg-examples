import { formatAmount } from '@/lib/format';

type Slice = { label: string; value: string; color: string };

// Allocation of the treasury across Paxos and Arbitrum. Values are decimal
// strings and are scaled to arc lengths only for drawing.
export function Donut({ slices, total }: { slices: Slice[]; total: string }) {
    const values = slices.map((s) => Math.max(Number(s.value), 0));
    const sum = values.reduce((a, b) => a + b, 0);
    const r = 42;
    const c = 2 * Math.PI * r;
    let offset = 0;

    return (
        <div className="flex flex-col items-center gap-4 p-4 sm:flex-row xl:flex-col">
            <svg
                viewBox="0 0 120 120"
                className="size-36 flex-none -rotate-90"
                role="img"
                aria-label="Allocation"
            >
                <circle
                    cx="60"
                    cy="60"
                    r={r}
                    fill="none"
                    stroke="#E6F1FA"
                    strokeWidth="14"
                />
                {sum > 0 &&
                    slices.map((s, i) => {
                        const len = (values[i]! / sum) * c;
                        const el = (
                            <circle
                                key={s.label}
                                cx="60"
                                cy="60"
                                r={r}
                                fill="none"
                                stroke={s.color}
                                strokeWidth="14"
                                strokeDasharray={`${Math.max(len - 1.5, 0)} ${c}`}
                                strokeDashoffset={-offset}
                            />
                        );

                        offset += len;

                        return el;
                    })}
            </svg>
            <div className="w-full min-w-0 flex-1 space-y-2">
                <p className="font-mono text-lg font-medium">{formatAmount(total)}</p>
                <ul className="space-y-1.5 text-[13px]">
                    {slices.map((s) => (
                        <li
                            key={s.label}
                            className="flex items-center justify-between gap-3"
                        >
                            <span className="flex items-center gap-2">
                                <span
                                    className="size-2.5 rounded-[1px]"
                                    style={{ background: s.color }}
                                />
                                {s.label}
                            </span>
                            <span className="font-mono text-navy-2">
                                {formatAmount(s.value)}
                            </span>
                        </li>
                    ))}
                </ul>
            </div>
        </div>
    );
}
