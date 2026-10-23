import assert from 'node:assert/strict';
import { test } from 'node:test';

import { ActionError } from '../src/server/chain.ts';
import { checkBalance, minOut } from '../src/server/trade.ts';

test('minOut rounds down', () => {
    assert.equal(minOut(1_000_000n, 50), 995_000n);
    assert.equal(minOut(999n, 50), 994n);
});

test('refuses an oversized swap', () => {
    assert.throws(
        () => checkBalance(10_000_000n, 25_500_000n, 'USDG', 6),
        (err: unknown) =>
            err instanceof ActionError &&
            err.message.includes('25.5 USDG') &&
            err.message.includes('10 USDG'),
    );
    assert.doesNotThrow(() => checkBalance(10n, 10n, 'USDG', 6));
});
