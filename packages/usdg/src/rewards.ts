import type { Address } from 'viem';

// The Global Dollar Network rewards engine, built into the USDG token. USDG
// routes each call to a facet: PayoutGroupFacet for registration and reads,
// ClaimableRewardsFacet for claims. Signatures from the verified PayoutGroupFacet
// source and paxosglobal/paxos-token-contracts.

// Holds PAYOUT_GROUP_REGISTRAR_ROLE on Arbitrum One. Only Paxos creates payout
// groups; the fork stand in impersonates this account to do it locally.
export const PAYOUT_GROUP_REGISTRAR: Address =
    '0x55f78e37adb9d1f6931c1da7314b374558ae9684';

const uint32 = (name: string) => ({ name, type: 'uint32' }) as const;
const address = (name: string) => ({ name, type: 'address' }) as const;

export const usdgRewardsAbi = [
    {
        type: 'function',
        name: 'proposeRegisterRewardAddress',
        stateMutability: 'nonpayable',
        inputs: [uint32('payoutGroupId'), address('account')],
        outputs: [],
    },
    {
        type: 'function',
        name: 'acceptRegisterRewardAddress',
        stateMutability: 'nonpayable',
        inputs: [uint32('payoutGroupId')],
        outputs: [],
    },
    {
        type: 'function',
        name: 'cancelRegistrationProposal',
        stateMutability: 'nonpayable',
        inputs: [address('account')],
        outputs: [],
    },
    {
        type: 'function',
        name: 'getPendingRegistration',
        stateMutability: 'view',
        inputs: [address('account')],
        outputs: [uint32('payoutGroupId'), address('proposer')],
    },
    {
        type: 'function',
        name: 'payoutGroupIdOf',
        stateMutability: 'view',
        inputs: [address('account')],
        outputs: [{ type: 'uint32' }],
    },
    {
        type: 'function',
        name: 'availableRewardsOf',
        stateMutability: 'view',
        inputs: [address('account')],
        outputs: [{ type: 'uint256' }],
    },
    {
        type: 'function',
        name: 'getPayoutGroupAvailableRewards',
        stateMutability: 'view',
        inputs: [uint32('payoutGroupId')],
        outputs: [{ type: 'uint256' }],
    },
    {
        type: 'function',
        name: 'getPayoutGroupClaimer',
        stateMutability: 'view',
        inputs: [uint32('payoutGroupId')],
        outputs: [{ type: 'address' }],
    },
    {
        type: 'function',
        name: 'getPayoutGroupDestination',
        stateMutability: 'view',
        inputs: [uint32('payoutGroupId')],
        outputs: [{ type: 'address' }],
    },
    {
        type: 'function',
        name: 'claimForAddresses',
        stateMutability: 'nonpayable',
        inputs: [uint32('payoutGroupId'), { name: 'accounts', type: 'address[]' }],
        outputs: [{ name: 'totalClaimed', type: 'uint256' }],
    },
    {
        type: 'function',
        name: 'createPayoutGroupWithRoles',
        stateMutability: 'nonpayable',
        inputs: [
            uint32('multiplierId'),
            address('claimer'),
            address('manager'),
            address('destination'),
        ],
        outputs: [uint32('payoutId')],
    },
    {
        type: 'event',
        name: 'PayoutGroupCreated',
        inputs: [
            { name: 'payoutGroupId', type: 'uint32', indexed: true },
            { name: 'claimer', type: 'address', indexed: true },
            { name: 'multiplierId', type: 'uint32', indexed: true },
        ],
    },
    {
        type: 'event',
        name: 'RegistrationProposed',
        inputs: [
            { name: 'account', type: 'address', indexed: true },
            { name: 'payoutGroupId', type: 'uint32', indexed: true },
            { name: 'proposer', type: 'address', indexed: true },
        ],
    },
    {
        type: 'event',
        name: 'RegistrationAccepted',
        inputs: [
            { name: 'account', type: 'address', indexed: true },
            { name: 'payoutGroupId', type: 'uint32', indexed: true },
        ],
    },
    {
        type: 'event',
        name: 'RegistrationProposalCancelled',
        inputs: [
            { name: 'account', type: 'address', indexed: true },
            { name: 'payoutGroupId', type: 'uint32', indexed: true },
            { name: 'proposer', type: 'address', indexed: true },
        ],
    },
    {
        type: 'event',
        name: 'AccountRegistered',
        inputs: [
            { name: 'account', type: 'address', indexed: true },
            { name: 'payoutGroupId', type: 'uint32', indexed: true },
            { name: 'claimer', type: 'address', indexed: true },
        ],
    },
    {
        type: 'event',
        name: 'RewardsClaimed',
        inputs: [
            { name: 'account', type: 'address', indexed: true },
            { name: 'payoutGroupId', type: 'uint32', indexed: true },
            { name: 'recipient', type: 'address', indexed: true },
            { name: 'amount', type: 'uint256', indexed: false },
        ],
    },
] as const;
