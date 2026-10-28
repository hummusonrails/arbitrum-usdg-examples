import type { NextConfig } from 'next';

const config: NextConfig = {
    // `pnpm dev:fork` serves the app on 127.0.0.1.
    allowedDevOrigins: ['127.0.0.1'],
    devIndicators: false,
    transpilePackages: [
        '@arbitrum-usdg/perp-dex-fork-services',
        '@arbitrum-usdg/guide',
        '@arbitrum-usdg/perp-dex-contracts',
        '@arbitrum-usdg/usdg',
    ],
};

export default config;
