'use client';

import { ArrowLeft, Loader2, Plus } from 'lucide-react';
import { useState, type FormEvent } from 'react';

import { postAction } from '@/lib/api';
import { COMMON_DISCLOSURE, HOLDING_NOTE, percent, vaultDisclosure } from '@/lib/copy';
import { formatAmount, formatMoney } from '@/lib/format';
import type { CustomerView, Snapshot, VaultView } from '@/lib/types';
import type { VaultId } from '@/server/vaults/types';

import { BigNumber } from '../BigNumber';
import { AcmeMark } from '../Sidebar';
import { TourTip } from '../Tour';
import { useSnapshot } from '../useSnapshot';
import { ProtocolMark, RateLines, totalRate, VaultCard } from './VaultCard';

type Screen =
    | { name: 'home' }
    | { name: 'vaults' }
    | { name: 'vault'; vaultId: VaultId }
    | { name: 'withdraw'; vaultId: VaultId };

const AMOUNT = /^\d+(\.\d{1,6})?$/;

// Tells the operator console a deposit just left the phone, so it can fly a
// tile from the button to the vault's row.
function announceFlight(from: HTMLElement | null, vaultId: VaultId, amount: string) {
    if (from) {
        window.dispatchEvent(
            new CustomEvent('earn:flight', {
                detail: { rect: from.getBoundingClientRect(), vaultId, amount },
            }),
        );
    }
}

export function Phone() {
    const s = useSnapshot();
    const [customerId, setCustomerId] = useState('maya');
    const [screen, setScreen] = useState<Screen>({ name: 'home' });

    const customer = s?.customers.find((c) => c.id === customerId);

    return (
        <div className="mx-auto w-full max-w-[400px]">
            <div className="rounded-[34px] bg-navy p-2.5 shadow-[0_30px_60px_-28px_rgba(11,19,48,0.7),0_6px_0_#0b1330]">
                <div className="relative flex h-[760px] flex-col overflow-hidden rounded-[26px] bg-[#f4f9fd]">
                    <div className="flex items-center justify-between bg-white/80 px-5 pt-4 pb-3 backdrop-blur">
                        <div className="flex items-center gap-2">
                            <AcmeMark size={26} />
                            <span className="text-[15px] font-semibold">
                                Acme Money
                            </span>
                        </div>
                        <label className="text-[12px] text-navy-2">
                            <span className="sr-only">Customer</span>
                            <select
                                value={customerId}
                                onChange={(e) => {
                                    setCustomerId(e.target.value);
                                    setScreen({ name: 'home' });
                                }}
                                className="rounded-[2px] border border-sky bg-white px-2 py-1 font-medium"
                            >
                                {(s?.customers ?? []).map((c) => (
                                    <option key={c.id} value={c.id}>
                                        {c.name}
                                    </option>
                                ))}
                            </select>
                        </label>
                    </div>
                    <div className="flex-1 overflow-y-auto px-4 pt-3 pb-6">
                        {!s || !customer ? (
                            <p className="mt-20 flex items-center justify-center gap-2 text-sm text-navy-2">
                                <Loader2 className="size-4 animate-spin" /> Loading
                            </p>
                        ) : screen.name === 'home' ? (
                            <Home s={s} customer={customer} go={setScreen} />
                        ) : screen.name === 'vaults' ? (
                            <Vaults s={s} go={setScreen} />
                        ) : screen.name === 'vault' ? (
                            <VaultScreen
                                s={s}
                                customer={customer}
                                vault={s.vaults.find((v) => v.id === screen.vaultId)!}
                                go={setScreen}
                            />
                        ) : (
                            <Withdraw
                                customer={customer}
                                vault={s.vaults.find((v) => v.id === screen.vaultId)!}
                                go={setScreen}
                            />
                        )}
                    </div>
                </div>
            </div>
        </div>
    );
}

function Back({ onClick, label }: { onClick: () => void; label: string }) {
    return (
        <button
            type="button"
            onClick={onClick}
            className="mb-3 inline-flex items-center gap-1.5 text-[13px] font-medium text-blue"
        >
            <ArrowLeft className="size-4" aria-hidden /> {label}
        </button>
    );
}

function Pending({ s, customerId }: { s: Snapshot; customerId: string }) {
    const pending = s.actions.filter(
        (a) =>
            a.customerId === customerId &&
            (a.status === 'pending' || a.status === 'submitted'),
    );
    const failed = s.actions.find(
        (a) => a.customerId === customerId && a.status === 'cancelled' && a.reason,
    );

    if (pending.length === 0 && !failed) {
        return null;
    }

    return (
        <div className="space-y-2">
            {pending.map((a) => (
                <p
                    key={a.id}
                    className="flex items-center gap-2 rounded-[2px] bg-blue/10 px-3 py-2 text-[12.5px]"
                >
                    <Loader2
                        className="size-3.5 flex-none animate-spin text-blue"
                        aria-hidden
                    />
                    {a.kind === 'deposit' ? 'Your deposit' : 'Your withdrawal'} is
                    settling with GMX. It usually takes a few seconds.
                </p>
            ))}
            {failed && pending.length === 0 && (
                <p className="rounded-[2px] bg-sky/25 px-3 py-2 text-[12.5px]">
                    {failed.reason}
                </p>
            )}
        </div>
    );
}

function Home({
    s,
    customer,
    go,
}: {
    s: Snapshot;
    customer: CustomerView;
    go: (sc: Screen) => void;
}) {
    const [busy, setBusy] = useState(false);
    const [error, setError] = useState<string>();

    async function fund() {
        setBusy(true);
        setError(undefined);

        const r = await postAction({
            action: 'fund',
            customerId: customer.id,
            amount: '1000',
        });

        setBusy(false);

        if (!r.ok) {
            setError(r.message);
        }
    }

    return (
        <div className="space-y-4">
            <TourTip step="balance" block>
                {(aria) => (
                    <section className="slate p-5" {...aria}>
                        <p className="mb-1 text-[12px] text-sky">Your USDG</p>
                        <BigNumber value={customer.usdg} unit="USDG" compact />
                        <div className="mt-4 grid grid-cols-2 gap-3 text-white">
                            <div>
                                <p className="text-[11.5px] text-white/70">
                                    Earn balance
                                </p>
                                <p className="font-mono text-[17px]">
                                    {formatMoney(customer.earnBalance)}
                                </p>
                            </div>
                            <div>
                                <p className="text-[11.5px] text-white/70">
                                    Earnings to date
                                </p>
                                <p className="font-mono text-[17px]">
                                    {formatMoney(customer.earnings)}
                                </p>
                            </div>
                        </div>
                        <p className="mt-3 text-[11.5px] text-white/70">
                            ARB rewards{' '}
                            <span className="font-mono text-white">
                                {Number(customer.arbRewards).toFixed(4)}
                            </span>
                            {s.rewards.simulated &&
                                ' · simulated rewards on a local fork'}
                        </p>
                    </section>
                )}
            </TourTip>

            <Pending s={s} customerId={customer.id} />

            {s.mode === 'fork' &&
                Number(customer.usdg) === 0 &&
                customer.positions.length === 0 && (
                    <button
                        type="button"
                        onClick={fund}
                        disabled={busy}
                        className="flex w-full items-center justify-center gap-2 rounded-[2px] border border-blue/40 bg-white px-4 py-3 text-sm font-medium text-blue"
                    >
                        {busy ? (
                            <Loader2 className="size-4 animate-spin" />
                        ) : (
                            <Plus className="size-4" />
                        )}
                        Add 1,000 demo USDG
                    </button>
                )}
            {error && <p className="text-[12.5px] text-error">{error}</p>}

            <TourTip step="vaults" block>
                {(aria) => (
                    <button
                        type="button"
                        onClick={() => go({ name: 'vaults' })}
                        className="w-full rounded-[2px] bg-blue px-4 py-3 text-sm font-semibold text-white"
                        {...aria}
                    >
                        Start earning
                    </button>
                )}
            </TourTip>

            <section className="space-y-2">
                <h2 className="text-[13px] font-semibold">Your earn positions</h2>
                {customer.positions.length === 0 && (
                    <p className="text-[12.5px] text-navy-2/80">
                        Nothing in a vault yet.
                    </p>
                )}
                {customer.positions.map((p) => {
                    const vault = s.vaults.find((v) => v.id === p.vaultId)!;

                    return (
                        <div key={p.vaultId} className="tile p-3.5">
                            <div className="flex items-start justify-between gap-2">
                                <div>
                                    <p className="text-[14px] font-semibold">
                                        {vault.name}
                                    </p>
                                    <ProtocolMark vault={vault} />
                                </div>
                                <div className="text-right font-mono">
                                    <p className="text-[15px]">
                                        {formatMoney(p.value)}
                                    </p>
                                    <p className="text-[11.5px] text-navy-2/80">
                                        {formatMoney(p.earnings).startsWith('-')
                                            ? ''
                                            : '+'}
                                        {formatMoney(p.earnings)} earned
                                    </p>
                                </div>
                            </div>
                            <div className="mt-3 flex gap-2">
                                <button
                                    type="button"
                                    onClick={() =>
                                        go({ name: 'vault', vaultId: p.vaultId })
                                    }
                                    className="flex-1 rounded-[2px] border border-sky px-3 py-2 text-[13px] font-medium"
                                >
                                    Add more
                                </button>
                                <button
                                    type="button"
                                    onClick={() =>
                                        go({ name: 'withdraw', vaultId: p.vaultId })
                                    }
                                    className="flex-1 rounded-[2px] border border-sky px-3 py-2 text-[13px] font-medium"
                                >
                                    Withdraw
                                </button>
                            </div>
                        </div>
                    );
                })}
            </section>
            <p className="text-[11px] leading-4 text-navy-2/70">{HOLDING_NOTE}</p>
        </div>
    );
}

function Vaults({ s, go }: { s: Snapshot; go: (sc: Screen) => void }) {
    const vaults = [...s.vaults].sort(
        (a, b) => Number(b.isDefault ?? false) - Number(a.isDefault ?? false),
    );

    return (
        <div className="space-y-3">
            <Back onClick={() => go({ name: 'home' })} label="Home" />
            <h2 className="text-[17px] font-semibold">Choose a vault</h2>
            <p className="text-[12.5px] text-navy-2/80">
                Each vault is run by a third party. Rates are variable and set by the
                market.
            </p>
            {vaults.map((v) => (
                <VaultCard
                    key={v.id}
                    vault={v}
                    onOpen={() => go({ name: 'vault', vaultId: v.id })}
                />
            ))}
        </div>
    );
}

function VaultScreen({
    s,
    customer,
    vault,
    go,
}: {
    s: Snapshot;
    customer: CustomerView;
    vault: VaultView;
    go: (sc: Screen) => void;
}) {
    const [amount, setAmount] = useState('');
    const [reviewing, setReviewing] = useState(false);
    const [agreed, setAgreed] = useState(false);
    const [busy, setBusy] = useState(false);
    const [message, setMessage] = useState<string>();
    const accepted = customer.accepted.includes(vault.id);

    async function deposit(button: HTMLElement | null) {
        setBusy(true);
        setMessage(undefined);

        if (!accepted) {
            const r = await postAction({
                action: 'accept',
                customerId: customer.id,
                vaultId: vault.id,
            });

            if (!r.ok) {
                setBusy(false);
                setMessage(r.message);

                return;
            }
        }

        const r = await postAction({
            action: 'deposit',
            customerId: customer.id,
            vaultId: vault.id,
            amount,
        });

        setBusy(false);

        if (!r.ok) {
            setMessage(r.message);
            setReviewing(false);

            return;
        }

        announceFlight(button, vault.id, amount);
        go({ name: 'home' });
    }

    function submit(e: FormEvent<HTMLFormElement>) {
        e.preventDefault();

        if (!AMOUNT.test(amount) || Number(amount) === 0) {
            setMessage('Enter a USDG amount like 250 or 1234.50.');

            return;
        }

        setMessage(undefined);
        setReviewing(true);
    }

    return (
        <div className="space-y-4">
            <Back onClick={() => go({ name: 'vaults' })} label="Vaults" />
            <div>
                <h2 className="text-[18px] font-semibold">{vault.name}</h2>
                <p className="text-[12.5px] text-navy-2/80">
                    Curated by {vault.curator}
                </p>
                <ProtocolMark vault={vault} />
            </div>
            <section className="tile p-4">
                <div className="mb-2 flex items-baseline justify-between">
                    <span className="text-[12.5px] text-navy-2">
                        Total rate, variable
                    </span>
                    <span className="font-mono text-2xl font-medium">
                        {percent(totalRate(vault))}
                    </span>
                </div>
                <RateLines vault={vault} />
                {vault.boost && (
                    <p className="mt-2 text-[11.5px] text-navy-2/80">
                        {vault.boost.paidAs === 'claim'
                            ? 'The ARB boost comes from Arbitrum DRIP. Acme Money collects it and shares it with customers by how much and how long they held.'
                            : 'The boost is paid into the vault price by GMX, so your balance grows with it.'}
                    </p>
                )}
                {vault.programUrl && (
                    <a
                        href={vault.programUrl}
                        target="_blank"
                        rel="noreferrer"
                        className="mt-2 inline-block text-[12px] font-medium text-blue"
                    >
                        About the GMX USDG program
                    </a>
                )}
            </section>

            {!reviewing ? (
                <form onSubmit={submit} className="space-y-2">
                    <label className="block text-[12.5px] font-medium" htmlFor="amount">
                        Amount to add
                    </label>
                    <div className="flex gap-2">
                        <input
                            id="amount"
                            inputMode="decimal"
                            value={amount}
                            onChange={(e) => setAmount(e.target.value.trim())}
                            placeholder="0.00"
                            className="min-w-0 flex-1 rounded-[2px] border border-sky bg-white px-3 py-2.5 font-mono"
                        />
                        <button
                            type="button"
                            onClick={() => setAmount(customer.usdg)}
                            className="rounded-[2px] border border-sky px-3 text-[12.5px] font-medium"
                        >
                            Max
                        </button>
                    </div>
                    <p className="text-[11.5px] text-navy-2/80">
                        Available {formatAmount(customer.usdg)} USDG
                    </p>
                    <button
                        type="submit"
                        className="w-full rounded-[2px] bg-blue px-4 py-3 text-sm font-semibold text-white"
                    >
                        Review
                    </button>
                </form>
            ) : (
                <section className="space-y-3 rounded-[2px] border border-sky bg-white p-4">
                    <h3 className="text-[14px] font-semibold">
                        Add {formatAmount(amount)} USDG to {vault.name}
                    </h3>
                    <ul className="list-disc space-y-1.5 pl-4 text-[12px] leading-5 text-navy-2">
                        {[
                            ...vaultDisclosure(vault),
                            ...(accepted ? [] : COMMON_DISCLOSURE),
                        ].map((line) => (
                            <li key={line}>{line}</li>
                        ))}
                    </ul>
                    {!accepted && (
                        <label className="flex items-start gap-2 text-[12.5px]">
                            <input
                                type="checkbox"
                                checked={agreed}
                                onChange={(e) => setAgreed(e.target.checked)}
                                className="mt-0.5"
                            />
                            I understand how this vault works and its risks.
                        </label>
                    )}
                    <div className="flex gap-2">
                        <button
                            type="button"
                            onClick={() => setReviewing(false)}
                            className="flex-1 rounded-[2px] border border-sky px-3 py-2.5 text-[13px] font-medium"
                        >
                            Back
                        </button>
                        <button
                            type="button"
                            disabled={busy || (!accepted && !agreed)}
                            onClick={(e) => deposit(e.currentTarget)}
                            className="flex flex-1 items-center justify-center gap-2 rounded-[2px] bg-blue px-3 py-2.5 text-[13px] font-semibold text-white disabled:opacity-50"
                        >
                            {busy && <Loader2 className="size-4 animate-spin" />}Confirm
                        </button>
                    </div>
                    <ProtocolMark vault={vault} />
                </section>
            )}
            {message && <p className="text-[12.5px] text-error">{message}</p>}
            {s.mode === 'fork' && (
                <p className="text-[11px] text-navy-2/70">
                    Rates and boosts are live from Arbitrum One.
                </p>
            )}
        </div>
    );
}

function Withdraw({
    customer,
    vault,
    go,
}: {
    customer: CustomerView;
    vault: VaultView;
    go: (sc: Screen) => void;
}) {
    const position = customer.positions.find((p) => p.vaultId === vault.id);
    const [amount, setAmount] = useState('');
    const [busy, setBusy] = useState(false);
    const [message, setMessage] = useState<string>();

    async function withdraw(all: boolean) {
        if (!all && (!AMOUNT.test(amount) || Number(amount) === 0)) {
            setMessage('Enter a USDG amount like 250 or 1234.50.');

            return;
        }

        setBusy(true);
        setMessage(undefined);

        const r = await postAction({
            action: 'withdraw',
            customerId: customer.id,
            vaultId: vault.id,
            amount: all ? 'all' : amount,
        });

        setBusy(false);

        if (r.ok) {
            go({ name: 'home' });
        } else {
            setMessage(r.message);
        }
    }

    return (
        <div className="space-y-4">
            <Back onClick={() => go({ name: 'home' })} label="Home" />
            <h2 className="text-[18px] font-semibold">Withdraw from {vault.name}</h2>
            <p className="text-[12.5px] text-navy-2">
                You have {formatMoney(position?.value ?? '0')} USDG in this vault.
                {vault.instantLiquidity !== null &&
                    ` Up to ${formatAmount(vault.instantLiquidity.split('.')[0])} USDG can leave the vault right now.`}
                {vault.withdrawalFee
                    ? ` GMX charges ${percent(vault.withdrawalFee)} on withdrawals.`
                    : ''}
            </p>
            <input
                inputMode="decimal"
                value={amount}
                onChange={(e) => setAmount(e.target.value.trim())}
                placeholder="0.00"
                aria-label="Amount to withdraw"
                className="w-full rounded-[2px] border border-sky bg-white px-3 py-2.5 font-mono"
            />
            <div className="flex gap-2">
                <button
                    type="button"
                    disabled={busy}
                    onClick={() => withdraw(false)}
                    className="flex-1 rounded-[2px] bg-blue px-3 py-2.5 text-[13px] font-semibold text-white disabled:opacity-50"
                >
                    Withdraw amount
                </button>
                <button
                    type="button"
                    disabled={busy}
                    onClick={() => withdraw(true)}
                    className="flex-1 rounded-[2px] border border-sky px-3 py-2.5 text-[13px] font-medium disabled:opacity-50"
                >
                    Withdraw all
                </button>
            </div>
            {busy && (
                <p className="flex items-center gap-2 text-[12.5px] text-navy-2">
                    <Loader2 className="size-4 animate-spin" /> Sending
                </p>
            )}
            {message && <p className="text-[12.5px] text-error">{message}</p>}
        </div>
    );
}
