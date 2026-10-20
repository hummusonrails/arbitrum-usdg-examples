'use client';

import { forwardRef } from 'react';

import { feedText, formatAmount, timeOf } from '@/lib/format';
import type { Snapshot } from '@/lib/types';

import { BigNumber } from './BigNumber';
import { Sparkline } from './Sparkline';

// The dark screen at the back of the set: the wallet balance and the live
// Paxos event feed, printed a line at a time.
// While a tile is flying the feed holds its typing, so one thing moves at a time.
export const Slate = forwardRef<HTMLDivElement, { snapshot: Snapshot; hold?: boolean }>(
    function Slate({ snapshot, hold = false }, ref) {
        const feed = snapshot.feed.slice(0, 8);

        return (
            <section
                ref={ref}
                className={`slate power-on grid gap-6 p-6 md:grid-cols-[1.1fr_1fr] md:p-8 ${hold ? 'feed-hold' : ''}`}
                style={{ ['--power-delay' as string]: '1100ms' }}
            >
                <div className="flex flex-col justify-between gap-6">
                    <div>
                        <h2 className="text-sm font-semibold text-sky">
                            Arbitrum wallet
                        </h2>
                        <div className="mt-3">
                            <BigNumber
                                value={snapshot.balances.walletUsdg}
                                unit="USDG"
                            />
                        </div>
                        <p className="mt-3 text-[13px] text-white/65">
                            {snapshot.balances.inFlight !== '0'
                                ? `${formatAmount(snapshot.balances.inFlight)} USDG on its way to Paxos`
                                : snapshot.balances.converting !== '0'
                                  ? `${formatAmount(snapshot.balances.converting)} USDG converting to USD for your bank`
                                  : 'Settled on Arbitrum'}
                        </p>
                    </div>
                    <Sparkline
                        points={snapshot.history.map((h) => h.walletUsdg)}
                        className="h-10 w-full"
                    />
                </div>
                <div className="min-w-0 rounded-[2px] border border-white/10 bg-black/15 p-4">
                    <h2 className="mb-3 text-sm font-semibold text-sky">
                        Paxos events
                    </h2>
                    <ol className="space-y-1.5 font-mono text-[12px] leading-5">
                        {feed.length === 0 && (
                            <li className="text-white/50">
                                Waiting for the first event
                            </li>
                        )}
                        {feed.map((line) => (
                            <li
                                key={line.text}
                                className="feed-line text-white/85"
                                style={{
                                    ['--type-steps' as string]: Math.min(
                                        feedText(line.text).length,
                                        60,
                                    ),
                                    ['--type-ms' as string]: `${Math.min(feedText(line.text).length * 42, 1400)}ms`,
                                }}
                            >
                                <span className="mr-2 text-white/40">
                                    {timeOf(line.t)}
                                </span>
                                {feedText(line.text)}
                            </li>
                        ))}
                    </ol>
                </div>
            </section>
        );
    },
);
