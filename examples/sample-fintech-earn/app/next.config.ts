import type { NextConfig } from 'next';

const config: NextConfig = {
    // `pnpm dev:fork` serves the app on 127.0.0.1.
    allowedDevOrigins: ['127.0.0.1'],
    devIndicators: false,
    transpilePackages: [
        '@arbitrum-usdg/earn-fork-services',
        '@arbitrum-usdg/guide',
        '@arbitrum-usdg/usdg',
    ],
};

export default config;
