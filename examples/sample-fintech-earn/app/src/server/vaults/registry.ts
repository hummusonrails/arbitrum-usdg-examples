// The three USDG vaults on Arbitrum One that Acme Money offers, plus the
// contracts around them. Every address was checked onchain on Arbitrum One.
import type { Address } from 'viem';

import type { VaultConfig, VaultId } from './types.ts';

export const VAULTS: Record<VaultId, VaultConfig> = {
    steakhouse: {
        id: 'steakhouse',
        kind: 'erc4626',
        address: '0xbeeFf72B77e7584a450E887125F25E8D8819016a',
        name: 'Steakhouse USDG Pro',
        protocol: 'Morpho',
        curator: 'Steakhouse Financial',
        shareDecimals: 18,
        merklRewards: true,
        isDefault: true,
    },
    gauntlet: {
        id: 'gauntlet',
        kind: 'erc4626',
        address: '0x390c1bb01F3F627144a40617e287d4cE3D5aBCfa',
        name: 'Gauntlet USDG Premium',
        protocol: 'Morpho',
        curator: 'Gauntlet',
        shareDecimals: 18,
        merklRewards: true,
    },
    glv: {
        id: 'glv',
        kind: 'glv',
        address: '0x4Cd5A94a30876320ac65F2e192493EE476f13866',
        name: 'GMX Dollar Vault',
        protocol: 'GMX',
        curator: 'GMX',
        shareDecimals: 18,
        merklRewards: false,
        programUrl: 'https://docs.gmx.io/docs/usdg-launch-boost',
    },
};

export const VAULT_IDS = Object.keys(VAULTS) as VaultId[];

// GMX contracts the GLV vault goes through. Router, reader, and handler
// addresses change when GMX upgrades, so they live in one place.
export const GMX = {
    dataStore: '0xFD70de6b91282D8017aA4E741e9Ae325CAb992d8',
    roleStore: '0x3c3d99FD298f679DBC2CEcd132b4eC4d0F5e6e72',
    router: '0x7452c558d45f8afC8c83dAe62C3f8A5BE19c71f6',
    glvRouter: '0x167540D2DFF14120365CfDDF2F86e3045D4fa712',
    glvVault: '0x393053B58f9678C9c28c2cE941fF6cac49C3F8f9',
    glvReader: '0x85fcBD684D08053f1efAB302dCb04F22E20E65B1',
    reader: '0xfA26cBb46e2614609406de08CA1Dc7f70a684184',
    eventEmitter: '0xC8ee91A54287DB53897056e12D9819156D3822Fb',
    glvDepositHandler: '0xE092bFd05186546fDEAC888f5bCC2c42406d026d',
    glvWithdrawalHandler: '0x45048c62528a6A66FA5CC8D2b25b918701F0FAAA',
    oracle: '0x26C02F221e8dB5A821e12347C7eA8a6b6E10842f',
} as const satisfies Record<string, Address>;

export const MERKL_DISTRIBUTOR: Address = '0x3Ef3D8bA38EBe18DB133cEc108f4D14CE00Dd9Ae';
export const ARB_TOKEN: Address = '0x912CE59144191C1204E64559FE8253a0e49E6548';

// A plain account holding USDG on Arbitrum One, used only on a local fork to
// fund demo customers.
export const FORK_USDG_HOLDER: Address = '0x264bd8291fae1d75db2c5f573b07faa6715997b5';
