import assert from 'node:assert/strict';
import { test } from 'node:test';

import { liquidationPrice, pnlAt } from '../src/lib/math.ts';

// The same position as the vault's Foundry test: a 10x long, 100 USDG of
// collateral, size 1,000, entered at $2,000. The vault liquidates it at $1,822.
const long = {
    isLong: true,
    size: 1_000_000_000n,
    collateral: 100_000_000n,
    entryPrice: 2_000n * 10n ** 8n,
};

test('the liquidation price matches the vault', () => {
    assert.equal(liquidationPrice(long), 1_822n * 10n ** 8n);
    assert.equal(liquidationPrice({ ...long, isLong: false }), 2_178n * 10n ** 8n);
});

test('PnL rounds against the trader and caps profit at the size', () => {
    assert.equal(pnlAt(long, 2_100n * 10n ** 8n), 50_000_000n);
    assert.equal(pnlAt(long, long.entryPrice - 1n), -1n);
    assert.equal(pnlAt(long, long.entryPrice * 3n), long.size);
    assert.equal(pnlAt({ ...long, isLong: false }, 2_100n * 10n ** 8n), -50_000_000n);
});
