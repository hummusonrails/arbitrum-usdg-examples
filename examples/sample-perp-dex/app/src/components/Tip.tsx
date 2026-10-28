'use client';

import {
    useEffect,
    useId,
    useLayoutEffect,
    useRef,
    useState,
    type ReactElement,
    type ReactNode,
} from 'react';

import type { Guide } from '@/lib/guides';

export function GuideCard({ guide, footer }: { guide: Guide; footer?: ReactNode }) {
    return (
        <div className="w-80 max-w-[calc(100vw-2rem)] text-left">
            <p className="text-[14px] font-semibold text-white">{guide.title}</p>
            <p className="mt-1.5 text-[13px] leading-5 text-white/85">{guide.body}</p>
            <ul className="mt-3 space-y-1 rounded-[2px] border border-white/10 bg-black/20 px-3 py-2 font-mono text-[11px] leading-4 text-sky">
                {guide.calls.map((c) => (
                    <li key={c}>{c}</li>
                ))}
            </ul>
            <p className="mt-3 text-[12px] leading-5 text-white/70">{guide.watch}</p>
            {footer}
        </div>
    );
}

// A tip shown on hover or keyboard focus, anchored under its trigger.
export function Tip({
    guide,
    open: forced,
    footer,
    block = false,
    children,
}: {
    guide: Guide;
    open?: boolean;
    footer?: ReactNode;
    // Block tips wrap a full width element, such as a card.
    block?: boolean;
    children: (props: { 'aria-describedby': string }) => ReactElement;
}) {
    const id = useId();
    const [hover, setHover] = useState(false);
    const open = forced ?? hover;
    const tipRef = useRef<HTMLDivElement>(null);
    const [shift, setShift] = useState(0);

    // Keep the tip inside the viewport on narrow screens.
    useLayoutEffect(() => {
        if (!open || !tipRef.current) {
            setShift(0);

            return;
        }

        const r = tipRef.current.getBoundingClientRect();
        const overflow = r.right + 16 - window.innerWidth;

        setShift(overflow > 0 ? -Math.min(overflow, r.left - 16) : 0);
    }, [open]);

    // A tour step brings its whole tip into view, including its buttons.
    useEffect(() => {
        if (forced) {
            tipRef.current?.scrollIntoView({ block: 'nearest', behavior: 'smooth' });
        }
    }, [forced]);

    return (
        <div
            className={block ? 'relative block' : 'relative inline-flex'}
            onMouseEnter={() => setHover(true)}
            onMouseLeave={() => setHover(false)}
            onFocus={() => setHover(true)}
            onBlur={() => setHover(false)}
        >
            {children({ 'aria-describedby': id })}
            {open && (
                <div
                    ref={tipRef}
                    id={id}
                    role="tooltip"
                    className="slate absolute top-full left-0 z-40 mt-3 p-4"
                    style={{
                        translate: `${shift}px 0`,
                        animation: 'tip-in 200ms var(--ease-enter) both',
                    }}
                >
                    <span
                        className="absolute -top-1.5 size-3 rotate-45 border-t border-l border-[#2d364d] bg-[#213147]"
                        style={{ left: 24 - shift }}
                        aria-hidden
                    />
                    <GuideCard guide={guide} footer={footer} />
                </div>
            )}
        </div>
    );
}
