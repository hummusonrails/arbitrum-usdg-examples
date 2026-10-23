// What each part of the demo does, written for a builder learning the flow.
export type Guide = {
    title: string;
    body: string;
    calls: string[];
    watch: string;
};

export type TourStep = 'swap' | 'pool' | 'register' | 'route' | 'move';

// Which half of the page each step points at, so narrow screens can switch to it.
export const TOUR: { step: TourStep; side: 'trader' | 'console' }[] = [
    { step: 'swap', side: 'trader' },
    { step: 'pool', side: 'trader' },
    { step: 'register', side: 'console' },
    { step: 'route', side: 'console' },
    { step: 'move', side: 'trader' },
];

export const GUIDES: Record<TourStep, Guide> = {
    swap: {
        title: 'Every pool is quoted in USDG',
        body: 'Acme Swap prices each token in USDG. Pick a demo wallet, then buy or sell against a pool. The quote comes from the pool reserves, and the swap reverts if the price moves past the minimum.',
        calls: [
            'pool.getAmountOut(tokenIn, amountIn)',
            'token.approve(pool), pool.swapExactIn(tokenIn, amountIn, minOut, to)',
        ],
        watch: 'The pool reserves on the console move by exactly the amounts in the swap.',
    },
    pool: {
        title: 'Provide liquidity and earn',
        body: 'LPs add USDG and the matching token at the pool price. Their LP tokens earn the 0.30% swap fee and a share of the USDG rewards the pool routes to them, by LP balance over time.',
        calls: [
            'pool.addLiquidity(base, quote, minLiquidity, to)',
            'pool.pendingRewards(lp), pool.claimRewards(to)',
        ],
        watch: 'Rewards ready to claim grow each time the operator routes a claim to this pool.',
    },
    register: {
        title: 'Register the pool for USDG rewards',
        body: 'The USDG contract pays rewards to registered addresses in a payout group. Smart contracts join in two steps: the group manager proposes the pool, then the pool accepts by calling USDG itself.',
        calls: [
            'USDG.proposeRegisterRewardAddress(group, pool)',
            'pool.acceptRewardsRegistration(group) calls USDG.acceptRegisterRewardAddress(group)',
        ],
        watch: 'The step rail reads the registration from the USDG contract after each step.',
    },
    route: {
        title: 'Pass the rewards to LPs',
        body: 'Rewards accrue to the pool but are paid to the payout group destination, Acme Swap’s operator. The operator claims one pool at a time and routes the exact amount into that pool for its LPs.',
        calls: [
            'USDG.availableRewardsOf(pool)',
            'USDG.claimForAddresses(group, [pool]), pool.notifyRewards(amount)',
        ],
        watch: 'Claimed and routed always match, and the books check both against the chain.',
    },
    move: {
        title: 'Move USDG across chains',
        body: 'USDG moves between Ethereum and Arbitrum through the Paxos LayerZero OFT. The OFT burns USDG on one chain, and a LayerZero message mints the same amount on the other.',
        calls: [
            'OFT.quoteSend(sendParam, false)',
            'OFT.send(sendParam, fee, refund) with the fee as value',
        ],
        watch: 'The transfer shows as in flight until delivery, then the balance on the other chain rises by the same amount.',
    },
};
