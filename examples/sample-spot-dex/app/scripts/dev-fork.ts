// One command local mode: two forks, the pools, the stand ins, and the app in dev mode.
import { startStack } from './stack.ts';

// PORT picks another app port when 3000 is taken.
const stack = await startStack({ app: 'dev', appPort: Number(process.env.PORT ?? 3000) });

console.log(`\nAcme Swap (sample app) running on local forks of Arbitrum One and Ethereum
  app                ${stack.appUrl}
  Arbitrum fork RPC  ${stack.arbRpcUrl}
  Ethereum fork RPC  ${stack.ethRpcUrl}
  operator wallet    ${stack.operator}
  WETH/USDG pool     ${stack.pools.weth}
  ARB/USDG pool      ${stack.pools.arb}
  payout group       ${stack.payoutGroupId} (created by the local Paxos registrar stand in)
`);

const shutdown = async () => {
    await stack.stop();
    process.exit(0);
};

process.on('SIGINT', shutdown);
process.on('SIGTERM', shutdown);
