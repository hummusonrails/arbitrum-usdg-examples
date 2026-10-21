// What each part of the demo does, written for a builder learning the flow.
export type Guide = {
    title: string;
    body: string;
    calls: string[];
    watch: string;
};

export type TourStep = 'balance' | 'vaults' | 'positions' | 'books' | 'rewards';

// Which half of the page each step points at, so narrow screens can switch to it.
export const TOUR: { step: TourStep; side: 'customer' | 'console' }[] = [
    { step: 'balance', side: 'customer' },
    { step: 'vaults', side: 'customer' },
    { step: 'positions', side: 'console' },
    { step: 'books', side: 'console' },
    { step: 'rewards', side: 'console' },
];

export const GUIDES: Record<TourStep, Guide> = {
    balance: {
        title: 'A customer of Acme Money',
        body: 'This phone is what one Acme Money customer sees. Switch between three demo customers at the top. On the local fork, add demo USDG to give a customer a balance to work with.',
        calls: [
            'USDG transfer on the fork into the omnibus wallet',
            "Acme's ledger credits the customer",
        ],
        watch: 'The omnibus wallet on the console grows, and USDG owed to customers rises to match it.',
    },
    vaults: {
        title: 'Pick a vault and deposit',
        body: 'Each vault shows its own variable rate and its incentive boost separately, with the boost token and end date. The first deposit into a vault asks the customer to read and accept its risks.',
        calls: [
            'Morpho: USDG approve, then vault.deposit(assets, omnibus)',
            'GMX: GlvRouter.multicall(sendWnt, sendTokens, createGlvDeposit)',
        ],
        watch: 'A tile flies to the vault on the console. GMX deposits wait a few seconds for the keeper before they count.',
    },
    positions: {
        title: 'One wallet holds every customer',
        body: 'Acme Money holds all vault shares in one omnibus wallet and keeps each customer’s share of them in its own books. Gates, liquidity, and the keeper are checked before every action.',
        calls: [
            'vault.balanceOf(omnibus), convertToAssets, canReceiveShares',
            'Morpho API: rates and withdrawable liquidity',
            'GMX API: GLV price and rate',
        ],
        watch: 'Shares and value update as soon as each deposit or withdrawal settles on chain.',
    },
    books: {
        title: 'The books match the chain',
        body: 'Customer shares in each vault must add up to what the omnibus wallet holds onchain, the USDG owed to customers must be in the wallet, and rewards shared must never exceed rewards claimed.',
        calls: ['Acme ledger totals', 'Onchain balances of the omnibus wallet'],
        watch: 'Every rule shows Matched with both numbers side by side. Drift would light red.',
    },
    rewards: {
        title: 'Share the ARB boost fairly',
        body: 'Merkl credits the Morpho vault boost to the omnibus wallet, because it holds the shares. Acme Money claims it and shares it by how many shares each customer held, and for how long.',
        calls: [
            'GET /v4/users/{omnibus}/rewards on Merkl',
            'Distributor.claim(users, tokens, amounts, proofs)',
        ],
        watch: 'Claimed ARB lands in the omnibus wallet and appears against each customer. On the fork the rewards are simulated.',
    },
};
