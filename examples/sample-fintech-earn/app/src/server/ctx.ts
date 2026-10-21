import type { Chain } from './chain.ts';
import type { Config } from './config.ts';
import type { Db } from './db.ts';
import type { VaultMarket } from './market.ts';
import type { VaultAdapter, VaultId } from './vaults/types.ts';

// Everything the server needs, built once at startup.
export type Ctx = {
    config: Config;
    db: Db;
    chain: Chain;
    adapters: Record<VaultId, VaultAdapter>;
    markets(): Promise<Record<VaultId, VaultMarket>>;
    // Fork mode only: moves real USDG into the omnibus wallet from a holder.
    fundOmnibus?: (units: bigint) => Promise<void>;
};
