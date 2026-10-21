import type { Address, Hex } from 'viem';

export type VaultId = 'gauntlet' | 'steakhouse' | 'glv';

export type VaultConfig = {
    id: VaultId;
    kind: 'erc4626' | 'glv';
    address: Address;
    name: string;
    protocol: 'Morpho' | 'GMX';
    curator: string;
    shareDecimals: 18;
    // Whether the vault's incentive is ARB claimed from Merkl (Morpho) rather
    // than paid into the token price (GLV).
    merklRewards: boolean;
    programUrl?: string;
    isDefault?: boolean;
};

export type VaultChainState = {
    totalAssets: bigint;
    // USDG base units for 1e18 shares.
    sharePrice: bigint;
    omnibusShares: bigint;
    depositsOpen: boolean;
    withdrawalsOpen: boolean;
};

export type Preflight = { ok: true } | { ok: false; reason: string; maxNow?: bigint };

// `amount` is what was sent in: USDG for a deposit, shares for a withdrawal.
export type Submitted = {
    txHash: Hex;
    mode: 'sync' | 'async';
    amount: bigint;
    requestKey?: Hex;
};

export type Settlement =
    | { status: 'executed'; shares: bigint; assets: bigint }
    | { status: 'cancelled'; reason: string };

// One shape for every vault, whether it settles in the same transaction
// (ERC-4626) or a few seconds later through a keeper (GLV).
export interface VaultAdapter {
    config: VaultConfig;
    readState(): Promise<VaultChainState>;
    // Shares needed to take out `assets`, rounded up.
    sharesForAssets(assets: bigint): Promise<bigint>;
    assetsForShares(shares: bigint): Promise<bigint>;
    preflight(
        kind: 'deposit' | 'withdraw',
        assets: bigint,
        instantLiquidity?: bigint | null,
    ): Promise<Preflight>;
    // `onSent` is called with the hash as soon as the main transaction is
    // broadcast, before waiting for it, so the caller can record it first.
    deposit(assets: bigint, onSent?: (txHash: Hex) => void): Promise<Submitted>;
    withdraw(shares: bigint, onSent?: (txHash: Hex) => void): Promise<Submitted>;
    // Null while the action is still pending.
    settle(sub: Submitted): Promise<Settlement | null>;
    // Async vaults only: asks the protocol to cancel a pending request.
    cancel?(sub: Submitted): Promise<void>;
}
