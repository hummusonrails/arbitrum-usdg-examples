'use client';

import {
    ArrowLeftRight,
    LayoutGrid,
    ListChecks,
    SlidersHorizontal,
} from 'lucide-react';
import Image from 'next/image';
import Link from 'next/link';
import { usePathname } from 'next/navigation';

const NAV = [
    { href: '/', label: 'Overview', icon: LayoutGrid },
    { href: '/activity', label: 'Activity', icon: ArrowLeftRight },
    { href: '/reconciliation', label: 'Reconciliation', icon: ListChecks },
    { href: '/settings', label: 'Settings', icon: SlidersHorizontal },
];

export function Sidebar() {
    const path = usePathname();

    return (
        <aside className="flex shrink-0 flex-col border-sky/60 bg-white/70 backdrop-blur md:sticky md:top-0 md:h-dvh md:w-60 md:border-r">
            <div className="flex items-center gap-2.5 px-4 py-5">
                {/* Acme Co. is the fictional business this sample app belongs to. */}
                <Image
                    src="/acme-logomark.png"
                    alt=""
                    width={44}
                    height={44}
                    unoptimized
                    priority
                />
                <span className="text-[16px] font-semibold tracking-tight whitespace-nowrap">
                    Acme Co. Treasury
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
                            className={`flex items-center gap-3 rounded-[2px] px-3 py-2.5 text-sm whitespace-nowrap transition-colors ${
                                active
                                    ? 'bg-sky/30 font-semibold text-navy'
                                    : 'text-navy-2/80 hover:bg-sky/15'
                            }`}
                            aria-current={active ? 'page' : undefined}
                        >
                            <Icon className="size-4" strokeWidth={1.75} />
                            {label}
                        </Link>
                    );
                })}
            </nav>
        </aside>
    );
}
