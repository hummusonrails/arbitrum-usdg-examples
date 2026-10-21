// ABI fragments for the vaults and the contracts around them, taken from the
// verified sources on Arbitrum One.
import { parseAbi } from 'viem';

// Morpho Vault V2 is ERC-4626 plus gate checks. Its max functions always
// return 0, so they are left out on purpose.
export const vaultV2Abi = parseAbi([
    'function asset() view returns (address)',
    'function totalAssets() view returns (uint256)',
    'function totalSupply() view returns (uint256)',
    'function balanceOf(address) view returns (uint256)',
    'function convertToAssets(uint256 shares) view returns (uint256)',
    'function previewDeposit(uint256 assets) view returns (uint256)',
    'function previewWithdraw(uint256 assets) view returns (uint256)',
    'function previewRedeem(uint256 shares) view returns (uint256)',
    'function deposit(uint256 assets, address onBehalf) returns (uint256)',
    'function redeem(uint256 shares, address receiver, address onBehalf) returns (uint256)',
    'function canReceiveShares(address) view returns (bool)',
    'function canSendShares(address) view returns (bool)',
    'function canReceiveAssets(address) view returns (bool)',
    'function canSendAssets(address) view returns (bool)',
    'event Deposit(address indexed sender, address indexed onBehalf, uint256 assets, uint256 shares)',
    'event Withdraw(address indexed sender, address indexed receiver, address indexed onBehalf, uint256 assets, uint256 shares)',
    'error AbsoluteCapExceeded()',
    'error RelativeCapExceeded()',
    'error CannotReceiveShares()',
    'error CannotSendShares()',
    'error CannotReceiveAssets()',
    'error CannotSendAssets()',
]);

const createGlvDepositParams =
    '((address glv, address market, address receiver, address callbackContract, address uiFeeReceiver, address initialLongToken, address initialShortToken, address[] longTokenSwapPath, address[] shortTokenSwapPath) addresses, uint256 minGlvTokens, uint256 executionFee, uint256 callbackGasLimit, bool shouldUnwrapNativeToken, bool isMarketTokenDeposit, bytes32[] dataList)';
const createGlvWithdrawalParams =
    '((address receiver, address callbackContract, address uiFeeReceiver, address market, address glv, address[] longTokenSwapPath, address[] shortTokenSwapPath) addresses, uint256 minLongTokenAmount, uint256 minShortTokenAmount, bool shouldUnwrapNativeToken, uint256 executionFee, uint256 callbackGasLimit, bytes32[] dataList)';

export const glvRouterAbi = parseAbi([
    'function multicall(bytes[] data) payable returns (bytes[] results)',
    'function sendWnt(address receiver, uint256 amount) payable',
    'function sendTokens(address token, address receiver, uint256 amount) payable',
    `function createGlvDeposit(${createGlvDepositParams} params) payable returns (bytes32)`,
    `function createGlvWithdrawal(${createGlvWithdrawalParams} params) payable returns (bytes32)`,
    'function cancelGlvDeposit(bytes32 key)',
    'function cancelGlvWithdrawal(bytes32 key)',
]);

export const dataStoreAbi = parseAbi([
    'function getUint(bytes32 key) view returns (uint256)',
    'function getAddress(bytes32 key) view returns (address)',
    'function getAddressValuesAt(bytes32 setKey, uint256 start, uint256 end) view returns (address[])',
    'function getAddressCount(bytes32 setKey) view returns (uint256)',
]);

export const roleStoreAbi = parseAbi([
    'function hasRole(address account, bytes32 roleKey) view returns (bool)',
]);

export const glvHandlerAbi = parseAbi([
    'function executeGlvDeposit(bytes32 key, (address[] tokens, address[] providers, bytes[] data) oracleParams)',
    'function executeGlvWithdrawal(bytes32 key, (address[] tokens, address[] providers, bytes[] data) oracleParams)',
]);

// GMX reports request lifecycles through one generic event whose payload is a
// set of typed key/value lists.
const eventData = {
    name: 'eventData',
    type: 'tuple',
    indexed: false,
    components: [
        kv('addressItems', 'address'),
        kv('uintItems', 'uint256'),
        kv('intItems', 'int256'),
        kv('boolItems', 'bool'),
        kv('bytes32Items', 'bytes32'),
        kv('bytesItems', 'bytes'),
        kv('stringItems', 'string'),
    ],
} as const;
const head = [
    { name: 'msgSender', type: 'address', indexed: false },
    { name: 'eventName', type: 'string', indexed: false },
    { name: 'eventNameHash', type: 'string', indexed: true },
] as const;

export const eventEmitterAbi = [
    { type: 'event', name: 'EventLog', anonymous: false, inputs: [...head, eventData] },
    {
        type: 'event',
        name: 'EventLog1',
        anonymous: false,
        inputs: [
            ...head,
            { name: 'topic1', type: 'bytes32', indexed: true },
            eventData,
        ],
    },
    {
        type: 'event',
        name: 'EventLog2',
        anonymous: false,
        inputs: [
            ...head,
            { name: 'topic1', type: 'bytes32', indexed: true },
            { name: 'topic2', type: 'bytes32', indexed: true },
            eventData,
        ],
    },
] as const;

function kv<N extends string, T extends string>(name: N, type: T) {
    return {
        name,
        type: 'tuple',
        components: [
            {
                name: 'items',
                type: 'tuple[]',
                components: [
                    { name: 'key', type: 'string' },
                    { name: 'value', type },
                ],
            },
            {
                name: 'arrayItems',
                type: 'tuple[]',
                components: [
                    { name: 'key', type: 'string' },
                    { name: 'value', type: `${type}[]` },
                ],
            },
        ],
    } as const;
}

export const merklDistributorAbi = parseAbi([
    'function claim(address[] users, address[] tokens, uint256[] amounts, bytes32[][] proofs)',
    'function claimed(address user, address token) view returns (uint208 amount, uint48 timestamp, bytes32 merkleRoot)',
    'function getMerkleRoot() view returns (bytes32)',
    'function accessControlManager() view returns (address)',
    'function updateTree((bytes32 merkleRoot, bytes32 ipfsHash) tree)',
    'function setDisputePeriod(uint48 disputePeriod)',
    'function setEpochDuration(uint32 epochDuration)',
    'event Claimed(address indexed user, address indexed token, uint256 amount)',
]);

export const accessControlManagerAbi = parseAbi([
    'function GOVERNOR_ROLE() view returns (bytes32)',
    'function getRoleMember(bytes32 role, uint256 index) view returns (address)',
]);
