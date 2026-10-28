// What each part of the demo does, written for a builder learning the flow.
export type Guide = {
    title: string;
    body: string;
    calls: string[];
    watch: string;
};

export type TourStep = 'deposit' | 'trade' | 'register' | 'route' | 'market';

// Which half of the page each step points at, so narrow screens can switch to it.
export const TOUR: { step: TourStep; side: 'trader' | 'console' }[] = [
    { step: 'deposit', side: 'trader' },
    { step: 'trade', side: 'trader' },
    { step: 'register', side: 'console' },
    { step: 'route', side: 'console' },
    { step: 'market', side: 'console' },
];

export const GUIDES: Record<TourStep, Guide> = {
    deposit: {
        title: 'Deposit margin with one signature',
        body: 'The trader signs an EIP-3009 authorization that lets only the vault pull the USDG. Acme’s keeper submits it and pays the gas, and the vault credits the signer once its USDG balance has risen by the full amount.',
        calls: [
            'sign ReceiveWithAuthorization(from, vault, value, validAfter, validBefore, nonce)',
            'vault.depositWithAuthorization calls USDG.receiveWithAuthorization',
        ],
        watch: 'The trader’s wallet USDG moves into free margin, and their ETH does not move.',
    },
    trade: {
        title: 'Trade with USDG as margin',
        body: 'A position takes collateral from free margin and stays in the vault as bookkeeping. Profit and loss settle in USDG against the house liquidity at the oracle price when the position closes.',
        calls: [
            'vault.openPosition(market, isLong, collateral, size, acceptablePrice)',
            'vault.closePosition(market, acceptablePrice)',
        ],
        watch: 'Posted collateral never leaves the vault, so the vault balance on the console does not change.',
    },
    register: {
        title: 'Register the vault for USDG rewards',
        body: 'The USDG contract pays rewards to registered addresses in a payout group. Contracts join in two steps: the group manager proposes the vault, then the vault accepts by calling USDG itself.',
        calls: [
            'USDG.proposeRegisterRewardAddress(group, vault)',
            'vault.acceptRewardsRegistration(group) calls USDG.acceptRegisterRewardAddress(group)',
        ],
        watch: 'The step rail reads the registration from the USDG contract after each step.',
    },
    route: {
        title: 'Share the rewards with traders',
        body: 'Rewards accrue on the vault’s whole balance and are paid to Acme’s operator. The operator routes them back into the vault, which splits them by balance between trader margin and the house liquidity.',
        calls: [
            'USDG.availableRewardsOf(vault)',
            'USDG.claimForAddresses(group, [vault]), vault.notifyRewards(amount)',
        ],
        watch: 'Traders see USDG rewards ready on the Margin tab, and can add them to their margin.',
    },
    market: {
        title: 'Prices, PnL, and liquidations',
        body: 'Acme’s keeper pushes prices to the oracle and liquidates any position whose equity falls to its maintenance margin. On the fork, move a market to see it happen.',
        calls: [
            'oracle.setPrices(markets, prices)',
            'vault.isLiquidatable(trader, market), vault.liquidate',
        ],
        watch: 'A 10x long liquidates after a 10% drop, and its collateral joins the house liquidity.',
    },
};
