import { startMockPaxos } from './server.ts';

const mock = await startMockPaxos({
    port: Number(process.env.MOCK_PAXOS_PORT ?? 4010),
    rpcUrl: process.env.FORK_RPC_URL ?? 'http://127.0.0.1:8545',
    profileId: process.env.PAXOS_PROFILE_ID ?? 'mock-profile',
    webhookUrl: process.env.MOCK_WEBHOOK_URL,
    webhookApiKey: process.env.WEBHOOK_API_KEY,
});

console.log(`Mock Paxos listening on ${mock.url}`);
