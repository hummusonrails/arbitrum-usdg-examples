'use client';

import { Check, Loader2 } from 'lucide-react';
import type { MouseEvent, ReactNode } from 'react';

import {
    ADVANCE_STAND_IN,
    MARKET_STAND_IN,
    REGISTRAR_STAND_IN,
    REWARDS_NOTE,
    VAULT_NOTE,
} from '@/lib/copy';
import { formatAmount, shortAddress } from '@/lib/format';
import type { CheckView, Snapshot } from '@/lib/types';

import { BigNumber } from '../BigNumber';
import { Card } from '../Card';
import { Lamp } from '../Lamp';
import { TourTip } from '../Tour';
import { usd } from '../trader/TradeScreen';
import { useAction } from '../useAction';
import { useSnapshot } from '../useSnapshot';

// What the Acme Perps team watches: the operator and keeper, the markets, where
// every USDG in the vault sits, the rewards registration and routing, and the
// books against the chain.
export function Console() {
    const s = useSnapshot();

    if (!s) {
        return (
            <p className="flex items-center gap-2 text-sm text-navy-2">
                <Loader2 className="size-4 animate-spin" /> Connecting to the fork
            </p>
        );
    }

    return (
        <div className="space-y-5">
            {s.error && <p className="tile px-4 py-3 text-[13px]">{s.error}</p>}
            <Slate s={s} />
            <Vault s={s} />
            <Registration s={s} />
            <Rewards s={s} />
            <Markets s={s} />
            <div className="grid gap-5 2xl:grid-cols-2">
                <Traders s={s} />
                <Books s={s} />
            </div>
        </div>
    );
}

function time(at: number) {
    return new Date(at).toLocaleTimeString([], {
        hour: '2-digit',
        minute: '2-digit',
        second: '2-digit',
    });
}

function Slate({ s }: { s: Snapshot }) {
    const feed = s.activity.slice(0, 8);

    return (
        <section className="slate power-on grid gap-6 p-6 lg:grid-cols-[1fr_1.4fr]">
            <div className="space-y-4">
                <div>
                    <h2 className="text-sm font-semibold text-sky">Operator wallet</h2>
                    <div className="mt-2">
                        <BigNumber value={s.operator.usdg} unit="USDG" compact />
                    </div>
                </div>
                <dl className="grid grid-cols-2 gap-3 text-[12px]">
                    <div>
                        <dt className="text-white/65">Keeper ETH for gas</dt>
                        <dd className="font-mono text-white">
                            {Number(s.keeper.eth).toFixed(4)}
                        </dd>
                    </div>
                    <div>
                        <dt className="text-white/65">Fork time</dt>
                        <dd className="font-mono text-white">
                            {new Date(s.forkTime).toLocaleDateString('en-US', {
                                month: 'short',
                                day: 'numeric',
                            })}
                        </dd>
                    </div>
                </dl>
                <p className="text-[12px] leading-5 text-white/70">
                    The operator owns the vault and is the payout group&rsquo;s claimer,
                    manager, and destination. The keeper pushes prices, liquidates, and
                    relays signed deposits.
                </p>
            </div>
            <div className="min-w-0 rounded-[2px] border border-white/10 bg-black/15 p-4">
                <h2 className="mb-3 text-sm font-semibold text-sky">Onchain actions</h2>
                <ol className="space-y-1.5 font-mono text-[12px] leading-5">
                    {feed.length === 0 && (
                        <li className="text-white/50">Waiting for the first action</li>
                    )}
                    {feed.map((line) => (
                        <li
                            key={`${line.at}${line.text}`}
                            className="feed-wrap text-white/85"
                        >
                            <span className="mr-2 text-white/40">{time(line.at)}</span>
                            {line.text}
                        </li>
                    ))}
                </ol>
            </div>
        </section>
    );
}

// Where every USDG in the vault sits. Positions are bookkeeping, so posted
// collateral never leaves, and the whole balance is what USDG rewards accrue on.
function Vault({ s }: { s: Snapshot }) {
    const v = s.vault;
    const parts = [
        { label: 'Free margin', value: v.freeMargin, color: 'bg-blue' },
        { label: 'Position collateral', value: v.collateral, color: 'bg-navy' },
        { label: 'House liquidity', value: v.liquidity, color: 'bg-sky' },
        {
            label: 'Rewards held for traders',
            value: v.rewardsHeld,
            color: 'bg-navy-2/40',
        },
    ];
    const total = Number(v.usdgBalance) || 1;

    return (
        <section id="vault-card">
            <Card title="Margin vault" tint="sky">
                <div className="space-y-4 p-4">
                    <div className="flex flex-wrap items-baseline justify-between gap-2">
                        <p className="font-mono text-2xl font-medium">
                            {formatAmount(v.usdgBalance)}{' '}
                            <span className="text-sm font-semibold text-blue">
                                USDG
                            </span>
                        </p>
                        <p className="font-mono text-[12px] text-navy-2/75">
                            vault {shortAddress(v.address)} · oracle{' '}
                            {shortAddress(v.oracle)}
                        </p>
                    </div>
                    <div
                        className="flex h-3 overflow-hidden rounded-[2px] bg-sky/20"
                        aria-hidden
                    >
                        {parts.map((p) => (
                            <span
                                key={p.label}
                                className={p.color}
                                style={{ width: `${(Number(p.value) / total) * 100}%` }}
                            />
                        ))}
                    </div>
                    <dl className="grid grid-cols-2 gap-3 text-[12px] md:grid-cols-4">
                        {parts.map((p) => (
                            <div key={p.label}>
                                <dt className="flex items-center gap-1.5 text-navy-2/80">
                                    <span
                                        className={`size-2 rounded-[1px] ${p.color}`}
                                    />
                                    {p.label}
                                </dt>
                                <dd className="font-mono text-[13px]">
                                    {formatAmount(p.value)}
                                </dd>
                            </div>
                        ))}
                    </dl>
                    <p className="text-[12px] text-navy-2/75">
                        The house has reserved {formatAmount(v.reserved)} USDG to pay
                        the largest possible profit on every open position.
                    </p>
                </div>
                <p className="border-t border-sky/40 px-4 py-2.5 text-[12px] text-navy-2/75">
                    Every USDG of margin, collateral, and house liquidity sits in this
                    one contract, which is why the vault itself can register for USDG
                    rewards. {VAULT_NOTE}
                </p>
            </Card>
        </section>
    );
}

const STATUS_TEXT = {
    unregistered: 'Not registered',
    proposed: 'Proposed, waiting for the vault to accept',
    registered: 'Registered',
} as const;

function Registration({ s }: { s: Snapshot }) {
    const { busy, message, run } = useAction();
    const { status } = s.registration;
    const act = (action: 'propose' | 'accept' | 'cancel') => run(action, { action });

    return (
        <TourTip step="register" block>
            {(aria) => (
                <div {...aria}>
                    <Card title="USDG rewards registration" tint="blue">
                        <div className="space-y-3 px-4 py-4">
                            <div className="flex items-center justify-between">
                                <p className="text-[14px] font-semibold">
                                    Margin vault
                                </p>
                                <p className="flex items-center gap-2 text-[12px] text-navy-2">
                                    <Lamp on={status === 'registered'} />
                                    {STATUS_TEXT[status]}
                                </p>
                            </div>
                            <ol className="grid gap-2 md:grid-cols-3">
                                <Step
                                    done
                                    label={`Payout group ${s.payoutGroupId}`}
                                    detail="Paxos onboarding"
                                />
                                <Step
                                    done={status !== 'unregistered'}
                                    label="Propose"
                                    detail="USDG.proposeRegisterRewardAddress"
                                />
                                <Step
                                    done={status === 'registered'}
                                    label="Accept"
                                    detail="vault.acceptRewardsRegistration"
                                />
                            </ol>
                            <div className="flex flex-wrap gap-2">
                                {status === 'unregistered' && (
                                    <ActionButton
                                        busy={busy === 'propose'}
                                        onClick={() => act('propose')}
                                    >
                                        Propose the vault
                                    </ActionButton>
                                )}
                                {status === 'proposed' && (
                                    <>
                                        <ActionButton
                                            busy={busy === 'accept'}
                                            onClick={() => act('accept')}
                                        >
                                            Accept from the vault
                                        </ActionButton>
                                        <ActionButton
                                            busy={busy === 'cancel'}
                                            onClick={() => act('cancel')}
                                            quiet
                                        >
                                            Cancel proposal
                                        </ActionButton>
                                    </>
                                )}
                            </div>
                            {message && (
                                <p className="text-[12.5px] text-error">
                                    {message.text}
                                </p>
                            )}
                        </div>
                        <p className="border-t border-sky/40 px-4 py-2.5 text-[12px] text-navy-2/75">
                            {REGISTRAR_STAND_IN}
                        </p>
                    </Card>
                </div>
            )}
        </TourTip>
    );
}

function Step({
    done,
    label,
    detail,
}: {
    done: boolean;
    label: string;
    detail: string;
}) {
    return (
        <li className="cell flex items-start gap-2.5 p-2.5" data-lit={done}>
            <span
                className={`mt-0.5 grid size-4 flex-none place-items-center rounded-full ${done ? 'bg-blue text-white' : 'border border-sky'}`}
            >
                {done && <Check className="size-3" strokeWidth={3} aria-hidden />}
            </span>
            <span>
                <span className="block text-[13px] font-medium">{label}</span>
                <span className="block font-mono text-[11px] break-all text-navy-2/70">
                    {detail}
                </span>
            </span>
        </li>
    );
}

function ActionButton({
    busy,
    onClick,
    quiet = false,
    disabled = false,
    children,
}: {
    busy: boolean;
    onClick: (e: MouseEvent<HTMLButtonElement>) => void;
    quiet?: boolean;
    disabled?: boolean;
    children: ReactNode;
}) {
    return (
        <button
            type="button"
            onClick={onClick}
            disabled={busy || disabled}
            className={`inline-flex items-center gap-1.5 rounded-[2px] px-3 py-1.5 text-[13px] font-medium disabled:opacity-40 ${
                quiet
                    ? 'border border-sky text-navy'
                    : 'bg-blue text-white hover:bg-blue/90'
            }`}
        >
            {busy && <Loader2 className="size-3.5 animate-spin" aria-hidden />}
            {children}
        </button>
    );
}

// Tells the flight layer a route just left the operator, so a tile can fly
// from the button to the vault.
function announceFlight(from: HTMLElement, amount: string) {
    window.dispatchEvent(
        new CustomEvent('perp:flight', {
            detail: { rect: from.getBoundingClientRect(), amount },
        }),
    );
}

function Rewards({ s }: { s: Snapshot }) {
    const { busy, message, run } = useAction();
    const r = s.rewards;
    // Something to claim now, or a claim from earlier still to route.
    const routable = Number(r.accruing) > 0 || r.claimed !== r.routed;

    async function route(e: MouseEvent<HTMLButtonElement>) {
        const button = e.currentTarget;
        const amount = r.accruing;

        if (await run('route', { action: 'route' })) {
            announceFlight(button, amount);
        }
    }

    return (
        <TourTip step="route" block>
            {(aria) => (
                <div {...aria}>
                    <Card title="USDG rewards for traders" tint="sky">
                        <dl className="grid grid-cols-2 gap-3 p-4 text-[12px] md:grid-cols-3">
                            {(
                                [
                                    ['Accruing now', r.accruing],
                                    ['Claimed', r.claimed],
                                    ['Routed into the vault', r.routed],
                                    ['To traders by margin', r.toTraders],
                                    ['To the house', r.toLiquidity],
                                    ['Added to margin by traders', r.addedToMargin],
                                ] as const
                            ).map(([label, value]) => (
                                <div key={label}>
                                    <dt className="text-navy-2/80">{label}</dt>
                                    <dd className="font-mono text-[14px]">
                                        {formatAmount(value)}
                                    </dd>
                                </div>
                            ))}
                        </dl>
                        <div className="flex flex-wrap items-center gap-2 border-t border-sky/40 px-4 py-3">
                            <ActionButton
                                busy={busy === 'route'}
                                disabled={!routable}
                                onClick={route}
                            >
                                Claim and route
                            </ActionButton>
                            <span className="ml-2 text-[12.5px] font-medium">
                                Advance time
                            </span>
                            {[1, 7, 30].map((days) => (
                                <ActionButton
                                    key={days}
                                    quiet
                                    busy={busy === `advance-${days}`}
                                    onClick={() =>
                                        run(`advance-${days}`, {
                                            action: 'advance',
                                            days,
                                        })
                                    }
                                >
                                    {days} day{days === 1 ? '' : 's'}
                                </ActionButton>
                            ))}
                            <span className="w-full text-[12px] text-navy-2/75">
                                {ADVANCE_STAND_IN}
                            </span>
                        </div>
                        {message && (
                            <p className="px-4 pb-3 text-[12.5px] text-error">
                                {message.text}
                            </p>
                        )}
                        <p className="border-t border-sky/40 px-4 py-2.5 text-[12px] text-navy-2/75">
                            {REWARDS_NOTE}
                        </p>
                    </Card>
                </div>
            )}
        </TourTip>
    );
}

const MOVES = [-1_000, -500, 0, 500, 1_000] as const;

function Markets({ s }: { s: Snapshot }) {
    const { busy, message, run } = useAction();

    return (
        <TourTip step="market" block>
            {(aria) => (
                <div {...aria}>
                    <Card
                        title="Markets and the keeper"
                        count={s.markets.length}
                        tint="navy"
                    >
                        <div className="divide-y divide-sky/40">
                            {s.markets.map((m) => (
                                <div key={m.id} className="space-y-2 px-4 py-3">
                                    <div className="flex flex-wrap items-baseline justify-between gap-2">
                                        <p className="text-[14px] font-semibold">
                                            {m.name}{' '}
                                            <span className="font-mono text-[13px] font-normal">
                                                {usd(m.price)}
                                            </span>
                                        </p>
                                        <p className="font-mono text-[11.5px] text-navy-2/75">
                                            pushed {m.age}s ago · open interest long{' '}
                                            {formatAmount(m.longOi)}, short{' '}
                                            {formatAmount(m.shortOi)}
                                        </p>
                                    </div>
                                    <div className="flex flex-wrap items-center gap-1.5">
                                        <span className="mr-1 text-[12px] text-navy-2/80">
                                            Move from fork price
                                        </span>
                                        {MOVES.map((bps) => (
                                            <button
                                                key={bps}
                                                type="button"
                                                disabled={busy !== undefined}
                                                aria-pressed={m.move === bps}
                                                onClick={() =>
                                                    run(`move-${m.id}-${bps}`, {
                                                        action: 'move',
                                                        market: m.id,
                                                        bps,
                                                    })
                                                }
                                                className={`rounded-[2px] border px-2 py-1 font-mono text-[11.5px] disabled:opacity-50 ${
                                                    m.move === bps
                                                        ? 'border-navy bg-navy text-white'
                                                        : 'border-sky bg-white'
                                                }`}
                                            >
                                                {bps === 0
                                                    ? '0%'
                                                    : `${bps > 0 ? '+' : ''}${bps / 100}%`}
                                            </button>
                                        ))}
                                    </div>
                                </div>
                            ))}
                        </div>
                        {message && (
                            <p className="px-4 pb-3 text-[12.5px] text-error">
                                {message.text}
                            </p>
                        )}
                        <div className="border-t border-sky/40 px-4 py-3">
                            <p className="text-[13px] font-semibold">Liquidations</p>
                            {s.liquidations.length === 0 ? (
                                <p className="mt-1 text-[12.5px] text-navy-2/75">
                                    None yet. Open a 10x long, then move its market down
                                    10%.
                                </p>
                            ) : (
                                <ul className="mt-1 space-y-1 text-[12.5px]">
                                    {s.liquidations.map((l) => (
                                        <li key={l.txHash}>
                                            {l.trader}&rsquo;s {l.side} {l.market} at{' '}
                                            {usd(l.price)}:{' '}
                                            <span className="font-mono">
                                                {formatAmount(l.collateral)}
                                            </span>{' '}
                                            USDG of collateral to the house
                                        </li>
                                    ))}
                                </ul>
                            )}
                        </div>
                        <p className="border-t border-sky/40 px-4 py-2.5 text-[12px] text-navy-2/75">
                            {MARKET_STAND_IN}
                        </p>
                    </Card>
                </div>
            )}
        </TourTip>
    );
}

function Traders({ s }: { s: Snapshot }) {
    return (
        <Card title="Traders" count={s.traders.length} tint="navy">
            <div className="overflow-x-auto">
                <table className="w-full min-w-[460px] text-[13px]">
                    <thead className="text-left text-[12px] text-navy-2/80">
                        <tr className="border-b border-sky/50">
                            <th className="px-4 py-2 font-medium">Trader</th>
                            <th className="px-4 py-2 font-medium">Free margin</th>
                            <th className="px-4 py-2 font-medium">In positions</th>
                            <th className="px-4 py-2 font-medium">Rewards ready</th>
                        </tr>
                    </thead>
                    <tbody>
                        {s.traders.map((t) => (
                            <tr
                                key={t.id}
                                className="border-b border-sky/30 last:border-0"
                            >
                                <td className="px-4 py-3 font-semibold">
                                    {t.name}
                                    <span className="block font-mono text-[11px] font-normal text-navy-2/65">
                                        {shortAddress(t.address)}
                                    </span>
                                </td>
                                <td className="px-4 py-3 font-mono">
                                    {formatAmount(t.freeMargin)}
                                </td>
                                <td className="px-4 py-3 font-mono">
                                    {formatAmount(t.locked)}
                                </td>
                                <td className="px-4 py-3 font-mono">
                                    {formatAmount(t.pendingRewards)}
                                </td>
                            </tr>
                        ))}
                    </tbody>
                </table>
            </div>
        </Card>
    );
}

const RULES: Record<CheckView['rule'], string> = {
    vault: 'Vault USDG covers margin, collateral, house liquidity, and rewards held',
    margin: 'Each trader’s free margin adds up to the vault’s total',
    collateral: 'Each open position’s collateral adds up to the vault’s total',
    house: 'House liquidity covers the profit reserved for open positions',
    claims: 'Claims in Acme’s records match USDG’s RewardsClaimed events',
    routing: 'Everything claimed was routed into the vault',
};

function Books({ s }: { s: Snapshot }) {
    return (
        <Card title="The books against the chain" tint="sky">
            <ul className="space-y-2 p-4">
                {s.checks.map((c) => (
                    <li
                        key={c.rule}
                        className="cell p-2.5"
                        data-lit={c.status === 'matched'}
                        data-alert={c.status === 'drift'}
                    >
                        <p className="flex items-center gap-2 text-[13px] font-medium">
                            <Lamp
                                on={c.status === 'matched'}
                                alert={c.status === 'drift'}
                            />
                            {RULES[c.rule]}
                        </p>
                        <p className="mt-1 font-mono text-[11.5px] text-navy-2/75">
                            {`${formatAmount(c.ledger)} against ${formatAmount(c.onchain)} USDG, ${c.status}`}
                            {c.surplus && Number(c.surplus) > 0
                                ? `, ${formatAmount(c.surplus)} USDG sent to the vault directly`
                                : ''}
                        </p>
                    </li>
                ))}
            </ul>
        </Card>
    );
}
