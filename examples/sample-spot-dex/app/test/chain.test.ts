import assert from 'node:assert/strict';
import { test } from 'node:test';

import { acmePoolAbi } from '@arbitrum-usdg/spot-dex-contracts';
import {
    ContractFunctionExecutionError,
    ContractFunctionRevertedError,
    encodeErrorResult,
    zeroAddress,
} from 'viem';

import { ActionError, revertMessage } from '../src/server/chain.ts';

// The error viem throws when simulating a call that the contract reverts.
function reverted(errorName: 'InsufficientOutput' | 'NoLiquidity') {
    const cause = new ContractFunctionRevertedError({
        abi: acmePoolAbi,
        data: encodeErrorResult({ abi: acmePoolAbi, errorName }),
        functionName: 'swapExactIn',
    });

    return new ContractFunctionExecutionError(cause, {
        abi: acmePoolAbi,
        args: [zeroAddress, 1n, 2n, zeroAddress],
        functionName: 'swapExactIn',
    });
}

test('a missed minimum reads plainly', () => {
    const err = revertMessage(reverted('InsufficientOutput'));

    assert.ok(err instanceof ActionError);
    assert.match(err.message, /price moved past your minimum/);
});

test('routing with no LPs reads plainly', () => {
    assert.match(revertMessage(reverted('NoLiquidity'))!.message, /no LPs/i);
});

test('other errors pass through', () => {
    assert.equal(revertMessage(new Error('socket hang up')), null);
});
