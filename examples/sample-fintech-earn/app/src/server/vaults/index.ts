import type { Chain } from '../chain.ts';
import type { Config } from '../config.ts';
import { createErc4626Adapter } from './erc4626.ts';
import { createGlvAdapter } from './glv.ts';
import { VAULTS } from './registry.ts';
import type { VaultAdapter, VaultId } from './types.ts';

export * from './registry.ts';
export * from './types.ts';

export function createAdapters(
    chain: Chain,
    config: Config,
): Record<VaultId, VaultAdapter> {
    return {
        steakhouse: createErc4626Adapter(VAULTS.steakhouse, chain),
        gauntlet: createErc4626Adapter(VAULTS.gauntlet, chain),
        glv: createGlvAdapter(VAULTS.glv, chain, config.gmxApiUrl),
    };
}
