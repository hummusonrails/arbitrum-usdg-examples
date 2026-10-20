// Matches each ledger row against the USDG Transfer log on Arbitrum: the
// Paxos record and the chain must agree on recipient and amount.
import { fromPaxosAmount, usdgAbi, USDG } from '@arbitrum-usdg/usdg';
import { parseEventLogs, type Address, type Hex } from 'viem';

import type { Ctx } from './actions.ts';
import { getKv } from './db.ts';

export type LedgerStatus = 'pending' | 'matched' | 'mismatch' | 'stuck' | 'failed';

export type LedgerRow = {
    id: string;
    ref_id: string | null;
    source: 'app' | 'rule';
    direction: 'in' | 'out';
    amount_units: string;
    paxos_status: string | null;
    orchestration_id: string | null;
    transfer_id: string | null;
    crypto_tx_hash: string | null;
    onchain_amount_units: string | null;
    onchain_to: string | null;
    status: LedgerStatus;
    reason: string | null;
    updated_at: string;
};

export function listLedger(ctx: Ctx): LedgerRow[] {
    return ctx.db
        .prepare('SELECT * FROM ledger ORDER BY updated_at DESC')
        .all() as LedgerRow[];
}

// Compares what Paxos reports with what the chain shows.
export function reconcileRow(
    expected: { to: Address; units: bigint },
    onchain: { to: Address; value: bigint } | null,
): 'pending' | 'matched' | 'mismatch' {
    if (!onchain) {
        return 'pending';
    }

    return onchain.to.toLowerCase() === expected.to.toLowerCase() &&
        onchain.value === expected.units
        ? 'matched'
        : 'mismatch';
}

export async function reconcileAll(ctx: Ctx): Promise<void> {
    const rows = ctx.db
        .prepare(
            "SELECT * FROM ledger WHERE status IN ('pending', 'mismatch') AND crypto_tx_hash IS NOT NULL AND transfer_id IS NOT NULL",
        )
        .all() as LedgerRow[];
    const depositAddress = getKv(ctx.db, 'deposit_address') as Address | undefined;
    const token = USDG[ctx.config.network].address.toLowerCase();

    for (const row of rows) {
        const receipt = await ctx.chain.publicClient
            .getTransactionReceipt({ hash: row.crypto_tx_hash as Hex })
            .catch(() => undefined);

        if (!receipt) {
            continue;
        }

        const expectedTo = row.direction === 'in' ? ctx.chain.wallet : depositAddress;

        if (!expectedTo) {
            continue;
        }

        // The amount Paxos reports on its transfer record, falling back to the
        // amount the app asked for while that record is not available yet.
        // Matching needs both sides: the amount Paxos recorded on its transfer
        // and the onchain log. Without the Paxos record the row stays pending.
        const transfer = await ctx.paxos
            .getTransfer(row.transfer_id!)
            .catch(() => undefined);

        if (!transfer?.amount) {
            continue;
        }

        const reported = fromPaxosAmount(transfer.amount);
        const logs = parseEventLogs({
            abi: usdgAbi,
            logs: receipt.logs.filter((l) => l.address.toLowerCase() === token),
            eventName: 'Transfer',
        });
        const log =
            logs.find((l) => l.args.to.toLowerCase() === expectedTo.toLowerCase()) ??
            logs[0];
        const onchain = log ? { to: log.args.to, value: log.args.value } : null;
        const status = reconcileRow({ to: expectedTo, units: reported }, onchain);

        ctx.db
            .prepare(
                `UPDATE ledger SET onchain_amount_units = ?, onchain_to = ?, status = ?,
                  reason = ?, updated_at = ? WHERE id = ?`,
            )
            .run(
                onchain ? onchain.value.toString() : null,
                onchain ? onchain.to : null,
                status,
                status === 'mismatch'
                    ? 'The Paxos record and the Arbitrum transfer disagree on amount or recipient.'
                    : null,
                new Date().toISOString(),
                row.id,
            );
    }
}
