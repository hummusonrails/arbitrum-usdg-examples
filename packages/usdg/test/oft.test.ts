import assert from 'node:assert/strict';
import { test } from 'node:test';

import { encodePacked } from 'viem';

import { decodePacket } from '../src/oft.ts';

test('decodes a v1 packet', () => {
    const sender = `0x${'11'.repeat(32)}` as const;
    const receiver = `0x${'22'.repeat(32)}` as const;
    const guid = `0x${'33'.repeat(32)}` as const;
    const message = `0x${'44'.repeat(40)}` as const;
    const packet = encodePacked(
        [
            'uint8',
            'uint64',
            'uint32',
            'bytes32',
            'uint32',
            'bytes32',
            'bytes32',
            'bytes',
        ],
        [1, 141n, 30110, sender, 30101, receiver, guid, message],
    );

    assert.deepEqual(decodePacket(packet), {
        nonce: 141n,
        srcEid: 30110,
        sender,
        dstEid: 30101,
        receiver,
        guid,
        message,
    });
});
