// Words the customer reads before putting money in a vault. Third party vaults
// set their own rates and rules, so the app says so plainly, every time.
import type { VaultId } from '@/server/vaults/types';

export const HOLDING_NOTE =
    'Holding USDG in a wallet does not yield returns. Third-party products, such as vaults, offer rewards independently under their own terms.';

export const COMMON_DISCLOSURE = [
    'Rates are variable and not guaranteed. The vault rate is set by the market and changes over time.',
    'Boosts are temporary incentives paid by a third party. They show their token and end date, and they can end or change at any time.',
    'This vault is run by a third party, not by Acme Money.',
    'Withdrawals are usually instant, but can be delayed when the vault does not have enough available liquidity.',
    'You can lose money. Smart contracts and the markets a vault uses carry risk.',
    HOLDING_NOTE,
];

// Lines specific to one vault. The Morpho fee is read live, because each
// vault's owner sets it.
export function vaultDisclosure(vault: {
    id: VaultId;
    curator: string;
    performanceFee: number | null;
}): string[] {
    if (vault.id === 'glv') {
        return [
            'This vault provides liquidity to GMX perpetual markets. Its value moves with traders’ profits and losses and can fall in USDG terms.',
            'GMX charges a 0.04% fee when you withdraw.',
            'Deposits and withdrawals settle a few seconds after you confirm, once GMX executes them.',
        ];
    }

    return [
        `${vault.curator} curates this Morpho vault and chooses which lending markets it supplies.`,
        vault.performanceFee == null
            ? 'The vault’s owner may take a performance fee from its earnings.'
            : `The vault takes a ${percent(vault.performanceFee, 0)} performance fee from its earnings, set by the vault’s owner.`,
    ];
}

export function percent(value: number | null | undefined, digits = 2): string {
    return value == null ? 'Not available' : `${(value * 100).toFixed(digits)}%`;
}

export function shortDate(iso: string): string {
    return new Date(iso).toLocaleDateString('en-US', {
        month: 'short',
        day: 'numeric',
        year: 'numeric',
    });
}

export function usd(value: number | null | undefined): string {
    if (value == null) {
        return 'Not available';
    }

    return value >= 1e6
        ? `$${(value / 1e6).toFixed(1)}M`
        : `$${Math.round(value).toLocaleString('en-US')}`;
}
