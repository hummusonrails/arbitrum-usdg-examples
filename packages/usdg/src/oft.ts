import {
    size,
    slice,
    hexToBigInt,
    hexToNumber,
    pad,
    type Address,
    type Hex,
} from 'viem';

// The Paxos LayerZero OFT for USDG. USDG itself is not an OFT: on each chain a
// Paxos OFTWrapper burns and mints the native token. Addresses from
// https://docs.paxos.com/guides/stablecoin/usdg/mainnet.md
export const USDG_ETHEREUM: Address = '0xe343167631d89B6Ffc58B88d6b7fB0228795491D';

export type OftNetwork = 'arbitrumOne' | 'ethereum';

export const OFT: Record<OftNetwork, { address: Address; eid: number }> = {
    arbitrumOne: { address: '0xC3274Ec3f772D8534575EaAd5231cf250a48b6b6', eid: 30110 },
    ethereum: { address: '0x147BdE4F997f0d4C7544ED0C55eAcf1E5E6bf9c4', eid: 30101 },
};

// LayerZero EndpointV2, the same address on both chains.
export const LZ_ENDPOINT_V2: Address = '0x1a44076050125825900e736c501f859c50fE728c';

// The calls and events this repo uses, from the OFTWrapper ABI in
// paxosglobal/cross-chain-contracts.
export const oftAbi = [
    {
        anonymous: false,
        inputs: [
            {
                indexed: true,
                name: 'guid',
                type: 'bytes32',
            },
            {
                indexed: false,
                name: 'srcEid',
                type: 'uint32',
            },
            {
                indexed: true,
                name: 'toAddress',
                type: 'address',
            },
            {
                indexed: false,
                name: 'amountReceivedLD',
                type: 'uint256',
            },
        ],
        name: 'OFTReceived',
        type: 'event',
    },
    {
        anonymous: false,
        inputs: [
            {
                indexed: true,
                name: 'guid',
                type: 'bytes32',
            },
            {
                indexed: false,
                name: 'dstEid',
                type: 'uint32',
            },
            {
                indexed: true,
                name: 'fromAddress',
                type: 'address',
            },
            {
                indexed: false,
                name: 'amountSentLD',
                type: 'uint256',
            },
            {
                indexed: false,
                name: 'amountReceivedLD',
                type: 'uint256',
            },
        ],
        name: 'OFTSent',
        type: 'event',
    },
    {
        inputs: [
            {
                name: '_dstEid',
                type: 'uint32',
            },
        ],
        name: 'getAmountCanBeSent',
        outputs: [
            {
                name: 'currentAmountInFlight',
                type: 'uint256',
            },
            {
                name: 'amountCanBeSent',
                type: 'uint256',
            },
        ],
        stateMutability: 'view',
        type: 'function',
    },
    {
        inputs: [
            {
                components: [
                    {
                        name: 'srcEid',
                        type: 'uint32',
                    },
                    {
                        name: 'sender',
                        type: 'bytes32',
                    },
                    {
                        name: 'nonce',
                        type: 'uint64',
                    },
                ],
                name: '_origin',
                type: 'tuple',
            },
            {
                name: '_guid',
                type: 'bytes32',
            },
            {
                name: '_message',
                type: 'bytes',
            },
            {
                name: '_executor',
                type: 'address',
            },
            {
                name: '_extraData',
                type: 'bytes',
            },
        ],
        name: 'lzReceive',
        outputs: [],
        stateMutability: 'payable',
        type: 'function',
    },
    {
        inputs: [
            {
                components: [
                    {
                        name: 'dstEid',
                        type: 'uint32',
                    },
                    {
                        name: 'to',
                        type: 'bytes32',
                    },
                    {
                        name: 'amountLD',
                        type: 'uint256',
                    },
                    {
                        name: 'minAmountLD',
                        type: 'uint256',
                    },
                    {
                        name: 'extraOptions',
                        type: 'bytes',
                    },
                    {
                        name: 'composeMsg',
                        type: 'bytes',
                    },
                    {
                        name: 'oftCmd',
                        type: 'bytes',
                    },
                ],
                name: '_sendParam',
                type: 'tuple',
            },
            {
                name: '_payInLzToken',
                type: 'bool',
            },
        ],
        name: 'quoteSend',
        outputs: [
            {
                components: [
                    {
                        name: 'nativeFee',
                        type: 'uint256',
                    },
                    {
                        name: 'lzTokenFee',
                        type: 'uint256',
                    },
                ],
                name: 'msgFee',
                type: 'tuple',
            },
        ],
        stateMutability: 'view',
        type: 'function',
    },
    {
        inputs: [
            {
                components: [
                    {
                        name: 'dstEid',
                        type: 'uint32',
                    },
                    {
                        name: 'to',
                        type: 'bytes32',
                    },
                    {
                        name: 'amountLD',
                        type: 'uint256',
                    },
                    {
                        name: 'minAmountLD',
                        type: 'uint256',
                    },
                    {
                        name: 'extraOptions',
                        type: 'bytes',
                    },
                    {
                        name: 'composeMsg',
                        type: 'bytes',
                    },
                    {
                        name: 'oftCmd',
                        type: 'bytes',
                    },
                ],
                name: '_sendParam',
                type: 'tuple',
            },
            {
                components: [
                    {
                        name: 'nativeFee',
                        type: 'uint256',
                    },
                    {
                        name: 'lzTokenFee',
                        type: 'uint256',
                    },
                ],
                name: '_fee',
                type: 'tuple',
            },
            {
                name: '_refundAddress',
                type: 'address',
            },
        ],
        name: 'send',
        outputs: [
            {
                components: [
                    {
                        name: 'guid',
                        type: 'bytes32',
                    },
                    {
                        name: 'nonce',
                        type: 'uint64',
                    },
                    {
                        components: [
                            {
                                name: 'nativeFee',
                                type: 'uint256',
                            },
                            {
                                name: 'lzTokenFee',
                                type: 'uint256',
                            },
                        ],
                        name: 'fee',
                        type: 'tuple',
                    },
                ],
                name: 'msgReceipt',
                type: 'tuple',
            },
            {
                components: [
                    {
                        name: 'amountSentLD',
                        type: 'uint256',
                    },
                    {
                        name: 'amountReceivedLD',
                        type: 'uint256',
                    },
                ],
                name: 'oftReceipt',
                type: 'tuple',
            },
        ],
        stateMutability: 'payable',
        type: 'function',
    },
] as const;

export const packetSentEvent = {
    type: 'event',
    name: 'PacketSent',
    inputs: [
        { name: 'encodedPayload', type: 'bytes', indexed: false },
        { name: 'options', type: 'bytes', indexed: false },
        { name: 'sendLibrary', type: 'address', indexed: false },
    ],
} as const;

// LayerZero addresses an account on any chain as 32 bytes.
export function toBytes32(address: Address): Hex {
    return pad(address, { size: 32 });
}

export type Packet = {
    nonce: bigint;
    srcEid: number;
    sender: Hex;
    dstEid: number;
    receiver: Hex;
    guid: Hex;
    message: Hex;
};

// Splits a v1 packet from PacketSent: version (1 byte), nonce (8), source eid
// (4), sender (32), destination eid (4), receiver (32), guid (32), message.
export function decodePacket(encoded: Hex): Packet {
    if (size(encoded) < 113) {
        throw new Error('A LayerZero packet is at least 113 bytes');
    }

    return {
        nonce: hexToBigInt(slice(encoded, 1, 9)),
        srcEid: hexToNumber(slice(encoded, 9, 13)),
        sender: slice(encoded, 13, 45),
        dstEid: hexToNumber(slice(encoded, 45, 49)),
        receiver: slice(encoded, 49, 81),
        guid: slice(encoded, 81, 113),
        message: slice(encoded, 113),
    };
}
