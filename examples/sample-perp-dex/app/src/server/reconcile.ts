// The rules that keep Acme Perps' books honest against the chain. Pure
// functions over plain numbers, so they are easy to test and explain.
export type Check = {
    rule: 'vault' | 'margin' | 'collateral' | 'house' | 'claims' | 'routing';
    ledger: bigint;
    onchain: bigint;
    status: 'matched' | 'drift';
    // Vault only: USDG in the vault beyond what it owes, such as a direct transfer.
    surplus?: bigint;
};

export type VaultBooks = {
    // The vault's USDG balance, and what its own totals say it owes.
    usdgBalance: bigint;
    totalFreeMargin: bigint;
    totalCollateral: bigint;
    liquidity: bigint;
    reservedLiquidity: bigint;
    rewardsHeld: bigint;
    // The same totals rebuilt from each trader and each open position.
    traderFreeMargin: bigint;
    positionCollateral: bigint;
    // USDG claimed for the vault in Acme Perps' records, against the
    // RewardsClaimed events USDG emitted for the vault, and the USDG routed back
    // in (the vault's RewardsNotified events).
    claimedRecorded: bigint;
    claimedOnchain: bigint;
    routedOnchain: bigint;
};

const status = (ok: boolean) => (ok ? 'matched' : 'drift');

export function reconcileVault(b: VaultBooks): Check[] {
    const owed = b.totalFreeMargin + b.totalCollateral + b.liquidity + b.rewardsHeld;

    return [
        {
            rule: 'vault',
            ledger: owed,
            onchain: b.usdgBalance,
            status: status(b.usdgBalance >= owed),
            surplus: b.usdgBalance - owed,
        },
        {
            rule: 'margin',
            ledger: b.traderFreeMargin,
            onchain: b.totalFreeMargin,
            status: status(b.traderFreeMargin === b.totalFreeMargin),
        },
        {
            rule: 'collateral',
            ledger: b.positionCollateral,
            onchain: b.totalCollateral,
            status: status(b.positionCollateral === b.totalCollateral),
        },
        {
            // The house can pay every open position's largest possible profit.
            rule: 'house',
            ledger: b.reservedLiquidity,
            onchain: b.liquidity,
            status: status(b.liquidity >= b.reservedLiquidity),
        },
        {
            rule: 'claims',
            ledger: b.claimedRecorded,
            onchain: b.claimedOnchain,
            status: status(b.claimedRecorded === b.claimedOnchain),
        },
        {
            rule: 'routing',
            ledger: b.claimedRecorded,
            onchain: b.routedOnchain,
            status: status(b.claimedRecorded === b.routedOnchain),
        },
    ];
}
