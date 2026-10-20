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

// Scopes every treasury credential needs.
export const CORE_SCOPES = [
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

// Scopes for steps Paxos enables per organization: answering travel rule
// requests on deposits, verifying wallet ownership, and adding bank accounts.
// Requesting a scope a credential lacks fails authentication, so these are
// opt in.
export const OPTIONAL_SCOPES = [
    'transfer:update_crypto_deposit',
    'transfer:read_crypto_destination_address',
    'transfer:write_fiat_account',
    'address:read_ownership_proofs',
    'address:write_ownership_proofs',
];

export function scopesFor(opts: { optional: boolean }): string[] {
    return opts.optional ? [...CORE_SCOPES, ...OPTIONAL_SCOPES] : CORE_SCOPES;
}

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
        updateCryptoDeposit: (id: string, body: Body<'UpdateCryptoDeposit'>) =>
            unwrap(
                'UpdateCryptoDeposit',
                api.POST('/transfer/crypto-deposits/{id}/update', {
                    params: { path: { id } },
                    body,
                }),
            ),
        createAddressVerification: (body: Body<'CreateVerification'>) =>
            unwrap(
                'CreateVerification',
                api.POST('/addresses/verifications', { body }),
            ),
        submitAddressVerificationSignature: (body: Body<'SubmitSignature'>) =>
            unwrap(
                'SubmitSignature',
                api.POST('/addresses/verifications/signature', { body }),
            ),
        getAddressVerification: (id: string) =>
            unwrap(
                'GetVerification',
                api.GET('/addresses/verifications/{id}', { params: { path: { id } } }),
            ),
        createFiatAccount: (body: Body<'CreateFiatAccount'>) =>
            unwrap('CreateFiatAccount', api.POST('/transfer/fiat-accounts', { body })),
        getFiatAccount: (id: string) =>
            unwrap(
                'GetFiatAccount',
                api.GET('/transfer/fiat-accounts/{id}', { params: { path: { id } } }),
            ),
        initiateSandboxFiatDeposit: (body: Body<'InitiateSandboxFiatDeposit'>) =>
            unwrap(
                'InitiateSandboxFiatDeposit',
                api.POST('/sandbox/fiat-deposits', { body }),
            ),
    };
}

export type PaxosClient = ReturnType<typeof createPaxosClient>;
