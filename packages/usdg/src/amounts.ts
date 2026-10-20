import { formatUnits, parseUnits } from 'viem';

import { USDG_DECIMALS } from './networks.ts';

const DECIMAL = /^\d+(\.\d{1,6})?$/;

// Paxos amounts are decimal strings; onchain amounts are 6 decimal base units.
export function toUnits(amount: string): bigint {
    if (!DECIMAL.test(amount)) {
        throw new Error(`Not a USDG amount with at most 6 decimals: "${amount}"`);
    }

    return parseUnits(amount, USDG_DECIMALS);
}

export function fromUnits(units: bigint): string {
    return formatUnits(units, USDG_DECIMALS);
}
