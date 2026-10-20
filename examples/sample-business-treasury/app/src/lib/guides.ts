// What each dashboard action does, written for a builder learning the flow.
export type Guide = {
    title: string;
    body: string;
    calls: string[];
    watch: string;
};

export const GUIDES: Record<'mint' | 'redeem' | 'wire', Guide> = {
    mint: {
        title: 'Mint USD into USDG',
        body: 'Paxos converts USD from your Paxos account into USDG and sends it to your treasury wallet on Arbitrum, in one call.',
        calls: [
            'POST /v2/orchestration/orchestrations',
            'USD to USDG, destination ARBITRUM_ONE',
        ],
        watch: 'A cell appears in Mints, then lights up once the Arbitrum transfer matches the Paxos record.',
    },
    redeem: {
        title: 'Redeem USDG to your bank',
        body: 'Your wallet sends USDG to your Paxos deposit address on Arbitrum. When the deposit lands, the app confirms it came from your own wallet, then Paxos converts it to USD and pays your bank.',
        calls: [
            'USDG transfer on Arbitrum to the deposit address',
            'POST /v2/transfer/crypto-deposits/{id}/update',
            'POST /v2/orchestration/orchestrations (USDG to USD, bank)',
        ],
        watch: 'The slate shows the amount on its way to Paxos, then converting to USD. The redeem lights up in Redeems once the Arbitrum transfer matches.',
    },
    wire: {
        title: 'Simulate a customer wire',
        body: 'Sends a test USD wire to your Paxos account with the memo of your auto mint rule. The rule turns the wire into USDG in your wallet with no code in the loop.',
        calls: [
            'POST /v2/sandbox/fiat-deposits',
            'The rule runs a USD to USDG orchestration on its own',
        ],
        watch: 'Paxos events print on the slate, then the inflow lights up in Wire inflows.',
    },
};

export const TOUR_ORDER = ['mint', 'redeem', 'wire'] as const;
