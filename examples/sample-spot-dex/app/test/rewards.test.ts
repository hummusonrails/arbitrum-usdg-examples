import assert from 'node:assert/strict';
import { test } from 'node:test';

import { ActionError } from '../src/server/chain.ts';
import { nextStep, routeAmount } from '../src/server/rewards.ts';

test('accept before propose is refused', () => {
    assert.match(nextStep('unregistered', 'accept')!, /Propose the pool first/);
});

test('propose for a registered pool is refused', () => {
    assert.match(nextStep('registered', 'propose')!, /already registered/);
});

test('cancel without a proposal is refused', () => {
    assert.match(nextStep('unregistered', 'cancel')!, /no pending proposal/);
    assert.match(nextStep('registered', 'cancel')!, /no pending proposal/);
});

test('valid steps are allowed', () => {
    assert.equal(nextStep('unregistered', 'propose'), null);
    assert.equal(nextStep('proposed', 'accept'), null);
    assert.equal(nextStep('proposed', 'cancel'), null);
    // A new proposal replaces the pending one, as the contract allows.
    assert.equal(nextStep('proposed', 'propose'), null);
});

test('claimable 0 is refused', () => {
    assert.throws(() => routeAmount(0n), ActionError);
    assert.equal(routeAmount(35_943_348n), 35_943_348n);
});
