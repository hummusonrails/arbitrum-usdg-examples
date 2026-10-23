// Words the app shows about rewards and the local stand ins. Rewards here are
// partner rewards under a Paxos agreement, never a return on holding USDG.
export const HOLDING_NOTE = 'Holding USDG in a wallet does not yield returns.';

export const REWARDS_NOTE =
    'USDG rewards accrue to Acme Swap as a Global Dollar Network partner under its agreement with Paxos, at rates Paxos sets and can change. Acme Swap chooses to pass them to its LPs. They are not guaranteed.';

export const REGISTRAR_STAND_IN =
    'Paxos creates payout groups for its partners. On this local fork, a stand in impersonates the Paxos registrar to create one.';

export const RELAY_STAND_IN =
    'On a live network, LayerZero verifiers and an executor deliver each message. On these local forks, a relay stand in delivers it.';

export const ADVANCE_STAND_IN =
    'Local fork only: moves the Arbitrum fork clock forward so rewards have time to accrue.';

export const POOL_NOTE =
    'The Acme pool contract is unaudited example code, written to show the integration.';
