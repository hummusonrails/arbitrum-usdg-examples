import { type Address, type Hex, type LocalAccount } from 'viem';

import { USDG } from './networks.ts';

// EIP-3009 signed transfers on USDG, implemented by Paxos's TokenExtensionsFacet
// and routed through the USDG token. The domain is recomputed per call from
// the token name and the chain, so a signature is valid on one chain only.
export function usdgDomain(
    chainId: number = USDG.arbitrumOne.chain.id,
    verifyingContract: Address = USDG.arbitrumOne.address,
) {
    return { name: 'Global Dollar', version: '1', chainId, verifyingContract } as const;
}

const fields = [
    { name: 'from', type: 'address' },
    { name: 'to', type: 'address' },
    { name: 'value', type: 'uint256' },
    { name: 'validAfter', type: 'uint256' },
    { name: 'validBefore', type: 'uint256' },
    { name: 'nonce', type: 'bytes32' },
] as const;

// receiveWithAuthorization only lets `to` submit the signature, so nobody can
// front run it into a plain transfer. Use it when a contract pulls the funds.
export const receiveWithAuthorizationTypes = {
    ReceiveWithAuthorization: fields,
} as const;

export type Authorization = {
    from: Address;
    to: Address;
    value: bigint;
    validAfter: bigint;
    validBefore: bigint;
    // 32 random bytes. USDG tracks used nonces per signer, in any order.
    nonce: Hex;
};

export async function signReceiveAuthorization(
    account: LocalAccount,
    authorization: Authorization,
    domain = usdgDomain(),
): Promise<Hex> {
    return account.signTypedData({
        domain,
        types: receiveWithAuthorizationTypes,
        primaryType: 'ReceiveWithAuthorization',
        message: authorization,
    });
}

export const usdgAuthorizationAbi = [
    {
        type: 'function',
        name: 'authorizationState',
        stateMutability: 'view',
        inputs: [
            { name: 'authorizer', type: 'address' },
            { name: 'nonce', type: 'bytes32' },
        ],
        outputs: [{ type: 'bool' }],
    },
    {
        type: 'function',
        name: 'receiveWithAuthorization',
        stateMutability: 'nonpayable',
        inputs: [
            { name: 'from', type: 'address' },
            { name: 'to', type: 'address' },
            { name: 'value', type: 'uint256' },
            { name: 'validAfter', type: 'uint256' },
            { name: 'validBefore', type: 'uint256' },
            { name: 'nonce', type: 'bytes32' },
            { name: 'signature', type: 'bytes' },
        ],
        outputs: [],
    },
    {
        type: 'function',
        name: 'DOMAIN_SEPARATOR',
        stateMutability: 'view',
        inputs: [],
        outputs: [{ type: 'bytes32' }],
    },
    {
        type: 'event',
        name: 'AuthorizationUsed',
        inputs: [
            { name: 'authorizer', type: 'address', indexed: true },
            { name: 'nonce', type: 'bytes32', indexed: true },
        ],
    },
    // Emitted instead of a revert when a used nonce is submitted again. No
    // USDG moves, so a contract must check its balance, not just the call.
    {
        type: 'event',
        name: 'AuthorizationAlreadyUsed',
        inputs: [
            { name: 'authorizer', type: 'address', indexed: true },
            { name: 'nonce', type: 'bytes32', indexed: true },
        ],
    },
    { type: 'error', name: 'CallerMustBePayee', inputs: [] },
    { type: 'error', name: 'AuthorizationInvalid', inputs: [] },
    { type: 'error', name: 'AuthorizationExpired', inputs: [] },
    { type: 'error', name: 'InvalidSignature', inputs: [] },
] as const;
