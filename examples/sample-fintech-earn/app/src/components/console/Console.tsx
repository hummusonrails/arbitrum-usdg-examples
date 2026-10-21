'use client';

import { Loader2 } from 'lucide-react';
import { useState, type FormEvent } from 'react';

import { postAction } from '@/lib/api';
import { percent } from '@/lib/copy';
import { formatAmount, shortAddress, timeOf } from '@/lib/format';
import type { CheckView, Snapshot } from '@/lib/types';

import { BigNumber } from '../BigNumber';
import { Card } from '../Card';
import { ExplorerLink } from '../ExplorerLink';
import { Lamp } from '../Lamp';
import { TourTip } from '../Tour';
import { useSnapshot } from '../useSnapshot';

const SHARE = 10n ** 18n;

// Vault shares are 18 decimal base units; shown with four decimals.
function shares(raw: string): string {
    const units = BigInt(raw);
    const whole = units / SHARE;
    const frac = ((units % SHARE) * 10_000n) / SHARE;

    return `${whole.toLocaleString('en-US')}.${frac.toString().padStart(4, '0')}`;
}

function arb(value: string): string {
    return Number(value).toFixed(4);
}

// What Acme Money's engineering and finance team watches: the omnibus wallet,
// each vault position, the customer books against the chain, and rewards.
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
            <Positions s={s} />
            <div className="grid gap-5 2xl:grid-cols-2">
                <Books s={s} />
                <Rewards s={s} />
            </div>
            <Actions s={s} />
        </div>
    );
}

function Slate({ s }: { s: Snapshot }) {
    const feed = s.feed.slice(0, 7);

    return (
        <section className="slate power-on grid gap-6 p-6 lg:grid-cols-[1fr_1.2fr]">
            <div className="space-y-4">
                <div>
                    <h2 className="text-sm font-semibold text-sky">Omnibus wallet</h2>
                    <div className="mt-2">
                        <BigNumber value={s.omnibus.usdg} unit="USDG" compact />
                    </div>
                </div>
                <dl className="grid grid-cols-3 gap-3 text-[12px]">
                    <div>
                        <dt className="text-white/65">Unassigned</dt>
                        <dd className="font-mono text-white">
                            {formatAmount(s.omnibus.unassigned)}
                        </dd>
                    </div>
                    <div>
                        <dt className="text-white/65">ETH for gas</dt>
                        <dd className="font-mono text-white">
                            {Number(s.omnibus.eth).toFixed(4)}
                        </dd>
                    </div>
                    <div>
                        <dt className="text-white/65">ARB</dt>
                        <dd className="font-mono text-white">{arb(s.omnibus.arb)}</dd>
                    </div>
                </dl>
                <AssignForm s={s} />
            </div>
            <div className="min-w-0 rounded-[2px] border border-white/10 bg-black/15 p-4">
                <h2 className="mb-3 text-sm font-semibold text-sky">Onchain actions</h2>
                <ol className="space-y-1.5 font-mono text-[12px] leading-5">
                    {feed.length === 0 && (
                        <li className="text-white/50">Waiting for the first deposit</li>
                    )}
                    {feed.map((line) => (
                        <li
                            key={`${line.at}${line.text}`}
                            className="feed-wrap text-white/85"
                        >
                            <span className="mr-2 text-white/40">
                                {timeOf(line.at)}
                            </span>
                            {line.text}
                        </li>
                    ))}
                </ol>
            </div>
        </section>
    );
}

function AssignForm({ s }: { s: Snapshot }) {
    const [customerId, setCustomerId] = useState('maya');
    const [amount, setAmount] = useState('');
    const [busy, setBusy] = useState(false);
    const [message, setMessage] = useState<string>();

    async function submit(e: FormEvent<HTMLFormElement>) {
        e.preventDefault();
        setBusy(true);
        setMessage(undefined);

        const r = await postAction({ action: 'assign', customerId, amount });

        setBusy(false);
        setMessage(r.ok ? 'Assigned.' : r.message);

        if (r.ok) {
            setAmount('');
        }
    }

    return (
        <form onSubmit={submit} className="flex flex-wrap items-end gap-2 text-[12px]">
            <label className="flex flex-col gap-1 text-white/70">
                Assign unassigned USDG to
                <select
                    value={customerId}
                    onChange={(e) => setCustomerId(e.target.value)}
                    className="rounded-[2px] border border-white/20 bg-navy-2 px-2 py-1.5 text-white"
                >
                    {s.customers.map((c) => (
                        <option key={c.id} value={c.id}>
                            {c.name}
                        </option>
                    ))}
                </select>
            </label>
            <input
                value={amount}
                onChange={(e) => setAmount(e.target.value.trim())}
                placeholder="USDG"
                aria-label="Amount to assign"
                className="w-24 rounded-[2px] border border-white/20 bg-navy-2 px-2 py-1.5 font-mono text-white"
            />
            <button
                type="submit"
                disabled={busy}
                className="rounded-[2px] bg-blue px-3 py-1.5 font-medium text-white disabled:opacity-50"
            >
                Assign
            </button>
            {message && <span className="w-full text-white/75">{message}</span>}
        </form>
    );
}

function check(checks: CheckView[], rule: CheckView['rule'], vaultId?: string) {
    return checks.find((c) => c.rule === rule && c.vaultId === vaultId);
}

function Positions({ s }: { s: Snapshot }) {
    return (
        <TourTip step="positions" block>
            {(aria) => (
                <div {...aria}>
                    <Card title="Vault positions" count={s.vaults.length} tint="sky">
                        <div className="overflow-x-auto">
                            <table className="w-full min-w-[640px] text-[13px]">
                                <thead className="text-left text-[12px] text-navy-2/80">
                                    <tr className="border-b border-sky/50">
                                        <th className="px-4 py-2 font-medium">Vault</th>
                                        <th className="px-4 py-2 font-medium">
                                            Omnibus shares
                                        </th>
                                        <th className="px-4 py-2 font-medium">
                                            Value, USDG
                                        </th>
                                        <th className="px-4 py-2 font-medium">
                                            Rate now
                                        </th>
                                        <th className="px-4 py-2 font-medium">
                                            Withdrawable now
                                        </th>
                                        <th className="px-4 py-2 font-medium">
                                            Health
                                        </th>
                                    </tr>
                                </thead>
                                <tbody>
                                    {s.vaults.map((v, i) => (
                                        <tr
                                            key={v.id}
                                            id={`vault-row-${v.id}`}
                                            className="cell-row border-b border-sky/30 last:border-0"
                                        >
                                            <td className="px-4 py-3">
                                                <p className="font-semibold whitespace-nowrap">
                                                    {v.name}
                                                </p>
                                                <p className="text-[11.5px] text-navy-2/75">
                                                    <ExplorerLink
                                                        explorer={s.explorer}
                                                        path={`address/${v.address}`}
                                                        className="font-mono"
                                                    >
                                                        {shortAddress(v.address)}
                                                    </ExplorerLink>
                                                </p>
                                            </td>
                                            <td className="px-4 py-3 font-mono">
                                                {shares(v.omnibusShares)}
                                            </td>
                                            <td className="px-4 py-3 font-mono">
                                                {formatAmount(v.omnibusValue)}
                                                <span className="block text-[11px] text-navy-2/70">
                                                    {v.sharePrice} per share
                                                </span>
                                            </td>
                                            <td className="px-4 py-3 font-mono text-[12px]">
                                                {percent(v.vaultApy)}
                                                {v.boost
                                                    ? ` + ${percent(v.boost.apr)} ${v.boost.token}`
                                                    : ''}
                                            </td>
                                            <td className="px-4 py-3 font-mono">
                                                {v.instantLiquidity === null
                                                    ? 'Per GMX market'
                                                    : formatAmount(
                                                          v.instantLiquidity.split(
                                                              '.',
                                                          )[0],
                                                      )}
                                            </td>
                                            <td className="px-4 py-3">
                                                <span className="flex flex-col gap-1 text-[11.5px]">
                                                    <span className="flex items-center gap-2">
                                                        <Lamp
                                                            on={v.lamps.gates}
                                                            alert={!v.lamps.gates}
                                                            delay={i * 80}
                                                        />{' '}
                                                        Gates open
                                                    </span>
                                                    {v.lamps.liquidity !== null && (
                                                        <span className="flex items-center gap-2">
                                                            <Lamp
                                                                on={v.lamps.liquidity}
                                                                alert={
                                                                    !v.lamps.liquidity
                                                                }
                                                                delay={i * 80 + 40}
                                                            />{' '}
                                                            Liquidity
                                                        </span>
                                                    )}
                                                    {v.lamps.keeper !== null && (
                                                        <span className="flex items-center gap-2">
                                                            <Lamp
                                                                on={v.lamps.keeper}
                                                                delay={i * 80 + 60}
                                                            />{' '}
                                                            Local keeper
                                                        </span>
                                                    )}
                                                </span>
                                            </td>
                                        </tr>
                                    ))}
                                </tbody>
                            </table>
                        </div>
                    </Card>
                </div>
            )}
        </TourTip>
    );
}

function Books({ s }: { s: Snapshot }) {
    const rows: { label: string; c?: CheckView; unit: string }[] = [
        ...s.vaults.map((v) => ({
            label: `${v.name} shares`,
            c: check(s.checks, 'shares', v.id),
            unit: 'shares',
        })),
        { label: 'USDG owed to customers', c: check(s.checks, 'usdg'), unit: 'USDG' },
        {
            label: 'ARB allocated to customers',
            c: check(s.checks, 'rewards'),
            unit: 'ARB',
        },
    ];

    return (
        <TourTip step="books" block>
            {(aria) => (
                <div {...aria}>
                    <Card title="Customer books against the chain" tint="sky">
                        <div className="overflow-x-auto">
                            <table className="w-full min-w-[520px] text-[13px]">
                                <thead className="text-left text-[12px] text-navy-2/80">
                                    <tr className="border-b border-sky/50">
                                        <th className="px-4 py-2 font-medium">Rule</th>
                                        <th className="px-4 py-2 font-medium">
                                            Acme books
                                        </th>
                                        <th className="px-4 py-2 font-medium">
                                            Onchain
                                        </th>
                                        <th className="px-4 py-2 font-medium">
                                            Status
                                        </th>
                                    </tr>
                                </thead>
                                <tbody>
                                    {rows.map(({ label, c, unit }) => (
                                        <tr
                                            key={label}
                                            className="border-b border-sky/30 last:border-0"
                                        >
                                            <td className="px-4 py-2.5">{label}</td>
                                            <td className="px-4 py-2.5 font-mono text-[12px]">
                                                {c
                                                    ? unit === 'shares'
                                                        ? shares(c.ledger)
                                                        : unit === 'ARB'
                                                          ? arb(c.ledger)
                                                          : formatAmount(c.ledger)
                                                    : ''}
                                            </td>
                                            <td className="px-4 py-2.5 font-mono text-[12px]">
                                                {c
                                                    ? unit === 'shares'
                                                        ? shares(c.onchain)
                                                        : unit === 'ARB'
                                                          ? arb(c.onchain)
                                                          : formatAmount(c.onchain)
                                                    : ''}
                                            </td>
                                            <td className="px-4 py-2.5">
                                                <span className="flex items-center gap-2 text-[12px]">
                                                    <Lamp
                                                        on={c?.status === 'matched'}
                                                        alert={c?.status === 'drift'}
                                                    />
                                                    {c?.status === 'drift'
                                                        ? 'Drift'
                                                        : 'Matched'}
                                                </span>
                                            </td>
                                        </tr>
                                    ))}
                                </tbody>
                            </table>
                        </div>
                        <div className="border-t border-sky/50 px-4 py-3">
                            <h3 className="mb-2 text-[12.5px] font-semibold">
                                Per customer
                            </h3>
                            <ul className="grid gap-2 text-[12.5px] md:grid-cols-3">
                                {s.customers.map((c) => (
                                    <li
                                        key={c.id}
                                        className="cell p-2.5"
                                        data-lit={c.positions.length > 0}
                                    >
                                        <p className="font-semibold">{c.name}</p>
                                        <p className="font-mono text-[11.5px] text-navy-2">
                                            App balance {formatAmount(c.usdg)} USDG
                                        </p>
                                        {c.positions.map((p) => (
                                            <p
                                                key={p.vaultId}
                                                className="font-mono text-[11.5px] text-navy-2"
                                            >
                                                {
                                                    s.vaults.find(
                                                        (v) => v.id === p.vaultId,
                                                    )?.name
                                                }
                                                : {shares(p.shares)}
                                            </p>
                                        ))}
                                    </li>
                                ))}
                            </ul>
                        </div>
                    </Card>
                </div>
            )}
        </TourTip>
    );
}

function Rewards({ s }: { s: Snapshot }) {
    const [busy, setBusy] = useState(false);
    const [message, setMessage] = useState<string>();
    const r = s.rewards;

    async function claim() {
        setBusy(true);
        setMessage(undefined);

        const res = await postAction({ action: 'claim' });

        setBusy(false);
        setMessage(res.ok ? 'Claimed and shared.' : res.message);
    }

    return (
        <Card title="ARB rewards from Merkl" tint="blue">
            <div className="space-y-3 p-4">
                {r.simulated && (
                    <p className="text-[12px] text-navy-2/80">
                        Simulated rewards on a local fork: a local stand in for Merkl
                        accrues ARB at the live campaign rate on a sped up clock and
                        posts real roots to the Merkl contract.
                    </p>
                )}
                <dl className="grid grid-cols-2 gap-3 font-mono text-[13px] md:grid-cols-5">
                    {(
                        [
                            ['Accrued', r.accrued],
                            ['Pending', r.pending],
                            ['Claimable', r.claimable],
                            ['Claimed', r.claimed],
                            ['Shared', r.allocated],
                        ] as const
                    ).map(([label, v]) => (
                        <div key={label}>
                            <dt className="font-sans text-[11.5px] text-navy-2/80">
                                {label}
                            </dt>
                            <dd>{arb(v)}</dd>
                        </div>
                    ))}
                </dl>
                <ul className="grid gap-x-6 gap-y-1 text-[12.5px] md:grid-cols-3">
                    {s.customers.map((c) => (
                        <li
                            key={c.id}
                            className="flex justify-between gap-2 border-b border-sky/40 py-1"
                        >
                            <span>{c.name}</span>
                            <span className="font-mono">{arb(c.arbRewards)} ARB</span>
                        </li>
                    ))}
                </ul>
                <div className="flex items-center gap-3">
                    <TourTip step="rewards">
                        {(aria) => (
                            <button
                                type="button"
                                {...aria}
                                onClick={claim}
                                disabled={busy || Number(r.claimable) === 0}
                                className="flex items-center gap-2 rounded-[2px] bg-blue px-4 py-2 text-[13px] font-semibold text-white disabled:opacity-50"
                            >
                                {busy && <Loader2 className="size-4 animate-spin" />}
                                Claim and share
                            </button>
                        )}
                    </TourTip>
                    <p className="text-[12px] text-navy-2/80">
                        {message ??
                            (r.lastAllocationAt
                                ? `Last shared ${timeOf(r.lastAllocationAt)}, by shares held over time.`
                                : 'Claims are shared by how many shares each customer held, and for how long.')}
                    </p>
                </div>
            </div>
        </Card>
    );
}

function Actions({ s }: { s: Snapshot }) {
    return (
        <Card title="Recent actions" count={s.actions.length} tint="navy">
            <ul className="divide-y divide-sky/40 text-[12.5px]">
                {s.actions.length === 0 && (
                    <li className="px-4 py-3 text-navy-2/80">No actions yet.</li>
                )}
                {s.actions.slice(0, 12).map((a) => (
                    <li
                        key={a.id}
                        className="flex flex-wrap items-center justify-between gap-2 px-4 py-2.5"
                    >
                        <span>
                            <span className="font-semibold">
                                {s.customers.find((c) => c.id === a.customerId)?.name ??
                                    'Operator'}
                            </span>{' '}
                            {a.kind}{' '}
                            {a.vaultId
                                ? `· ${s.vaults.find((v) => v.id === a.vaultId)?.name}`
                                : ''}
                        </span>
                        <span className="flex items-center gap-3 font-mono text-[12px] text-navy-2">
                            {a.status}
                            {a.txHash && (
                                <ExplorerLink
                                    explorer={s.explorer}
                                    path={`tx/${a.txHash}`}
                                >
                                    {shortAddress(a.txHash)}
                                </ExplorerLink>
                            )}
                            <CancelButton s={s} id={a.id} />
                        </span>
                        {a.reason && (
                            <span className="w-full text-[12px] text-navy-2/80">
                                {a.reason}
                            </span>
                        )}
                    </li>
                ))}
            </ul>
        </Card>
    );
}

// GMX lets the creator cancel a request still pending after five minutes.
function CancelButton({ s, id }: { s: Snapshot; id: string }) {
    const a = s.actions.find((x) => x.id === id)!;
    const [message, setMessage] = useState<string>();

    if (
        a.status !== 'pending' ||
        a.mode !== 'async' ||
        Date.now() - Date.parse(a.createdAt) < 300_000
    ) {
        return null;
    }

    return (
        <button
            type="button"
            onClick={async () =>
                setMessage(
                    (await postAction({ action: 'cancel', actionId: id })).message,
                )
            }
            className="rounded-[2px] border border-sky px-2 py-0.5 font-sans text-[12px]"
            title={message}
        >
            Cancel
        </button>
    );
}
