import type { ReactNode } from 'react';

// Links to the block explorer when there is one. In mock mode transactions
// only exist on the local fork, so the value shows as plain text.
export function ExplorerLink({
    explorer,
    path,
    className,
    children,
}: {
    explorer: string | null;
    path: string;
    className?: string;
    children: ReactNode;
}) {
    if (!explorer) {
        return <span className={className}>{children}</span>;
    }

    return (
        <a
            href={`${explorer}/${path}`}
            target="_blank"
            rel="noreferrer"
            className={className}
        >
            {children}
        </a>
    );
}
