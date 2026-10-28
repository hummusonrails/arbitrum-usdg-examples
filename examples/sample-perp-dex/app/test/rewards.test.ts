import assert from 'node:assert/strict';
import { test } from 'node:test';

import { ActionError } from '../src/server/chain.ts';
import { nextStep, routeAmount } from '../src/server/rewards.ts';

test('accept before propose is refused', () => {
    assert.match(nextStep('unregistered', 'accept')!, /Propose the vault first/);
});

test('propose for a registered vault is refused', () => {
    assert.match(nextStep('registered', 'propose')!, /already registered/);
});

test('cancel without a proposal is refused', () => {
    assert.match(nextStep('unregistered', 'cancel')!, /no pending proposal/);
});

test('valid steps are allowed', () => {
    assert.equal(nextStep('unregistered', 'propose'), null);
    assert.equal(nextStep('proposed', 'accept'), null);
    assert.equal(nextStep('proposed', 'cancel'), null);
});

test('claimable 0 is refused', () => {
    assert.throws(() => routeAmount(0n), ActionError);
    assert.equal(routeAmount(163_949_395n), 163_949_395n);
});
