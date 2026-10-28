// Words the app shows about rewards and the local stand ins. Rewards here are
// partner rewards under a Paxos agreement, never a return on holding USDG.
export const HOLDING_NOTE = 'Holding USDG in a wallet does not yield returns.';

export const REWARDS_NOTE =
    'USDG rewards accrue to Acme Perps as a Global Dollar Network partner under its agreement with Paxos, at rates Paxos sets and can change. Acme Perps chooses to share them with traders by margin. They are not guaranteed.';

export const REGISTRAR_STAND_IN =
    'Paxos creates payout groups for its partners. On this local fork, a stand in impersonates the Paxos registrar to create one.';

export const ADVANCE_STAND_IN =
    'Local fork only: moves the fork clock forward so rewards have time to accrue. The keeper pushes fresh prices right after.';

export const MARKET_STAND_IN =
    'Local fork only: the keeper prices each market from its Chainlink feed on the fork, which stays at its value at the fork block. Move a market to see PnL and liquidations.';

export const VAULT_NOTE =
    'The Acme margin vault and oracle are unaudited example code, written to show the integration.';

export const DEPOSIT_NOTE =
    'You sign a USDG transfer authorization for the vault. Acme’s keeper submits it and pays the gas.';
