export type Band = { min: bigint; target: bigint; max: bigint };

export type PolicyState = {
    walletUnits: bigint;
    // USDG on its way into or out of the wallet that has not settled yet.
    inFlightUnits: bigint;
    pending: boolean;
    stuck: boolean;
    paused: boolean;
    band: Band;
};

export type PolicyDecision =
    | { kind: 'none'; reason: 'paused' | 'pending' | 'stuck' | 'in_band' }
    | { kind: 'mint' | 'redeem'; amountUnits: bigint };

// Keeps the treasury wallet inside its band: mint up to target when the
// balance drops below min, redeem down to target when it rises above max.
export function decide(s: PolicyState): PolicyDecision {
    if (s.paused) {
        return { kind: 'none', reason: 'paused' };
    }

    if (s.stuck) {
        return { kind: 'none', reason: 'stuck' };
    }

    if (s.pending) {
        return { kind: 'none', reason: 'pending' };
    }

    const effective = s.walletUnits + s.inFlightUnits;

    if (effective < s.band.min) {
        return { kind: 'mint', amountUnits: s.band.target - effective };
    }

    if (effective > s.band.max) {
        const excess = effective - s.band.target;

        return {
            kind: 'redeem',
            amountUnits: excess < s.walletUnits ? excess : s.walletUnits,
        };
    }

    return { kind: 'none', reason: 'in_band' };
}
