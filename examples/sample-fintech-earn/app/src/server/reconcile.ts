// The three rules that keep Acme Money's books honest against the chain.
// Pure functions over plain numbers, so they are easy to test and explain.
import type { VaultId } from './vaults/types.ts';

export type Check = {
    rule: 'shares' | 'usdg' | 'rewards';
    vaultId?: VaultId;
    ledger: bigint;
    onchain: bigint;
    status: 'matched' | 'drift';
};

export type ReconcileInput = {
    // Per vault: the sum of customer shares in the ledger, and the omnibus
    // wallet's share balance onchain.
    sharesByVault: Record<VaultId, { ledger: bigint; onchain: bigint }>;
    // Customer app balances plus USDG reserved for deposits in flight, against
    // the omnibus wallet's USDG. Anything left over is unassigned.
    usdg: { balances: bigint; reserved: bigint; onchain: bigint };
    // ARB claimed from Merkl, ARB credited to customers, and the omnibus
    // wallet's ARB balance.
    arb: { claimed: bigint; allocated: bigint; onchain: bigint };
};

export function reconcile(input: ReconcileInput): Check[] {
    const checks: Check[] = Object.entries(input.sharesByVault).map(
        ([vaultId, { ledger, onchain }]) => ({
            rule: 'shares',
            vaultId: vaultId as VaultId,
            ledger,
            onchain,
            status: ledger === onchain ? 'matched' : 'drift',
        }),
    );
    const owed = input.usdg.balances + input.usdg.reserved;

    checks.push({
        rule: 'usdg',
        ledger: owed,
        onchain: input.usdg.onchain,
        status: input.usdg.onchain >= owed ? 'matched' : 'drift',
    });
    checks.push({
        rule: 'rewards',
        ledger: input.arb.allocated,
        onchain: input.arb.onchain,
        status:
            input.arb.allocated <= input.arb.claimed &&
            input.arb.onchain >= input.arb.allocated
                ? 'matched'
                : 'drift',
    });

    return checks;
}
