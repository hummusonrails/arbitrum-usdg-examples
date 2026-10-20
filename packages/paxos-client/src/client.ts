import createClient from 'openapi-fetch';

import { createTokenSource } from './auth.ts';
import type { components, operations, paths } from './schema.d.ts';

type Schemas = components['schemas'];
type Query<Op extends keyof operations> = NonNullable<
    operations[Op]['parameters']['query']
>;
type Body<Op extends keyof operations> = operations[Op] extends {
    requestBody: { content: { 'application/json': infer B } };
}
    ? B
    : never;

export type Orchestration = Schemas['Orchestration'];
export type Transfer = Schemas['Transfer'];
export type PaxosEvent = Schemas['Event'];

export const PAXOS_SCOPES = [
    'events:read_event',
    'funding:read_profile',
    'orchestration:read_orchestration',
    'orchestration:read_orchestration_rule',
    'orchestration:write_orchestration',
    'orchestration:write_orchestration_rule',
    'transfer:read_deposit_address',
    'transfer:read_fiat_account',
    'transfer:read_fiat_deposit_instructions',
    'transfer:read_transfer',
    'transfer:write_crypto_destination_address',
    'transfer:write_deposit_address',
    'transfer:write_sandbox_fiat_deposit',
];

export const PAXOS_ENV = {
    sandbox: {
        api: 'https://api.sandbox.paxos.com/v2',
        oauth: 'https://oauth.sandbox.paxos.com/oauth2/token',
    },
    production: {
        api: 'https://api.paxos.com/v2',
        oauth: 'https://oauth.paxos.com/oauth2/token',
    },
} as const;

export class PaxosApiError extends Error {
    constructor(
        readonly status: number,
        readonly body: unknown,
        what: string,
    ) {
        super(`Paxos ${what} failed with ${status}: ${JSON.stringify(body)}`);
        this.name = 'PaxosApiError';
    }
}

export type PaxosClientOptions = {
    apiUrl: string;
    oauthUrl: string;
    clientId: string;
    clientSecret: string;
    scopes: string[];
    fetch?: typeof globalThis.fetch;
};

export function createPaxosClient(opts: PaxosClientOptions) {
    const fetchImpl = opts.fetch ?? globalThis.fetch;
    const token = createTokenSource({ ...opts, fetch: fetchImpl });
    const api = createClient<paths>({
        baseUrl: opts.apiUrl,
        fetch: (req) => fetchImpl(req),
    });

    api.use({
        async onRequest({ request }) {
            request.headers.set('authorization', `Bearer ${await token()}`);

            return request;
        },
    });

    async function unwrap<T>(
        what: string,
        call: Promise<{ data?: T; error?: unknown; response: Response }>,
    ): Promise<T> {
        const { data, error, response } = await call;

        if (!response.ok || data === undefined) {
            throw new PaxosApiError(response.status, error ?? null, what);
        }

        return data;
    }

    return {
        listProfiles: () => unwrap('ListProfiles', api.GET('/profiles')),
        listProfileBalances: (profileId: string) =>
            unwrap(
                'ListProfileBalances',
                api.GET('/profiles/{profile_id}/balances', {
                    params: { path: { profile_id: profileId } },
                }),
            ),
        createOrchestration: (body: Body<'CreateOrchestration'>) =>
            unwrap(
                'CreateOrchestration',
                api.POST('/orchestration/orchestrations', { body }),
            ),
        getOrchestration: (id: string) =>
            unwrap(
                'GetOrchestration',
                api.GET('/orchestration/orchestrations/{id}', {
                    params: { path: { id } },
                }),
            ),
        listOrchestrations: (query: Query<'ListOrchestrations'> = {}) =>
            unwrap(
                'ListOrchestrations',
                api.GET('/orchestration/orchestrations', { params: { query } }),
            ),
        createOrchestrationRule: (body: Body<'CreateOrchestrationRule'>) =>
            unwrap(
                'CreateOrchestrationRule',
                api.POST('/orchestration/rules', { body }),
            ),
        listOrchestrationRules: (query: Query<'ListOrchestrationRules'> = {}) =>
            unwrap(
                'ListOrchestrationRules',
                api.GET('/orchestration/rules', { params: { query } }),
            ),
        getEvent: (id: string) =>
            unwrap('GetEvent', api.GET('/events/{id}', { params: { path: { id } } })),
        listEvents: (query: Query<'ListEvents'> = {}) =>
            unwrap('ListEvents', api.GET('/events', { params: { query } })),
        listTransfers: (query: Query<'ListTransfers'> = {}) =>
            unwrap(
                'ListTransfers',
                api.GET('/transfer/transfers', { params: { query } }),
            ),
        getTransfer: (id: string) =>
            unwrap(
                'GetTransfer',
                api.GET('/transfer/transfers/{id}', { params: { path: { id } } }),
            ),
        createDepositAddress: (body: Body<'CreateDepositAddress'>) =>
            unwrap(
                'CreateDepositAddress',
                api.POST('/transfer/deposit-addresses', { body }),
            ),
        listDepositAddresses: (query: Query<'ListDepositAddresses'> = {}) =>
            unwrap(
                'ListDepositAddresses',
                api.GET('/transfer/deposit-addresses', { params: { query } }),
            ),
        putCryptoDestinationAddress: (body: Body<'PutCryptoDestinationAddress'>) =>
            unwrap(
                'PutCryptoDestinationAddress',
                api.PUT('/transfer/crypto-destination-address', { body }),
            ),
        listFiatAccounts: (query: Query<'ListFiatAccounts'> = {}) =>
            unwrap(
                'ListFiatAccounts',
                api.GET('/transfer/fiat-accounts', { params: { query } }),
            ),
        listFiatDepositInstructions: (
            query: Query<'ListFiatDepositInstructions'> = {},
        ) =>
            unwrap(
                'ListFiatDepositInstructions',
                api.GET('/transfer/fiat-deposit-instructions', { params: { query } }),
            ),
        initiateSandboxFiatDeposit: (body: Body<'InitiateSandboxFiatDeposit'>) =>
            unwrap(
                'InitiateSandboxFiatDeposit',
                api.POST('/sandbox/fiat-deposits', { body }),
            ),
    };
}

export type PaxosClient = ReturnType<typeof createPaxosClient>;
