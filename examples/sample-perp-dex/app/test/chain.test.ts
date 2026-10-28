import assert from 'node:assert/strict';
import { test } from 'node:test';

import {
    ContractFunctionExecutionError,
    ContractFunctionRevertedError,
    encodeErrorResult,
    zeroAddress,
} from 'viem';

import { ActionError, revertMessage, vaultAbi } from '../src/server/chain.ts';

// The error viem throws when simulating a call that the vault reverts.
function reverted(errorName: 'DepositNotReceived' | 'StalePrice' | 'PriceSlippage') {
    const cause = new ContractFunctionRevertedError({
        abi: vaultAbi,
        data: encodeErrorResult({ abi: vaultAbi, errorName }),
        functionName: 'openPosition',
    });

    return new ContractFunctionExecutionError(cause, {
        abi: vaultAbi,
        args: [zeroAddress],
        functionName: 'openPosition',
    });
}

test('a replayed deposit reads plainly', () => {
    const err = revertMessage(reverted('DepositNotReceived'));

    assert.ok(err instanceof ActionError);
    assert.match(err.message, /no margin was credited/);
});

// StalePrice is the oracle's error, bubbled up through the vault.
test('an oracle revert reads plainly through the vault', () => {
    assert.match(revertMessage(reverted('StalePrice'))!.message, /out of date/);
});

test('other errors pass through', () => {
    assert.equal(revertMessage(new Error('socket hang up')), null);
});
