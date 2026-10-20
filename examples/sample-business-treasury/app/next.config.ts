import type { NextConfig } from 'next';

const config: NextConfig = {
    // `pnpm dev:mock` serves the app on 127.0.0.1.
    allowedDevOrigins: ['127.0.0.1'],
    transpilePackages: ['@arbitrum-usdg/paxos-client', '@arbitrum-usdg/usdg'],
};

export default config;
