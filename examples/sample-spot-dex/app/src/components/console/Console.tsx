'use client';

import { Check, Loader2 } from 'lucide-react';
import type { MouseEvent, ReactNode } from 'react';

import {
    ADVANCE_STAND_IN,
    POOL_NOTE,
    REGISTRAR_STAND_IN,
    REWARDS_NOTE,
} from '@/lib/copy';
import { formatAmount, shortAddress } from '@/lib/format';
import type { CheckView, PoolSnapshot, Snapshot } from '@/lib/types';

import { BigNumber } from '../BigNumber';
import { Card } from '../Card';
import { Lamp } from '../Lamp';
import { TourTip } from '../Tour';
import { useAction } from '../useAction';
import { useSnapshot } from '../useSnapshot';

// What the Acme Swap team watches: the operator wallet, each pool, the rewards
// registration and routing, LayerZero transfers, and the books against the chain.
export function Console() {
    const s = useSnapshot();

    if (!s) {
        return (
            <p className="flex items-center gap-2 text-sm text-navy-2">
                <Loader2 className="size-4 animate-spin" /> Connecting to the forks
            </p>
        );
    }

    return (
        <div className="space-y-5">
            {s.error && <p className="tile px-4 py-3 text-[13px]">{s.error}</p>}
            <Slate s={s} />
            <Pools s={s} />
            <Registration s={s} />
            <Rewards s={s} />
            <div className="grid gap-5 2xl:grid-cols-2">
                <Transfers s={s} />
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
                        <dt className="text-white/65">ETH for gas</dt>
                        <dd className="font-mono text-white">
                            {Number(s.operator.eth).toFixed(4)}
                        </dd>
                    </div>
                    <div>
                        <dt className="text-white/65">Arbitrum fork time</dt>
                        <dd className="font-mono text-white">
                            {new Date(s.forkTime).toLocaleDateString('en-US', {
                                month: 'short',
                                day: 'numeric',
                            })}
                        </dd>
                    </div>
                </dl>
                <p className="text-[12px] leading-5 text-white/70">
                    The operator owns the pools and is the payout group&rsquo;s claimer,
                    manager, and destination.
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
                            <span className="mr-2 text-sky">
                                {line.network === 'ethereum' ? 'eth' : 'arb'}
                            </span>
                            {line.text}
                        </li>
                    ))}
                </ol>
            </div>
        </section>
    );
}

function Pools({ s }: { s: Snapshot }) {
    return (
        <Card title="Pools quoted in USDG" count={s.pools.length} tint="sky">
            <div className="overflow-x-auto">
                <table className="w-full min-w-[620px] text-[13px]">
                    <thead className="text-left text-[12px] text-navy-2/80">
                        <tr className="border-b border-sky/50">
                            <th className="px-4 py-2 font-medium">Pool</th>
                            <th className="px-4 py-2 font-medium">Reserves</th>
                            <th className="px-4 py-2 font-medium">Price, USDG</th>
                            <th className="px-4 py-2 font-medium">
                                USDG rewards held for LPs
                            </th>
                            <th className="px-4 py-2 font-medium">Contract</th>
                        </tr>
                    </thead>
                    <tbody>
                        {s.pools.map((p) => (
                            <tr
                                key={p.id}
                                id={`pool-row-${p.id}`}
                                className="border-b border-sky/30 last:border-0"
                            >
                                <td className="px-4 py-3 font-semibold">{p.pair}</td>
                                <td className="px-4 py-3 font-mono text-[12px]">
                                    {formatAmount(p.baseReserve)} {p.baseSymbol}
                                    <br />
                                    {formatAmount(p.quoteReserve)} USDG
                                </td>
                                <td className="px-4 py-3 font-mono">
                                    {formatAmount(p.price)}
                                </td>
                                <td className="px-4 py-3 font-mono">
                                    {formatAmount(p.rewards.heldForLps)}
                                </td>
                                <td className="px-4 py-3 font-mono text-[12px] text-navy-2/75">
                                    {shortAddress(p.address)}
                                </td>
                            </tr>
                        ))}
                    </tbody>
                </table>
            </div>
            <p className="border-t border-sky/40 px-4 py-2.5 text-[12px] text-navy-2/75">
                Reserves live in the pool&rsquo;s storage, so rewards and direct
                transfers never move the price. {POOL_NOTE}
            </p>
        </Card>
    );
}

const STATUS_TEXT = {
    unregistered: 'Not registered',
    proposed: 'Proposed, waiting for the pool to accept',
    registered: 'Registered',
} as const;

function Registration({ s }: { s: Snapshot }) {
    return (
        <TourTip step="register" block>
            {(aria) => (
                <div {...aria}>
                    <Card title="USDG rewards registration" tint="blue">
                        <div className="divide-y divide-sky/40">
                            {s.pools.map((p) => (
                                <RegistrationRow
                                    key={p.id}
                                    pool={p}
                                    groupId={s.payoutGroupId}
                                />
                            ))}
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

function RegistrationRow({ pool, groupId }: { pool: PoolSnapshot; groupId: number }) {
    const { busy, message, run } = useAction();
    const { status } = pool.registration;
    const act = (action: 'propose' | 'accept' | 'cancel') =>
        run(action, { action, poolId: pool.id });

    return (
        <div className="space-y-3 px-4 py-4">
            <div className="flex items-center justify-between">
                <p className="text-[14px] font-semibold">{pool.pair}</p>
                <p className="flex items-center gap-2 text-[12px] text-navy-2">
                    <Lamp on={status === 'registered'} />
                    {STATUS_TEXT[status]}
                </p>
            </div>
            <ol className="grid gap-2 md:grid-cols-3">
                <Step
                    done
                    label={`Payout group ${groupId}`}
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
                    detail="pool.acceptRewardsRegistration"
                />
            </ol>
            <div className="flex flex-wrap gap-2">
                {status === 'unregistered' && (
                    <ActionButton
                        busy={busy === 'propose'}
                        onClick={() => act('propose')}
                    >
                        Propose the pool
                    </ActionButton>
                )}
                {status === 'proposed' && (
                    <>
                        <ActionButton
                            busy={busy === 'accept'}
                            onClick={() => act('accept')}
                        >
                            Accept from the pool
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
            {message && <p className="text-[12.5px] text-error">{message.text}</p>}
        </div>
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

// Tells the flight layer a route just left the operator wallet, so a tile can
// fly from the button to the pool's row.
function announceFlight(from: HTMLElement, poolId: string, amount: string) {
    window.dispatchEvent(
        new CustomEvent('dex:flight', {
            detail: { rect: from.getBoundingClientRect(), poolId, amount },
        }),
    );
}

function Rewards({ s }: { s: Snapshot }) {
    const { busy, message, run } = useAction();

    async function route(e: MouseEvent<HTMLButtonElement>, pool: PoolSnapshot) {
        const button = e.currentTarget;
        const amount = pool.rewards.accruing;

        if (await run(`route-${pool.id}`, { action: 'route', poolId: pool.id })) {
            announceFlight(button, pool.id, amount);
        }
    }

    return (
        <TourTip step="route" block>
            {(aria) => (
                <div {...aria}>
                    <Card title="Rewards for LPs" tint="sky">
                        <div className="overflow-x-auto">
                            <table className="w-full min-w-[520px] text-[13px]">
                                <thead className="text-left text-[12px] text-navy-2/80">
                                    <tr className="border-b border-sky/50">
                                        <th className="px-4 py-2 font-medium">Pool</th>
                                        <th className="px-4 py-2 font-medium">
                                            Accruing now
                                        </th>
                                        <th className="px-4 py-2 font-medium">
                                            Claimed
                                        </th>
                                        <th className="px-4 py-2 font-medium">
                                            Routed
                                        </th>
                                        <th className="px-4 py-2 font-medium">
                                            Claimed by LPs
                                        </th>
                                        <th className="px-4 py-2" />
                                    </tr>
                                </thead>
                                <tbody>
                                    {s.pools.map((p) => (
                                        <tr
                                            key={p.id}
                                            className="border-b border-sky/30 last:border-0"
                                        >
                                            <td className="px-4 py-3 font-semibold">
                                                {p.pair}
                                            </td>
                                            <td className="px-4 py-3 font-mono">
                                                {formatAmount(p.rewards.accruing)}
                                            </td>
                                            <td className="px-4 py-3 font-mono">
                                                {formatAmount(p.rewards.claimed)}
                                            </td>
                                            <td className="px-4 py-3 font-mono">
                                                {formatAmount(p.rewards.routed)}
                                            </td>
                                            <td className="px-4 py-3 font-mono">
                                                {formatAmount(p.rewards.claimedByLps)}
                                            </td>
                                            <td className="px-4 py-3 text-right">
                                                <ActionButton
                                                    busy={busy === `route-${p.id}`}
                                                    disabled={!routable(p)}
                                                    onClick={(e) => route(e, p)}
                                                >
                                                    Claim and route
                                                </ActionButton>
                                            </td>
                                        </tr>
                                    ))}
                                </tbody>
                            </table>
                        </div>
                        <div className="flex flex-wrap items-center gap-2 border-t border-sky/40 px-4 py-3">
                            <span className="text-[12.5px] font-medium">
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

// Something to claim now, or a claim from earlier still to route.
function routable(p: PoolSnapshot) {
    return Number(p.rewards.accruing) > 0 || p.rewards.claimed !== p.rewards.routed;
}

const CHAIN = { arbitrum: 'Arbitrum', ethereum: 'Ethereum' } as const;

function Transfers({ s }: { s: Snapshot }) {
    const names = Object.fromEntries(s.wallets.map((w) => [w.id, w.name]));

    return (
        <Card title="LayerZero transfers" count={s.transfers.length} tint="navy">
            {s.transfers.length === 0 ? (
                <p className="px-4 py-4 text-[13px] text-navy-2/75">
                    No transfers yet. Send USDG from the Move tab in the trader app.
                </p>
            ) : (
                <ul className="divide-y divide-sky/40">
                    {s.transfers.slice(0, 8).map((t) => (
                        <li
                            key={t.guid}
                            className="flex items-center justify-between gap-3 px-4 py-3 text-[13px]"
                        >
                            <span>
                                {t.wallet ? names[t.wallet] : 'Another wallet'} sent{' '}
                                <span className="font-mono">
                                    {formatAmount(t.amountSent)}
                                </span>{' '}
                                USDG, {CHAIN[t.from]} to {CHAIN[t.to]}
                                <span className="block font-mono text-[11px] text-navy-2/65">
                                    guid {shortAddress(t.guid)}
                                </span>
                            </span>
                            <span className="flex items-center gap-2 text-[12px]">
                                <Lamp on={t.status === 'delivered'} />
                                {t.status === 'delivered' ? 'Delivered' : 'In flight'}
                            </span>
                        </li>
                    ))}
                </ul>
            )}
        </Card>
    );
}

const RULES: Record<CheckView['rule'], string> = {
    reserves: 'Pool USDG covers its reserve and the rewards held for LPs',
    claims: 'Claims in Acme’s records match USDG’s RewardsClaimed events',
    routing: 'Everything claimed was routed into the pool',
    transfer: 'USDG burned on one chain was minted in full on the other',
};

function Books({ s }: { s: Snapshot }) {
    const pairs = Object.fromEntries(s.pools.map((p) => [p.id, p.pair]));

    return (
        <Card title="The books against the chain" tint="sky">
            <ul className="space-y-2 p-4">
                {s.checks.map((c, i) => (
                    <li
                        key={`${c.rule}${c.poolId ?? c.guid}${i}`}
                        className="cell p-2.5"
                        data-lit={c.status === 'matched'}
                        data-alert={c.status === 'drift'}
                    >
                        <p className="flex items-center gap-2 text-[13px] font-medium">
                            <Lamp
                                on={c.status === 'matched'}
                                alert={c.status === 'drift'}
                            />
                            {c.poolId ? `${pairs[c.poolId]}: ` : ''}
                            {RULES[c.rule]}
                        </p>
                        <p className="mt-1 font-mono text-[11.5px] text-navy-2/75">
                            {c.status === 'pending'
                                ? `In flight: ${formatAmount(c.ledger)} USDG sent`
                                : `${formatAmount(c.ledger)} against ${formatAmount(c.onchain)} USDG, ${c.status === 'matched' ? 'matched' : 'drift'}`}
                            {c.surplus && Number(c.surplus) > 0
                                ? `, ${formatAmount(c.surplus)} USDG sent to the pool directly`
                                : ''}
                        </p>
                    </li>
                ))}
            </ul>
        </Card>
    );
}
