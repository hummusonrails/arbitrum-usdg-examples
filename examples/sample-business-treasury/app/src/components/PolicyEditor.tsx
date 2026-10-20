'use client';

import { useEffect, useState, type FormEvent } from 'react';

import { postAction } from '@/lib/api';

import { Card } from './Card';
import { PolicyCard } from './PolicyCard';
import { useSnapshot } from './useSnapshot';

export function PolicyEditor() {
    const s = useSnapshot();
    const [band, setBand] = useState({ min: '', target: '', max: '' });
    const [note, setNote] = useState<{ ok: boolean; text: string }>();

    useEffect(() => {
        if (s && !band.min) {
            setBand({ min: s.policy.min, target: s.policy.target, max: s.policy.max });
        }
    }, [s, band.min]);

    if (!s) {
        return <p className="text-sm text-navy-2/70">Connecting to the treasury</p>;
    }

    async function save(e: FormEvent) {
        e.preventDefault();

        const res = await postAction({ action: 'setPolicy', ...band });

        setNote({
            ok: res.ok,
            text: res.ok ? 'Saved' : (res.message ?? 'Could not save'),
        });
    }

    return (
        <div className="grid gap-6 lg:grid-cols-[minmax(0,1fr)_320px]">
            <Card title="Treasury band">
                <form onSubmit={save} className="space-y-5 p-5">
                    <p className="max-w-prose text-[13px] text-navy-2">
                        The app keeps the Arbitrum wallet between min and max. Below min
                        it mints back to target; above max it redeems the excess to the
                        bank.
                    </p>
                    <div className="grid gap-4 sm:grid-cols-3">
                        {(['min', 'target', 'max'] as const).map((k) => (
                            <label key={k} className="block text-sm">
                                <span className="mb-1.5 block capitalize">
                                    {k} (USDG)
                                </span>
                                <input
                                    inputMode="decimal"
                                    value={band[k]}
                                    onChange={(e) =>
                                        setBand({ ...band, [k]: e.target.value.trim() })
                                    }
                                    className="w-full rounded-[2px] border border-sky bg-white px-3 py-2 font-mono text-sm outline-none focus:border-blue focus:ring-2 focus:ring-blue/20"
                                />
                            </label>
                        ))}
                    </div>
                    <div className="flex flex-wrap items-center gap-3">
                        <button className="rounded-[2px] bg-navy px-4 py-2.5 text-sm font-medium text-white hover:bg-navy-2">
                            Save band
                        </button>
                        <button
                            type="button"
                            onClick={() =>
                                postAction({
                                    action: 'pausePolicy',
                                    paused: !s.policy.paused,
                                })
                            }
                            className="rounded-[2px] border border-sky bg-white px-4 py-2.5 text-sm font-medium hover:bg-sky/20"
                        >
                            {s.policy.paused ? 'Resume policy' : 'Pause policy'}
                        </button>
                        {note && (
                            <p
                                role="status"
                                className={`text-[13px] ${note.ok ? 'text-navy-2' : 'text-error'}`}
                            >
                                {note.text}
                            </p>
                        )}
                    </div>
                </form>
            </Card>
            <PolicyCard snapshot={s} />
        </div>
    );
}
