import type { NextConfig } from 'next';

const config: NextConfig = {
    transpilePackages: ['@arbitrum-usdg/paxos-client', '@arbitrum-usdg/usdg'],
};

export default config;
