// One command local mode: the fork, the vault, the stand ins, and the app in dev mode.
import { startStack } from './stack.ts';

// PORT picks another app port when 3000 is taken.
const stack = await startStack({
    app: 'dev',
    appPort: Number(process.env.PORT ?? 3000),
});

console.log(`\nAcme Perps (sample app) running on a local fork of Arbitrum One
  app              ${stack.appUrl}
  fork RPC         ${stack.rpcUrl}
  operator wallet  ${stack.operator}
  keeper wallet    ${stack.keeper}
  margin vault     ${stack.vault}
  oracle           ${stack.oracle}
  payout group     ${stack.payoutGroupId} (created by the local Paxos registrar stand in)
`);

const shutdown = async () => {
    await stack.stop();
    process.exit(0);
};

process.on('SIGINT', shutdown);
process.on('SIGTERM', shutdown);
