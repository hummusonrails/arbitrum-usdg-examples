import { fromUnits } from '@arbitrum-usdg/usdg';

import { formatAmount } from './format';
import type { Snapshot } from './types';

// The policy decision in plain words for the dashboard.
export function describeDecision(d: Snapshot['decision']): string {
    if (!d) {
        return 'Starting up';
    }

    switch (d.kind) {
        case 'mint':
            return `Minting ${formatAmount(fromUnits(BigInt(d.amountUnits)))} USDG to reach target`;
        case 'redeem':
            return `Redeeming ${formatAmount(fromUnits(BigInt(d.amountUnits)))} USDG back to the bank`;
        case 'error':
            return d.message;
        default:
            return {
                in_band: 'Holding: the wallet is inside its band',
                pending: 'Waiting for the current action to settle',
                stuck: 'Paused until a stuck redeem is resolved',
                paused: 'Policy paused',
            }[d.reason];
    }
}

export const LEDGER_STATUS: Record<string, string> = {
    pending: 'Pending',
    matched: 'Matched',
    mismatch: 'Mismatch',
    stuck: 'Stuck',
    failed: 'Failed',
};

// Paxos status details and action steps in plain words.
export function describeStep(kind: string, step: string, status: string): string {
    if (status === 'completed') {
        return kind === 'mint'
            ? 'USDG delivered to your Arbitrum wallet'
            : 'USD sent to your bank';
    }

    if (status === 'stuck') {
        return 'Needs attention';
    }

    if (status === 'failed' || status === 'cancelled') {
        return status === 'failed' ? 'Did not complete' : 'Cancelled';
    }

    return (
        {
            orchestration:
                'Converting USD to USDG and sending it to your Arbitrum wallet',
            deposit: 'Waiting for your USDG deposit to arrive at Paxos',
            travel_rule: 'Confirming the deposit came from your own wallet',
            convert: 'Converting USDG to USD and sending it to your bank',
        }[step] ?? 'In progress'
    );
}
