import {
    CONTACT,
    DISCLAIMER,
    INTRO,
    PATHS,
    segments,
    STEPS,
    STRENGTHS,
    TITLE,
    USDG_PAGE,
    type PathKey,
    type StrengthKey,
} from '@arbitrum-usdg/guide';
import {
    ArrowUpRight,
    Coins,
    Globe,
    Landmark,
    Layers,
    LineChart,
    PenLine,
    Rocket,
    ShieldCheck,
    Sparkles,
    Zap,
} from 'lucide-react';
import Link from 'next/link';
import type { ComponentType, ReactNode } from 'react';

import { Card } from './Card';

type Icon = ComponentType<{ className?: string; strokeWidth?: number }>;

const PATH_ICONS: Record<PathKey, Icon> = {
    earn: Sparkles,
    trading: LineChart,
    markets: Layers,
    treasury: Landmark,
};

const STRENGTH_ICONS: Record<StrengthKey, Icon> = {
    native: Coins,
    programmable: PenLine,
    rewards: ShieldCheck,
    chains: Globe,
    defi: Rocket,
    automation: Zap,
};

// This sample demonstrates the embedded earn path.
const DEMONSTRATES: PathKey = 'earn';

const linkClass =
    'inline-flex items-center gap-1 font-medium text-blue hover:underline';

// Renders guide text, turning [text](url) into links.
function Rich({ text }: { text: string }) {
    return (
        <>
            {segments(text).map((s, i) =>
                s.href ? (
                    <a
                        key={i}
                        href={s.href}
                        target="_blank"
                        rel="noreferrer"
                        className={linkClass}
                    >
                        {s.text}
                        <ArrowUpRight
                            className="size-3.5"
                            strokeWidth={2}
                            aria-hidden
                        />
                    </a>
                ) : (
                    <span key={i}>{s.text}</span>
                ),
            )}
        </>
    );
}

const FIRST_STEP: { title: string; body: ReactNode } = {
    title: 'Explore this sample',
    body: (
        <>
            Fund a demo customer, pick a vault, and deposit from the{' '}
            <Link href="/" className="font-medium text-blue hover:underline">
                Earn
            </Link>{' '}
            view. The operator console shows every onchain step and how the books
            reconcile.
        </>
    ),
};

export function BuildingView() {
    const steps = [
        FIRST_STEP,
        ...STEPS.map((s) => ({ title: s.title, body: <Rich text={s.body} /> })),
    ];

    return (
        <div className="space-y-8">
            <section className="slate power-on p-6 md:p-10">
                <h1 className="max-w-3xl text-3xl font-semibold tracking-tight md:text-4xl">
                    {TITLE}
                </h1>
                <p className="mt-4 max-w-2xl text-[15px] leading-7 text-white/80">
                    {INTRO}
                </p>
                <div className="mt-7 flex flex-wrap gap-3">
                    <a
                        href={CONTACT}
                        target="_blank"
                        rel="noreferrer"
                        className="inline-flex items-center gap-2 rounded-[2px] bg-blue px-4 py-2.5 text-sm font-medium text-white hover:bg-blue/90"
                    >
                        Integrate USDG <ArrowUpRight className="size-4" aria-hidden />
                    </a>
                    <a
                        href={USDG_PAGE}
                        target="_blank"
                        rel="noreferrer"
                        className="inline-flex items-center gap-2 rounded-[2px] border border-white/25 px-4 py-2.5 text-sm font-medium text-white hover:bg-white/10"
                    >
                        USDG on Arbitrum <ArrowUpRight className="size-4" aria-hidden />
                    </a>
                </div>
            </section>

            <section className="space-y-4">
                <h2 className="text-xl font-semibold tracking-tight">
                    Ways to build with USDG
                </h2>
                <div className="grid gap-4 md:grid-cols-2">
                    {PATHS.map(({ key, title, body }) => {
                        const Icon = PATH_ICONS[key];

                        return (
                            <Card key={key} className="power-on">
                                <div className="flex gap-4 p-5">
                                    <Icon
                                        className="mt-0.5 size-5 flex-none text-blue"
                                        strokeWidth={1.75}
                                    />
                                    <div>
                                        <h3 className="text-[15px] font-semibold">
                                            {title}
                                        </h3>
                                        <p className="mt-1.5 text-[14px] leading-6 text-navy-2">
                                            {body}
                                        </p>
                                        {key === DEMONSTRATES && (
                                            <Link
                                                href="/"
                                                className="mt-3 inline-block text-[13px] font-medium text-blue hover:underline"
                                            >
                                                This sample app shows this path end to
                                                end
                                            </Link>
                                        )}
                                    </div>
                                </div>
                            </Card>
                        );
                    })}
                </div>
            </section>

            <section className="space-y-4">
                <h2 className="text-xl font-semibold tracking-tight">
                    Why Arbitrum is a great home for USDG
                </h2>
                <div className="grid gap-4 md:grid-cols-2 xl:grid-cols-3">
                    {STRENGTHS.map(({ key, title, body }) => {
                        const Icon = STRENGTH_ICONS[key];

                        return (
                            <Card key={key} className="power-on">
                                <div className="p-5">
                                    <Icon
                                        className="size-5 text-blue"
                                        strokeWidth={1.75}
                                    />
                                    <h3 className="mt-3 text-[15px] font-semibold">
                                        {title}
                                    </h3>
                                    <p className="mt-1.5 text-[14px] leading-6 text-navy-2">
                                        <Rich text={body} />
                                    </p>
                                </div>
                            </Card>
                        );
                    })}
                </div>
            </section>

            <section className="space-y-4">
                <h2 className="text-xl font-semibold tracking-tight">Start building</h2>
                <Card>
                    <ol className="divide-y divide-sky/40">
                        {steps.map(({ title, body }, i) => (
                            <li key={title} className="flex gap-4 p-5">
                                <span className="grid size-7 flex-none place-items-center rounded-full bg-navy font-mono text-[12px] text-white">
                                    {i + 1}
                                </span>
                                <div>
                                    <h3 className="text-[15px] font-semibold">
                                        {title}
                                    </h3>
                                    <p className="mt-1 text-[14px] leading-6 text-navy-2">
                                        {body}
                                    </p>
                                </div>
                            </li>
                        ))}
                    </ol>
                </Card>
            </section>

            <p className="max-w-3xl text-[12px] leading-5 text-navy-2/75">
                {DISCLAIMER} Acme Money is a fictional company and this app is a
                demonstration.
            </p>
        </div>
    );
}
