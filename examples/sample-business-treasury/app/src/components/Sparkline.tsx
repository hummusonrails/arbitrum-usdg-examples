// A small line of wallet balance over time. Values are decimal strings; the
// chart only needs relative heights, so they are scaled as numbers here.
export function Sparkline({
    points,
    className = '',
}: {
    points: string[];
    className?: string;
}) {
    const values = points.map(Number);

    if (values.length < 2) {
        return <svg className={className} viewBox="0 0 100 24" aria-hidden />;
    }

    const min = Math.min(...values);
    const max = Math.max(...values);
    const span = max - min || 1;
    const d = values
        .map((v, i) => {
            const x = (i / (values.length - 1)) * 100;
            const y = 22 - ((v - min) / span) * 20;

            return `${i === 0 ? 'M' : 'L'}${x.toFixed(2)},${y.toFixed(2)}`;
        })
        .join(' ');

    return (
        <svg
            className={className}
            viewBox="0 0 100 24"
            preserveAspectRatio="none"
            aria-hidden
        >
            <defs>
                <linearGradient id="spark" x1="0" x2="1">
                    <stop offset="0%" stopColor="#9DCCED" />
                    <stop offset="100%" stopColor="#12AAFF" />
                </linearGradient>
            </defs>
            <path
                d={d}
                fill="none"
                stroke="url(#spark)"
                strokeWidth="1.5"
                vectorEffect="non-scaling-stroke"
            />
        </svg>
    );
}
