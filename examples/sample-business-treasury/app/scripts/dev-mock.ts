// One command local mode: fork, mock Paxos, setup, and the app in dev mode.
import { startStack } from './stack.ts';

const stack = await startStack({ app: 'dev', env: { POLICY_START_PAUSED: '1' } });

console.log(`\nAcme Co. treasury (sample app) running in mock mode
  app        ${stack.appUrl}
  mock Paxos ${stack.mockUrl}
  fork RPC   ${stack.rpcUrl}
  wallet     ${stack.wallet}
`);

const shutdown = async () => {
    await stack.stop();
    process.exit(0);
};

process.on('SIGINT', shutdown);
process.on('SIGTERM', shutdown);
