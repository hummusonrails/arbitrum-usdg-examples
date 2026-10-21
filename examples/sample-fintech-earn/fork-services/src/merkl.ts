// A local stand in for Merkl on a fork. Merkl's real service never computes
// rewards for a fork, so this one does it for the omnibus wallet: it accrues
// ARB on the wallet's Morpho vault positions at the live campaign rate (on a
// sped up clock so a short demo shows something), publishes real Merkle roots
// to the real Distributor contract on the fork, and serves the same response
// shape as Merkl's user rewards endpoint. Every other path is passed through
// to the real Merkl API.
import { createServer, type Server } from 'node:http';

import { erc20Abi, parseAbi, type Address, type Hex } from 'viem';
import { arbitrum } from 'viem/chains';

import { asAccount, forkClient, type ForkClient } from './anvil.ts';
import { buildTree } from './tree.ts';

const DISTRIBUTOR: Address = '0x3Ef3D8bA38EBe18DB133cEc108f4D14CE00Dd9Ae';
const ARB: Address = '0x912CE59144191C1204E64559FE8253a0e49E6548';
// A placeholder second leaf, so the tree always has a real proof.
const FILLER: Address = '0x000000000000000000000000000000000000dEaD';
const YEAR_SECONDS = 31_536_000;

const abi = parseAbi([
    'function accessControlManager() view returns (address)',
    'function GOVERNOR_ROLE() view returns (bytes32)',
    'function getRoleMember(bytes32 role, uint256 index) view returns (address)',
    'function setEpochDuration(uint32 epochDuration)',
    'function setDisputePeriod(uint48 disputePeriod)',
    'function updateTree((bytes32 merkleRoot, bytes32 ipfsHash) tree)',
    'function claimed(address user, address token) view returns (uint208 amount, uint48 timestamp, bytes32 merkleRoot)',
    'function balanceOf(address) view returns (uint256)',
    'function convertToAssets(uint256 shares) view returns (uint256)',
]);

export type StandInVault = { address: Address };

export type MerklStandInOptions = {
    rpcUrl: string;
    port?: number;
    omnibus: Address;
    vaults: StandInVault[];
    // Simulated seconds per real second.
    clockScale?: number;
    // Fixed reward rate (a fraction), used by tests so they do not depend on a
    // live campaign.
    fixedApr?: number;
    publishEveryMs?: number;
    upstream?: string;
};

type Rate = { apr: number; arbUsd: number };

async function governor(client: ForkClient): Promise<Address> {
    const acm = await client.readContract({
        address: DISTRIBUTOR,
        abi,
        functionName: 'accessControlManager',
    });
    const role = await client.readContract({
        address: acm,
        abi,
        functionName: 'GOVERNOR_ROLE',
    });

    return client.readContract({
        address: acm,
        abi,
        functionName: 'getRoleMember',
        args: [role, 0n],
    });
}

async function asGovernor(
    client: ForkClient,
    gov: Address,
    call: {
        functionName: 'setEpochDuration' | 'setDisputePeriod' | 'updateTree';
        args: readonly unknown[];
    },
) {
    await asAccount(client, gov, async () => {
        const hash = await client.writeContract({
            account: gov,
            chain: arbitrum,
            address: DISTRIBUTOR,
            abi,
            ...call,
        } as Parameters<typeof client.writeContract>[0]);

        await client.waitForTransactionReceipt({ hash });
    });
}

export async function startMerklStandIn(opts: MerklStandInOptions) {
    const client = forkClient(opts.rpcUrl);
    const upstream = opts.upstream ?? 'https://api.merkl.xyz';
    const scale = opts.clockScale ?? 1440;
    const gov = await governor(client);

    // With a one second epoch and no dispute period, a posted root is live at
    // once, so the fork never has to move time forward (GMX's oracle checks
    // need the fork close to live time).
    await asGovernor(client, gov, { functionName: 'setEpochDuration', args: [1] });
    await asGovernor(client, gov, { functionName: 'setDisputePeriod', args: [0] });

    const accrued = new Map<Address, number>(opts.vaults.map((v) => [v.address, 0]));
    let published = new Map<Address, bigint>(opts.vaults.map((v) => [v.address, 0n]));
    let proof: Hex[] = [];
    let root: Hex = '0x';
    let last = Date.now();
    const rates = new Map<Address, { at: number; rate: Rate }>();

    // The live (or most recent) DRIP campaign rate and ARB price for a vault.
    async function rateFor(vault: Address): Promise<Rate> {
        const cached = rates.get(vault);

        if (cached && Date.now() - cached.at < 300_000) {
            return cached.rate;
        }

        let rate: Rate = { apr: opts.fixedApr ?? 0.04, arbUsd: 0.5 };

        try {
            const opps = (await (
                await fetch(
                    `${upstream}/v4/opportunities?chainId=42161&search=${vault}`,
                )
            ).json()) as { id: string; identifier: string; apr: number }[];
            const opp = opps.find(
                (o) => o.identifier.toLowerCase() === vault.toLowerCase(),
            );

            if (opp) {
                const camps = (await (
                    await fetch(`${upstream}/v4/opportunities/${opp.id}/campaigns`)
                ).json()) as {
                    campaigns?: { rewardToken?: { symbol: string; price?: number } }[];
                };
                const price = camps.campaigns?.find(
                    (c) => c.rewardToken?.symbol === 'ARB',
                )?.rewardToken?.price;

                rate = {
                    apr: opts.fixedApr ?? (opp.apr > 0 ? opp.apr / 100 : rate.apr),
                    arbUsd: price && price > 0 ? price : rate.arbUsd,
                };
            }
        } catch (err) {
            console.error('merkl stand in: rate lookup failed, using a default', err);
        }

        rates.set(vault, { at: Date.now(), rate });

        return rate;
    }

    // Adds rewards for the time since the last call, on the omnibus wallet's
    // current positions.
    async function accrue() {
        const now = Date.now();
        const simulated = ((now - last) / 1000) * scale;

        last = now;

        for (const v of opts.vaults) {
            const shares = await client.readContract({
                address: v.address,
                abi,
                functionName: 'balanceOf',
                args: [opts.omnibus],
            });

            if (shares === 0n) {
                continue;
            }

            const assets = await client.readContract({
                address: v.address,
                abi,
                functionName: 'convertToAssets',
                args: [shares],
            });
            const { apr, arbUsd } = await rateFor(v.address);
            const usd = Number(assets) / 1e6;
            const arb = (usd * apr * simulated) / YEAR_SECONDS / arbUsd;

            accrued.set(v.address, (accrued.get(v.address) ?? 0) + arb);
        }
    }

    const wei = (arb: number) => BigInt(Math.floor(arb * 1e6)) * 10n ** 12n;

    // Moves everything accrued so far into a new root on the Distributor.
    async function publish() {
        await accrue();

        const next = new Map<Address, bigint>();
        let total = 0n;

        for (const v of opts.vaults) {
            const amount = wei(accrued.get(v.address) ?? 0);

            next.set(v.address, amount);
            total += amount;
        }

        if (total === 0n) {
            return;
        }

        const tree = buildTree([
            { user: opts.omnibus, token: ARB, amount: total },
            { user: FILLER, token: ARB, amount: 1n },
        ]);
        const balance = await client.readContract({
            address: ARB,
            abi: erc20Abi,
            functionName: 'balanceOf',
            args: [DISTRIBUTOR],
        });

        if (balance < total) {
            throw new Error(
                'The Merkl Distributor on the fork holds too little ARB to pay out',
            );
        }

        await asGovernor(client, gov, {
            functionName: 'updateTree',
            args: [{ merkleRoot: tree.root, ipfsHash: `0x${'0'.repeat(64)}` }],
        });
        published = next;
        proof = tree.proofs[0]!;
        root = tree.root;
    }

    async function userRewards(address: string) {
        if (address.toLowerCase() !== opts.omnibus.toLowerCase()) {
            return [];
        }

        await accrue();

        const [claimed] = await client.readContract({
            address: DISTRIBUTOR,
            abi,
            functionName: 'claimed',
            args: [opts.omnibus, ARB],
        });
        const breakdowns = opts.vaults.map((v) => {
            const amount = published.get(v.address) ?? 0n;
            const all = wei(accrued.get(v.address) ?? 0);

            return {
                reason: `ERC20_${v.address}`,
                amount: amount.toString(),
                claimed: '0',
                pending: (all > amount ? all - amount : 0n).toString(),
            };
        });
        const amount = [...published.values()].reduce((s, a) => s + a, 0n);
        const pending = breakdowns.reduce((s, b) => s + BigInt(b.pending), 0n);

        return [
            {
                chain: { id: 42161 },
                rewards: [
                    {
                        root,
                        recipient: opts.omnibus,
                        token: { address: ARB, symbol: 'ARB', decimals: 18 },
                        amount: amount.toString(),
                        claimed: claimed.toString(),
                        pending: pending.toString(),
                        proofs: proof,
                        breakdowns,
                    },
                ],
            },
        ];
    }

    const server: Server = createServer(async (req, res) => {
        try {
            const url = new URL(req.url ?? '/', 'http://local');
            const match = url.pathname.match(
                /^\/v4\/users\/(0x[0-9a-fA-F]{40})\/rewards\/?$/,
            );

            if (req.method === 'POST' && url.pathname === '/publish') {
                await publish();
                res.writeHead(200, { 'content-type': 'application/json' });
                res.end(JSON.stringify({ ok: true, root }));

                return;
            }

            if (match) {
                res.writeHead(200, { 'content-type': 'application/json' });
                res.end(JSON.stringify(await userRewards(match[1]!)));

                return;
            }

            const passthrough = await fetch(`${upstream}${url.pathname}${url.search}`);

            res.writeHead(passthrough.status, { 'content-type': 'application/json' });
            res.end(await passthrough.text());
        } catch (err) {
            console.error('merkl stand in', err);
            res.writeHead(500, { 'content-type': 'application/json' });
            res.end(JSON.stringify({ error: 'merkl stand in failed' }));
        }
    });

    await new Promise<void>((r) => server.listen(opts.port ?? 4020, '127.0.0.1', r));

    const timer = setInterval(
        () =>
            void publish().catch((err) => console.error('merkl stand in publish', err)),
        opts.publishEveryMs ?? 30_000,
    );

    return {
        url: `http://127.0.0.1:${opts.port ?? 4020}`,
        publish,
        async close() {
            clearInterval(timer);
            await new Promise((r) => server.close(r));
        },
    };
}
