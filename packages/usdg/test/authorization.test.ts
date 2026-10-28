import assert from 'node:assert/strict';
import { test } from 'node:test';

import { hashDomain, keccak256, toHex } from 'viem';

import { receiveWithAuthorizationTypes, usdgDomain } from '../src/authorization.ts';

// Both constants come from the verified TokenExtensionsFacet on Arbitrum One:
// RECEIVE_WITH_AUTHORIZATION_TYPEHASH, and USDG.DOMAIN_SEPARATOR() read with cast.
test('the typed data matches the USDG contract', () => {
    const type = `ReceiveWithAuthorization(${receiveWithAuthorizationTypes.ReceiveWithAuthorization.map((f) => `${f.type} ${f.name}`).join(',')})`;

    assert.equal(
        keccak256(toHex(type)),
        '0xd099cc98ef71107a616c4f0f941f04c322d8e254fe26b3c6668db87aae413de8',
    );
    assert.equal(
        hashDomain({
            domain: usdgDomain(),
            types: {
                EIP712Domain: [
                    { name: 'name', type: 'string' },
                    { name: 'version', type: 'string' },
                    { name: 'chainId', type: 'uint256' },
                    { name: 'verifyingContract', type: 'address' },
                ],
            },
        }),
        '0x7391a9981c0db2d0877a1675128126c7c69badfeb3a80f6d1e194720ce92aefa',
    );
});
