// The Building with USDG on Arbitrum guide, written once and shown in every
// sample app and in the repository README. Links use [text](url) so the same
// strings render as Markdown and as React.

export const USDG_PAGE = 'https://arbitrum.io/products/usdg-on-arbitrum';
export const CONTACT = `${USDG_PAGE}#contact-form`;

export const TITLE = 'Building with USDG on Arbitrum';

export const INTRO =
    'USDG, the Global Dollar issued by Paxos, is minted natively on Arbitrum One and backed 1:1. Use one dollar across trading, lending, payments, and treasury, with ecosystem programs available to eligible businesses that build with it.';

export type PathKey = 'earn' | 'trading' | 'markets' | 'treasury';

// The four ways a business can put USDG to work, as the USDG on Arbitrum
// program describes them.
export const PATHS: { key: PathKey; title: string; body: string }[] = [
    {
        key: 'earn',
        title: 'Embedded earn',
        body: 'Connect your app to third party USDG vaults and offer customers a simple earn experience.',
    },
    {
        key: 'trading',
        title: 'Trading and collateral',
        body: 'Let your users put USDG to work as margin for perpetual markets.',
    },
    {
        key: 'markets',
        title: 'Markets and settlement',
        body: 'Use USDG as a quote and settlement currency across spot and perpetual markets, DEX pools, and supported RWA issuance, minting, and redemption flows.',
    },
    {
        key: 'treasury',
        title: 'Treasury operations',
        body: 'Hold reserve balances, collect protocol fees, run payroll, and support cross border payments in one dollar.',
    },
];

export type StrengthKey =
    'native' | 'programmable' | 'rewards' | 'chains' | 'defi' | 'automation';

// What builders get on Arbitrum, from the Paxos docs and the USDG contract.
export const STRENGTHS: { key: StrengthKey; title: string; body: string }[] = [
    {
        key: 'native',
        title: 'Native on Arbitrum One',
        body: 'Paxos mints USDG directly on Arbitrum One. One Paxos API call turns US dollars into USDG delivered to any Arbitrum wallet, and redeems it back to a bank 1:1.',
    },
    {
        key: 'programmable',
        title: 'Programmable dollars',
        body: 'USDG supports signed transfers (EIP-3009) and permits (EIP-2612), including batches of signed transfers in one transaction. That opens gasless checkouts, scheduled payouts, and payroll runs signed once and settled together.',
    },
    {
        key: 'rewards',
        title: 'Rewards built into the token',
        body: 'The Global Dollar Network rewards engine lives in the USDG contract itself. Eligible partners can register wallets into payout groups, and smart contracts such as vaults and pools can join through an onchain propose and accept flow.',
    },
    {
        key: 'chains',
        title: 'Connected across chains',
        body: 'USDG moves between Arbitrum and Ethereum through LayerZero, and Paxos can deliver it on many networks from one balance.',
    },
    {
        key: 'defi',
        title: 'Already live in DeFi',
        body: "USDG is live in leading Arbitrum protocols, including GMX markets and the GMX Dollar Vault, Morpho vaults, Fluid, and Uniswap v4. Supplying USDG to vaults is incentivized through [DRIP](https://arbitrumdrip.com/opportunities), Arbitrum's DeFi Renaissance Incentive Program.",
    },
    {
        key: 'automation',
        title: 'Built for automation',
        body: 'Rules mint USDG automatically when a wire arrives, and webhooks plus an events API let your backend react to every mint, deposit, and payout.',
    },
];

export type Step = { title: string; body: string };

// Steps shared by every sample. Each app puts its own first step in front.
export const STEPS: Step[] = [
    {
        title: 'Try the Paxos sandbox',
        body: 'Create a [sandbox account](https://dashboard.sandbox.paxos.com). Its Arbitrum network runs on Arbitrum Sepolia, with test USDG from the [Paxos faucet](https://faucet.paxos.com).',
    },
    {
        title: 'Read the USDG guides',
        body: 'The [Paxos USDG docs](https://docs.paxos.com/guides/stablecoin/usdg) cover minting, redeeming, rewards, and webhooks.',
    },
    {
        title: 'Talk to the Arbitrum team',
        body: `Tell us where USDG fits in your roadmap and we'll help find the right market, liquidity, collateral, earn, or partnership path. [Get in touch](${CONTACT})`,
    },
];

export const DISCLAIMER =
    'USDG is issued by Paxos on behalf of the Global Dollar Network. USDG on Arbitrum is an ecosystem program offered by the Arbitrum Foundation to eligible businesses under a separate written agreement. Holding USDG does not earn rewards; third party products such as vaults offer rewards independently under their own terms.';
