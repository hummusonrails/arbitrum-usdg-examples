// Position math, mirrored exactly from AcmeMarginVault so the trader app's
// previews and the server agree with the contract to the base unit. Sizes and
// collateral are USD with 6 decimals (like USDG), prices USD with 8 decimals.
export const FEE_BPS = 10n;
export const MAINTENANCE_BPS = 100n;
const BPS = 10_000n;

export type PositionShape = {
    isLong: boolean;
    size: bigint;
    collateral: bigint;
    entryPrice: bigint;
};

// 0.10% of the size, rounded up, charged on open and on close.
export function feeOf(size: bigint): bigint {
    return (size * FEE_BPS + BPS - 1n) / BPS;
}

// The oracle price at which the vault may liquidate: where collateral, less
// the close fee, has fallen to the maintenance margin.
export function liquidationPrice(p: PositionShape): bigint {
    const headroom = p.collateral - feeOf(p.size) - (p.size * MAINTENANCE_BPS) / BPS;
    const move = (p.entryPrice * headroom) / p.size;

    return p.isLong
        ? move >= p.entryPrice
            ? 0n
            : p.entryPrice - move
        : p.entryPrice + move;
}

// Profit or loss at `price`, before the close fee: profit rounds down and is
// capped at the size, loss rounds up.
export function pnlAt(p: PositionShape, price: bigint): bigint {
    const up = price >= p.entryPrice;
    const move = up ? price - p.entryPrice : p.entryPrice - price;

    if (up === p.isLong) {
        const profit = (p.size * move) / p.entryPrice;

        return profit > p.size ? p.size : profit;
    }

    return -((p.size * move + p.entryPrice - 1n) / p.entryPrice);
}
