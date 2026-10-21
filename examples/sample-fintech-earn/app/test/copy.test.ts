import assert from 'node:assert/strict';
import { test } from 'node:test';

import { vaultDisclosure } from '../src/lib/copy.ts';

test('the Morpho fee line uses the live fee and does not say Morpho takes it', () => {
    const lines = vaultDisclosure({
        id: 'gauntlet',
        curator: 'Gauntlet',
        performanceFee: 0.12,
    });

    assert.ok(lines.some((l: string) => l.includes('12% performance fee')));
    assert.ok(!lines.some((l: string) => l.includes('Morpho takes')));
});
