import type { ReactNode } from 'react';

export function Card({
    title,
    count,
    tint,
    children,
    className = '',
}: {
    title?: string;
    count?: number;
    tint?: 'sky' | 'blue' | 'navy';
    children: ReactNode;
    className?: string;
}) {
    const header = {
        sky: 'bg-sky/25 border-b-sky',
        blue: 'bg-blue/12 border-b-blue',
        navy: 'bg-navy-2/8 border-b-navy-2',
    }[tint ?? 'sky'];

    return (
        <section className={`tile ${className}`}>
            {title && (
                <header
                    className={`relative flex items-center justify-between border-b-2 px-4 py-3 ${tint ? header : 'border-b-transparent'}`}
                >
                    <h2 className="text-[15px] font-semibold">{title}</h2>
                    {count !== undefined && (
                        <span className="font-mono text-xs text-navy-2/70">
                            {count}
                        </span>
                    )}
                </header>
            )}
            <div className="relative">{children}</div>
        </section>
    );
}
