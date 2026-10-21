'use client';

import { Compass, LayoutPanelLeft, ServerCog } from 'lucide-react';
import Link from 'next/link';
import { usePathname } from 'next/navigation';

const NAV = [
    { href: '/', label: 'Earn', icon: LayoutPanelLeft },
    { href: '/console', label: 'Operator console', icon: ServerCog },
    {
        href: '/building-with-usdg',
        label: 'Building with USDG on Arbitrum',
        icon: Compass,
    },
];

// Acme Money's mark: a navy tile with a rising bar chart, drawn inline.
export function AcmeMark({ size = 40 }: { size?: number }) {
    return (
        <svg width={size} height={size} viewBox="0 0 40 40" aria-hidden>
            <rect width="40" height="40" rx="2" fill="#213147" />
            <rect x="9" y="22" width="5" height="9" fill="#9DCCED" />
            <rect x="17.5" y="16" width="5" height="15" fill="#9DCCED" />
            <rect x="26" y="9" width="5" height="22" fill="#12AAFF" />
        </svg>
    );
}

export function Sidebar() {
    const path = usePathname();

    return (
        <aside className="flex shrink-0 flex-col border-sky/60 bg-white/70 backdrop-blur md:sticky md:top-0 md:h-dvh md:w-60 md:border-r">
            <div className="flex items-center gap-2.5 px-4 py-5">
                {/* Acme Money is the fictional fintech this sample app belongs to. */}
                <AcmeMark />
                <span className="text-[16px] font-semibold tracking-tight whitespace-nowrap">
                    Acme Money
                </span>
            </div>
            <div className="mx-5 h-0.5 bg-navy" />
            <nav className="flex flex-wrap gap-1 px-3 py-3 md:flex-col md:flex-nowrap md:py-4">
                {NAV.map(({ href, label, icon: Icon }) => {
                    const active = path === href;

                    return (
                        <Link
                            key={href}
                            href={href}
                            className={`flex items-center gap-3 rounded-[2px] px-3 py-2.5 text-left text-sm whitespace-nowrap transition-colors md:whitespace-normal ${
                                active
                                    ? 'bg-sky/30 font-semibold text-navy'
                                    : 'text-navy-2/80 hover:bg-sky/15'
                            }`}
                            aria-current={active ? 'page' : undefined}
                        >
                            <Icon className="size-4 flex-none" strokeWidth={1.75} />
                            {label}
                        </Link>
                    );
                })}
            </nav>
        </aside>
    );
}
