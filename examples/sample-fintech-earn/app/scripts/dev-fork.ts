// One command local mode: fork, GMX keeper, Merkl stand in, and the app in dev mode.
import { startStack } from './stack.ts';

const stack = await startStack({ app: 'dev' });

console.log(`\nAcme Money earn (sample app) running on a local fork of Arbitrum One
  app             ${stack.appUrl}
  fork RPC        ${stack.rpcUrl}
  omnibus wallet  ${stack.omnibus}
  Merkl stand in  ${stack.merklUrl}
`);

const shutdown = async () => {
    await stack.stop();
    process.exit(0);
};

process.on('SIGINT', shutdown);
process.on('SIGTERM', shutdown);
