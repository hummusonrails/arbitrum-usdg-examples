'use client';

import { useSyncExternalStore } from 'react';

import type { Snapshot } from '@/lib/types';

// One server sent events connection per page, shared by every component.
let current: Snapshot | undefined;
let source: EventSource | undefined;
const listeners = new Set<() => void>();

function publish(s: Snapshot) {
    current = s;
    listeners.forEach((fn) => fn());
}

function subscribe(fn: () => void): () => void {
    listeners.add(fn);

    if (!source) {
        fetch('/api/state?once=1')
            .then((r) => r.json())
            .then((s: Snapshot) => current ?? publish(s))
            .catch(() => {});
        source = new EventSource('/api/state');
        source.onmessage = (e) => publish(JSON.parse(e.data) as Snapshot);
    }

    return () => {
        listeners.delete(fn);

        if (listeners.size === 0) {
            source?.close();
            source = undefined;
        }
    };
}

export function useSnapshot(): Snapshot | undefined {
    return useSyncExternalStore(
        subscribe,
        () => current,
        () => undefined,
    );
}
