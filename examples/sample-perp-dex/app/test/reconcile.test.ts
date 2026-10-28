import assert from 'node:assert/strict';
import { test } from 'node:test';

import { reconcileVault } from '../src/server/reconcile.ts';

const books = {
    usdgBalance: 268_668_949_395n,
    totalFreeMargin: 17_288_002_468n,
    totalCollateral: 0n,
    liquidity: 251_373_145_217n,
    reservedLiquidity: 0n,
    rewardsHeld: 7_801_710n,
    traderFreeMargin: 17_288_002_468n,
    positionCollateral: 0n,
    claimedRecorded: 163_949_395n,
    claimedOnchain: 163_949_395n,
    routedOnchain: 163_949_395n,
};

const rule = (b: typeof books, name: string) =>
    reconcileVault(b).find((c) => c.rule === name)!;

test('USDG sent straight to the vault is surplus, not drift', () => {
    const vault = rule({ ...books, usdgBalance: books.usdgBalance + 5n }, 'vault');

    assert.equal(vault.status, 'matched');
    assert.equal(vault.surplus, 5n);
});

test('a vault short of what it owes is drift', () => {
    assert.equal(
        rule({ ...books, usdgBalance: books.usdgBalance - 1n }, 'vault').status,
        'drift',
    );
});

test('a house that cannot cover its reserve is drift', () => {
    assert.equal(
        rule({ ...books, reservedLiquidity: books.liquidity + 1n }, 'house').status,
        'drift',
    );
});

test('a claim not yet routed is drift', () => {
    assert.equal(rule({ ...books, routedOnchain: 0n }, 'routing').status, 'drift');
    assert.equal(rule({ ...books, routedOnchain: 0n }, 'claims').status, 'matched');
});
