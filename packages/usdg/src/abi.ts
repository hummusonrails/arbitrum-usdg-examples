export const usdgAbi = [
    {
        type: 'function',
        name: 'balanceOf',
        stateMutability: 'view',
        inputs: [{ name: 'addr', type: 'address' }],
        outputs: [{ type: 'uint256' }],
    },
    {
        type: 'function',
        name: 'transfer',
        stateMutability: 'nonpayable',
        inputs: [
            { name: 'to', type: 'address' },
            { name: 'value', type: 'uint256' },
        ],
        outputs: [{ type: 'bool' }],
    },
    {
        type: 'function',
        name: 'decimals',
        stateMutability: 'view',
        inputs: [],
        outputs: [{ type: 'uint8' }],
    },
    {
        type: 'function',
        name: 'paused',
        stateMutability: 'view',
        inputs: [],
        outputs: [{ type: 'bool' }],
    },
    {
        type: 'function',
        name: 'isFrozen',
        stateMutability: 'view',
        inputs: [{ name: 'addr', type: 'address' }],
        outputs: [{ type: 'bool' }],
    },
    {
        type: 'event',
        name: 'Transfer',
        inputs: [
            { name: 'from', type: 'address', indexed: true },
            { name: 'to', type: 'address', indexed: true },
            { name: 'value', type: 'uint256', indexed: false },
        ],
    },
    { type: 'error', name: 'AddressFrozen', inputs: [] },
    { type: 'error', name: 'ContractPaused', inputs: [] },
    { type: 'error', name: 'ZeroAddress', inputs: [] },
    { type: 'error', name: 'FacetNotFound', inputs: [] },
    { type: 'error', name: 'InsufficientFunds', inputs: [] },
] as const;
