import type { Address, Chain } from 'viem';
import { arbitrum, arbitrumSepolia } from 'viem/chains';

export type UsdgNetwork = 'arbitrumOne' | 'arbitrumSepolia';

export type UsdgDeployment = {
    chain: Chain;
    address: Address;
    // Network identifier Paxos uses for this chain. Paxos sandbox maps
    // ARBITRUM_ONE to Arbitrum Sepolia.
    paxosNetwork: 'ARBITRUM_ONE';
    explorer: string;
};

export const USDG: Record<UsdgNetwork, UsdgDeployment> = {
    arbitrumOne: {
        chain: arbitrum,
        address: '0x004B506865409877C9fA29bfb1ebA929984B9bbC',
        paxosNetwork: 'ARBITRUM_ONE',
        explorer: 'https://arbiscan.io',
    },
    arbitrumSepolia: {
        chain: arbitrumSepolia,
        address: '0xFFC95faa3d63Cde504a05B567C600B78C0b41892',
        paxosNetwork: 'ARBITRUM_ONE',
        explorer: 'https://sepolia.arbiscan.io',
    },
};

export const USDG_DECIMALS = 6;
