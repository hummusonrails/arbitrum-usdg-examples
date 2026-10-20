// A local stand in for the parts of the Paxos v2 API the treasury example
// calls. Response shapes follow responses captured from the Paxos sandbox
// (see ../fixtures). Crypto legs move real USDG on an Anvil fork.
import { randomUUID } from 'node:crypto';
import { createServer, type IncomingMessage, type ServerResponse } from 'node:http';
import type { AddressInfo } from 'node:net';

import { fromUnits, toUnits } from '@arbitrum-usdg/usdg';
import { getAddress, isAddress, verifyMessage, type Address, type Hex } from 'viem';
import { generatePrivateKey, privateKeyToAccount } from 'viem/accounts';

import { createForkChain } from './chain.ts';

type Json = Record<string, unknown>;
type Status = 'PENDING' | 'PROCESSING' | 'COMPLETED' | 'FAILED' | 'REJECTED';

type Transfer = Json & {
    id: string;
    status: 'PENDING' | 'COMPLETED' | 'FAILED';
    type: string;
};
type Orchestration = Json & { id: string; ref_id: string; status: Status };
type PaxosEvent = {
    id: string;
    type: string;
    object_type: string;
    object: Json;
    created_at: string;
};

export type MockPaxosOptions = {
    port: number;
    rpcUrl: string;
    profileId: string;
    webhookUrl?: string;
    webhookApiKey?: string;
    pollMs?: number;
    stepMs?: number;
};

const now = () => new Date().toISOString();
const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));

export async function startMockPaxos(opts: MockPaxosOptions) {
    const chain = createForkChain(opts.rpcUrl);
    const stepMs = opts.stepMs ?? 500;
    const customerId = randomUUID();
    const identityId = randomUUID();
    const balances = new Map<string, bigint>([
        ['USD', toUnits('1000000')],
        ['USDG', toUnits('0')],
    ]);
    const orchestrations = new Map<string, Orchestration>();
    const transfers = new Map<string, Transfer>();
    const rules = new Map<string, Json>();
    const depositAddresses = new Map<string, Json>();
    const destinations = new Map<string, Json>();
    const fiatAccounts = new Map<string, Json>();
    const verifications = new Map<
        string,
        Json & { message: string; address: string }
    >();
    const events: PaxosEvent[] = [];
    const seenLogs = new Set<string>();
    const failNext = new Set<'redeem' | 'mint'>();
    const tamperNext = new Set<'mint'>();
    let watchedFrom = await chain.blockNumber();

    function credit(asset: string, units: bigint) {
        balances.set(asset, (balances.get(asset) ?? 0n) + units);
    }

    function emit(type: string, object: Json) {
        const event: PaxosEvent = {
            id: randomUUID(),
            type,
            object_type: type.startsWith('orchestration.status_details')
                ? 'orchestration_status_details_change'
                : type.startsWith('orchestration')
                  ? 'orchestration_status_change'
                  : 'transfer_status_change',
            object,
            created_at: now(),
        };

        events.push(event);

        if (opts.webhookUrl) {
            // Webhooks carry metadata only; receivers fetch the event back.
            fetch(opts.webhookUrl, {
                method: 'POST',
                headers: {
                    'content-type': 'application/json',
                    ...(opts.webhookApiKey ? { 'x-api-key': opts.webhookApiKey } : {}),
                },
                body: JSON.stringify({
                    id: event.id,
                    type,
                    source: 'com.paxos',
                    time: event.created_at,
                    object: 'event',
                    is_test: false,
                }),
            }).catch(() => {});
        }
    }

    function transferEvent(t: Transfer) {
        const kind = String(t.type).toLowerCase();

        emit(`transfer.${kind}.${t.status.toLowerCase()}`, {
            id: t.id,
            type: t.type,
            status: t.status,
            profile_id: opts.profileId,
            ref_id: t.ref_id,
            crypto_network: t.crypto_network,
            crypto_tx_hash: t.crypto_tx_hash,
        });
    }

    function orchestrationEvent(o: Orchestration) {
        emit(`orchestration.${o.status.toLowerCase()}`, {
            id: o.id,
            ref_id: o.ref_id,
            status: o.status,
            orchestration_rule_id: o.orchestration_rule_id,
        });
    }

    function newTransfer(
        fields: Json & { type: string; amount: string; asset: string },
    ): Transfer {
        const t: Transfer = {
            id: randomUUID(),
            customer_id: customerId,
            profile_id: opts.profileId,
            ref_id: randomUUID(),
            total: fields.amount,
            fee: '0',
            balance_asset: fields.asset,
            status: 'PENDING',
            created_at: now(),
            updated_at: now(),
            auto_conversion: {},
            notional_value: fields.amount,
            ...fields,
        };

        transfers.set(t.id, t);
        transferEvent(t);

        return t;
    }

    function settle(t: Transfer, status: Transfer['status'], extra: Json = {}) {
        Object.assign(t, extra, { status, updated_at: now() });
        transferEvent(t);
    }

    function setStatus(o: Orchestration, status: Status, extra: Json = {}) {
        Object.assign(o, extra, { status, updated_at: now() });
        orchestrationEvent(o);
    }

    async function runOrchestration(o: Orchestration) {
        const source = o.source_asset as string;
        const amount = toUnits(o.source_amount as string);
        const destination = o.destination as Json;
        const crypto = destination.crypto as
            { address: Address; network: string } | undefined;
        const fiat = destination.fiat as { bank_account_id: string } | undefined;

        await sleep(stepMs);
        setStatus(o, 'PROCESSING', {
            status_details: {
                conversion_in_progress: {
                    message: 'The source asset is being converted.',
                    awaiting_action_from: 'AWAITING_ACTION_FROM_PAXOS',
                },
            },
        });

        if ((balances.get(source) ?? 0n) < amount) {
            setStatus(o, 'FAILED', {
                fail_reason: { detail: `insufficient ${source} balance` },
            });

            return;
        }

        credit(source, -amount);

        if (crypto) {
            const t = newTransfer({
                type: 'CRYPTO_WITHDRAWAL',
                direction: 'DEBIT',
                amount: o.source_amount as string,
                asset: 'USDG',
                destination_address: crypto.address,
                crypto_network: crypto.network,
                ref_id: o.ref_id,
            });

            o.destination_transfer = { transfer_id: t.id, status: 'PENDING' };

            if (failNext.delete('mint')) {
                credit(source, amount);
                settle(t, 'FAILED', {
                    secondary_status: {
                        name: 'TRAVEL_RULE_REJECTED',
                        detail: 'This transfer was rejected due to failing travel rule checks.',
                    },
                });
                setStatus(o, 'FAILED', {
                    status_details: {
                        destination_transfer_failed: {
                            message: 'The destination transfer failed.',
                            transfer_id: t.id,
                        },
                    },
                });

                return;
            }

            let hash: Hex;

            try {
                hash = await chain.send(getAddress(crypto.address), amount);
            } catch (err) {
                credit(source, amount);
                settle(t, 'FAILED');
                setStatus(o, 'FAILED', {
                    fail_reason: {
                        detail: `withdrawal failed: ${String(err).slice(0, 200)}`,
                    },
                    status_details: {
                        destination_transfer_failed: {
                            message: 'The destination transfer failed.',
                            transfer_id: t.id,
                        },
                    },
                });

                return;
            }

            const reported = tamperNext.delete('mint')
                ? fromUnits(amount + toUnits('0.5'))
                : (o.source_amount as string);

            settle(t, 'COMPLETED', {
                crypto_tx_hash: hash,
                crypto_tx_index: '0',
                amount: reported,
                total: reported,
            });
            o.destination_transfer = { transfer_id: t.id, status: 'COMPLETED' };
            setStatus(o, 'COMPLETED', { status_details: undefined });

            return;
        }

        if (fiat) {
            const bank = fiatAccounts.get(fiat.bank_account_id);

            if (!bank || bank.status !== 'APPROVED' || failNext.delete('redeem')) {
                credit(source, amount);
                setStatus(o, 'FAILED', {
                    status_details: {
                        destination_transfer_failed: {
                            message: bank
                                ? 'The bank transfer could not be completed.'
                                : 'Unknown bank account.',
                        },
                    },
                });

                return;
            }

            const t = newTransfer({
                type: 'WIRE_WITHDRAWAL',
                direction: 'DEBIT',
                amount: o.source_amount as string,
                asset: 'USD',
                fiat_account_id: fiat.bank_account_id,
                ref_id: o.ref_id,
            });

            o.destination_transfer = { transfer_id: t.id, status: 'PENDING' };
            await sleep(stepMs);
            settle(t, 'COMPLETED');
            o.destination_transfer = { transfer_id: t.id, status: 'COMPLETED' };
            setStatus(o, 'COMPLETED', { status_details: undefined });

            return;
        }

        credit(o.destination_asset as string, amount);
        setStatus(o, 'COMPLETED', { status_details: undefined });
    }

    function startOrchestration(body: Json, ruleId?: string): Orchestration {
        const o: Orchestration = {
            id: randomUUID(),
            profile_id: opts.profileId,
            customer_id: customerId,
            ref_id: (body.ref_id as string) ?? `orchestration_id.${randomUUID()}`,
            source_asset: body.source_asset,
            destination_asset: body.destination_asset,
            source_amount: body.source_amount,
            status: 'PENDING',
            source: body.source,
            destination: body.destination,
            created_at: now(),
            updated_at: now(),
            ...(ruleId ? { orchestration_rule_id: ruleId } : {}),
        };

        orchestrations.set(o.id, o);
        orchestrationEvent(o);
        runOrchestration(o).catch((err) =>
            setStatus(o, 'FAILED', { fail_reason: { detail: String(err) } }),
        );

        return o;
    }

    // Turns on-chain USDG arriving at a Paxos deposit address into a deposit
    // that waits for travel rule details, as the sandbox does.
    async function watchDeposits() {
        const head = await chain.blockNumber();
        const watched = [...depositAddresses.values()].map((a) => a.address as Address);
        const seen = await chain.transfersTo(watched, watchedFrom, head);

        watchedFrom = head + 1n;

        for (const log of seen) {
            const key = `${log.hash}:${log.index}`;

            if (seenLogs.has(key)) {
                continue;
            }

            seenLogs.add(key);
            newTransfer({
                type: 'CRYPTO_DEPOSIT',
                direction: 'CREDIT',
                amount: fromUnits(log.value),
                asset: 'USDG',
                identity_id: identityId,
                destination_address: log.to,
                crypto_network: 'ARBITRUM_ONE',
                crypto_tx_hash: log.hash,
                crypto_tx_index: String(log.index),
                secondary_status: {
                    name: 'TRAVEL_RULE_INFO_REQUESTED',
                    detail: 'This transaction needs extra information to be processed.',
                },
            });
        }
    }

    const watcher = setInterval(() => {
        watchDeposits().catch(() => {});
    }, opts.pollMs ?? 1000);

    function problem(
        res: ServerResponse,
        status: number,
        title: string,
        extra: Json = {},
    ) {
        send(res, status, { type: 'about:blank', title, status, ...extra });
    }

    function send(res: ServerResponse, status: number, body: unknown) {
        res.writeHead(status, { 'content-type': 'application/json' });
        res.end(JSON.stringify(body));
    }

    async function readBody(req: IncomingMessage): Promise<Json> {
        const chunks: Buffer[] = [];

        for await (const c of req) {
            chunks.push(c as Buffer);
        }

        const text = Buffer.concat(chunks).toString();

        if (!text) {
            return {};
        }

        if (
            (req.headers['content-type'] ?? '').includes(
                'application/x-www-form-urlencoded',
            )
        ) {
            return Object.fromEntries(new URLSearchParams(text));
        }

        return JSON.parse(text) as Json;
    }

    function listByCreated<T extends Json>(items: T[], q: URLSearchParams): T[] {
        const gte = q.get('created_at.gte');
        const gt = q.get('created_at.gt');

        return items.filter(
            (x) =>
                (!gte || String(x.created_at) >= gte) &&
                (!gt || String(x.created_at) > gt),
        );
    }

    type Handler = (args: {
        req: IncomingMessage;
        res: ServerResponse;
        q: URLSearchParams;
        params: string[];
    }) => Promise<void> | void;

    const routes: [string, RegExp, Handler][] = [
        [
            'POST',
            /^\/oauth2\/token$/,
            async ({ req, res }) => {
                const body = await readBody(req);

                send(res, 200, {
                    access_token: randomUUID(),
                    expires_in: 3599,
                    scope: body.scope ?? '',
                    token_type: 'bearer',
                });
            },
        ],
        [
            'GET',
            /^\/v2\/profiles$/,
            ({ res }) =>
                send(res, 200, {
                    items: [
                        { id: opts.profileId, nickname: 'default', type: 'DEFAULT' },
                    ],
                }),
        ],
        [
            'GET',
            /^\/v2\/profiles\/([^/]+)\/balances$/,
            ({ res }) =>
                send(res, 200, {
                    items: [...balances].map(([asset, units]) => ({
                        asset,
                        available: fromUnits(units),
                        trading: '0',
                    })),
                }),
        ],
        [
            'POST',
            /^\/v2\/orchestration\/orchestrations$/,
            async ({ req, res }) => {
                const body = await readBody(req);
                const existing = [...orchestrations.values()].find(
                    (o) => o.ref_id === body.ref_id,
                );

                if (existing) {
                    problem(res, 409, 'Already Exists', { meta: { existing } });

                    return;
                }

                send(res, 200, startOrchestration(body));
            },
        ],
        [
            'GET',
            /^\/v2\/orchestration\/orchestrations$/,
            ({ res, q }) => {
                const refIds = q.getAll('ref_id');
                const items = [...orchestrations.values()]
                    .filter((o) => refIds.length === 0 || refIds.includes(o.ref_id))
                    .reverse()
                    .slice(0, Number(q.get('limit') ?? 100));

                send(res, 200, { items });
            },
        ],
        [
            'GET',
            /^\/v2\/orchestration\/orchestrations\/([^/]+)$/,
            ({ res, params }) => {
                const o = orchestrations.get(params[0]!);

                return o ? send(res, 200, o) : problem(res, 404, 'Not Found');
            },
        ],
        [
            'POST',
            /^\/v2\/orchestration\/rules$/,
            async ({ req, res }) => {
                const body = await readBody(req);
                const rule = {
                    id: randomUUID(),
                    ref_id: body.ref_id,
                    nickname: body.nickname,
                    profile_id: opts.profileId,
                    source_asset: body.source_asset,
                    destination_asset: body.destination_asset,
                    source: {
                        fiat: {
                            ...((body.source as Json).fiat as Json),
                            deposit_instructions_id: randomUUID(),
                            memo_id: randomUUID()
                                .replace(/-/g, '')
                                .slice(0, 16)
                                .toUpperCase(),
                        },
                    },
                    destination: body.destination,
                    status: 'ACTIVE',
                    created_at: now(),
                };

                rules.set(rule.id, rule);
                send(res, 200, { rule });
            },
        ],
        [
            'GET',
            /^\/v2\/orchestration\/rules$/,
            ({ res }) => send(res, 200, { items: [...rules.values()] }),
        ],
        [
            'GET',
            /^\/v2\/events$/,
            ({ res, q }) => {
                const type = q.get('type');
                const items = listByCreated(events as unknown as Json[], q).filter(
                    (e) => !type || e.type === type,
                );
                const ordered =
                    q.get('order') === 'DESC' ? [...items].reverse() : items;

                send(res, 200, {
                    events: ordered.slice(0, Number(q.get('limit') ?? 100)),
                    next_page_cursor: '',
                });
            },
        ],
        [
            'GET',
            /^\/v2\/events\/([^/]+)$/,
            ({ res, params }) => {
                const e = events.find((x) => x.id === params[0]);

                return e
                    ? send(res, 200, { ...e, undelivered_webhooks: 0 })
                    : problem(res, 404, 'Not Found');
            },
        ],
        [
            'GET',
            /^\/v2\/transfer\/transfers$/,
            ({ res, q }) => {
                const hashes = q.getAll('crypto_tx_hashes').map((h) => h.toLowerCase());
                const items = [...transfers.values()].filter(
                    (t) =>
                        hashes.length === 0 ||
                        hashes.includes(String(t.crypto_tx_hash).toLowerCase()),
                );

                send(res, 200, { items, next_page_cursor: '' });
            },
        ],
        [
            'GET',
            /^\/v2\/transfer\/transfers\/([^/]+)$/,
            ({ res, params }) => {
                const t = transfers.get(params[0]!);

                return t ? send(res, 200, t) : problem(res, 404, 'Not Found');
            },
        ],
        [
            'POST',
            /^\/v2\/transfer\/crypto-deposits\/([^/]+)\/update$/,
            async ({ req, res, params }) => {
                const body = await readBody(req);
                const t = transfers.get(params[0]!);

                if (!t) {
                    problem(res, 404, 'Not Found');

                    return;
                }

                if (!t.secondary_status) {
                    problem(res, 409, 'Deposit does not need info');

                    return;
                }

                const info = body.originator_address_info as Json | undefined;

                if (!body.identity_id || !info) {
                    problem(res, 400, 'Bad Request', {
                        detail: 'identity_id and originator_address_info are required',
                    });

                    return;
                }

                delete t.secondary_status;
                send(res, 200, t);
                await sleep(stepMs);
                credit('USDG', toUnits(t.amount as string));
                settle(t, 'COMPLETED');
            },
        ],
        [
            'POST',
            /^\/v2\/transfer\/deposit-addresses$/,
            async ({ req, res }) => {
                const body = await readBody(req);
                const address = privateKeyToAccount(generatePrivateKey()).address;
                const record = {
                    id: randomUUID(),
                    profile_id: opts.profileId,
                    customer_id: customerId,
                    crypto_network: body.crypto_network,
                    identity_id: identityId,
                    ref_id: body.ref_id,
                    address,
                    conversion_target_asset:
                        body.conversion_target_asset ?? 'NO_CONVERSION',
                    compatible_crypto_networks: ['ARBITRUM_ONE'],
                    created_at: now(),
                };

                depositAddresses.set(record.id, record);
                send(res, 200, record);
            },
        ],
        [
            'GET',
            /^\/v2\/transfer\/deposit-addresses$/,
            ({ res }) => send(res, 200, { items: [...depositAddresses.values()] }),
        ],
        [
            'PUT',
            /^\/v2\/transfer\/crypto-destination-address$/,
            async ({ req, res }) => {
                const body = await readBody(req);
                const metadata = body.travelrule_metadata as Json | undefined;

                if (!metadata?.beneficiary) {
                    problem(res, 400, 'Bad Request', {
                        detail: 'failed request validation: beneficiary must be specified',
                    });

                    return;
                }

                const address = {
                    id: randomUUID(),
                    crypto_network: body.crypto_network,
                    address: body.address,
                    nickname: body.nickname,
                    status: 'APPROVED',
                    created_at: now(),
                    bookmarked: body.bookmarked_status === true,
                    travelrule_metadata: metadata,
                };

                destinations.set(String(body.address).toLowerCase(), address);
                send(res, 200, { address });
            },
        ],
        [
            'POST',
            /^\/v2\/transfer\/fiat-accounts$/,
            async ({ req, res }) => {
                const body = await readBody(req);
                const account = {
                    id: randomUUID(),
                    ref_id: body.ref_id,
                    identity_id: identityId,
                    fiat_network_instructions: body.fiat_network_instructions,
                    status: 'APPROVED',
                    created_at: now(),
                };

                fiatAccounts.set(account.id, account);
                send(res, 200, account);
            },
        ],
        [
            'GET',
            /^\/v2\/transfer\/fiat-accounts$/,
            ({ res }) => send(res, 200, { items: [...fiatAccounts.values()] }),
        ],
        [
            'GET',
            /^\/v2\/transfer\/fiat-accounts\/([^/]+)$/,
            ({ res, params }) => {
                const a = fiatAccounts.get(params[0]!);

                return a ? send(res, 200, a) : problem(res, 404, 'Not Found');
            },
        ],
        [
            'GET',
            /^\/v2\/transfer\/fiat-deposit-instructions$/,
            ({ res }) =>
                send(res, 200, {
                    items: [...rules.values()].map((r) => ({
                        id: ((r.source as Json).fiat as Json).deposit_instructions_id,
                        profile_id: opts.profileId,
                        identity_id: identityId,
                        status: 'VALID',
                        memo_id: ((r.source as Json).fiat as Json).memo_id,
                        created_at: r.created_at,
                    })),
                }),
        ],
        [
            'POST',
            /^\/v2\/sandbox\/fiat-deposits$/,
            async ({ req, res }) => {
                const body = await readBody(req);
                const amount = String(body.amount);

                if (!/^[0-9]*\.?[0-9]{1,2}$/.test(amount)) {
                    problem(res, 400, 'Bad Request', {
                        detail: 'amount must have at most 2 decimals',
                    });

                    return;
                }

                send(res, 200, {});

                const t = newTransfer({
                    type: 'WIRE_DEPOSIT',
                    direction: 'CREDIT',
                    amount,
                    asset: 'USD',
                });

                await sleep(stepMs);
                credit('USD', toUnits(amount));
                settle(t, 'COMPLETED');

                const rule = [...rules.values()].find(
                    (r) => ((r.source as Json).fiat as Json).memo_id === body.memo_id,
                );

                if (rule) {
                    startOrchestration(
                        {
                            source_asset: 'USD',
                            destination_asset: rule.destination_asset,
                            source_amount: amount,
                            source: { profile: { profile_id: opts.profileId } },
                            destination: rule.destination,
                        },
                        rule.id as string,
                    );
                }
            },
        ],
        [
            'POST',
            /^\/v2\/addresses\/verifications$/,
            async ({ req, res }) => {
                const body = await readBody(req);
                const id = randomUUID();
                const message = `Paxos address ownership verification ${id} for ${body.address}`;
                const record = {
                    id,
                    ref_id: body.ref_id,
                    network: body.network,
                    address: String(body.address),
                    verification_method: 'SIGNATURE',
                    status: 'PENDING',
                    signature_verification: { message },
                    message,
                    created_at: now(),
                };

                verifications.set(id, record);
                send(res, 200, { ...record, message: undefined });
            },
        ],
        [
            'POST',
            /^\/v2\/addresses\/verifications\/signature$/,
            async ({ req, res }) => {
                const body = await readBody(req);
                const v = verifications.get(String(body.id));

                if (!v) {
                    problem(res, 404, 'Not Found');

                    return;
                }

                const valid =
                    isAddress(v.address) &&
                    (await verifyMessage({
                        address: v.address as Address,
                        message: v.message,
                        signature: body.signature as Hex,
                    }).catch(() => false));

                v.status = valid ? 'APPROVED' : 'REJECTED';
                send(res, 200, { ...v, message: undefined });
            },
        ],
        [
            'GET',
            /^\/v2\/addresses\/verifications\/([^/]+)$/,
            ({ res, params }) => {
                const v = verifications.get(params[0]!);

                return v
                    ? send(res, 200, { ...v, message: undefined })
                    : problem(res, 404, 'Not Found');
            },
        ],
        // Test controls, not part of the Paxos API.
        [
            'POST',
            /^\/mock\/fail-next$/,
            async ({ req, res }) => {
                const body = await readBody(req);

                failNext.add(body.kind === 'mint' ? 'mint' : 'redeem');
                send(res, 200, { ok: true });
            },
        ],
        [
            'POST',
            /^\/mock\/tamper-next$/,
            ({ res }) => {
                tamperNext.add('mint');
                send(res, 200, { ok: true });
            },
        ],
        [
            'GET',
            /^\/mock\/state$/,
            ({ res }) =>
                send(res, 200, {
                    balances: Object.fromEntries(
                        [...balances].map(([a, u]) => [a, fromUnits(u)]),
                    ),
                    orchestrations: orchestrations.size,
                    transfers: transfers.size,
                    destinations: destinations.size,
                }),
        ],
    ];

    const server = createServer(async (req, res) => {
        const url = new URL(req.url ?? '/', 'http://mock');

        try {
            for (const [method, pattern, handler] of routes) {
                const m = url.pathname.match(pattern);

                if (m && req.method === method) {
                    await handler({
                        req,
                        res,
                        q: url.searchParams,
                        params: m.slice(1),
                    });

                    return;
                }
            }

            problem(res, 404, 'Not Found', { detail: `${req.method} ${url.pathname}` });
        } catch (err) {
            if (!res.headersSent) {
                problem(res, 500, 'Internal Error', { detail: String(err) });
            }
        }
    });

    await new Promise<void>((resolve) =>
        server.listen(opts.port, '127.0.0.1', resolve),
    );

    const { port } = server.address() as AddressInfo;

    return {
        url: `http://127.0.0.1:${port}`,
        async close() {
            clearInterval(watcher);
            await new Promise<void>((resolve) => server.close(() => resolve()));
        },
    };
}
