// Client credentials token for the Paxos v2 API, cached until 60 seconds
// before it expires.
export type TokenSource = () => Promise<string>;

const REFRESH_MARGIN_MS = 60_000;

export function createTokenSource(opts: {
    oauthUrl: string;
    clientId: string;
    clientSecret: string;
    scopes: string[];
    fetch: typeof globalThis.fetch;
}): TokenSource {
    let token: { value: string; expiresAt: number } | undefined;
    let inflight: Promise<string> | undefined;

    async function request(): Promise<string> {
        const res = await opts.fetch(opts.oauthUrl, {
            method: 'POST',
            headers: { 'content-type': 'application/x-www-form-urlencoded' },
            body: new URLSearchParams({
                grant_type: 'client_credentials',
                client_id: opts.clientId,
                client_secret: opts.clientSecret,
                scope: opts.scopes.join(' '),
            }),
        });

        if (!res.ok) {
            throw new Error(
                `Paxos authentication failed (${res.status}): ${await res.text()}`,
            );
        }

        const json = (await res.json()) as { access_token: string; expires_in: number };

        token = {
            value: json.access_token,
            expiresAt: Date.now() + json.expires_in * 1000,
        };

        return json.access_token;
    }

    return async () => {
        if (token && Date.now() < token.expiresAt - REFRESH_MARGIN_MS) {
            return token.value;
        }

        inflight ??= request().finally(() => {
            inflight = undefined;
        });

        return inflight;
    };
}
