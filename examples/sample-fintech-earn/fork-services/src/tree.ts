// Merkle trees in the format Merkl's Distributor verifies: each leaf is
// keccak256(abi.encode(user, token, cumulativeAmount)) and each pair is hashed
// smaller first with abi.encode.
import { encodeAbiParameters, keccak256, type Address, type Hex } from 'viem';

export type Leaf = { user: Address; token: Address; amount: bigint };

export function leafHash(leaf: Leaf): Hex {
    return keccak256(
        encodeAbiParameters(
            [{ type: 'address' }, { type: 'address' }, { type: 'uint256' }],
            [leaf.user, leaf.token, leaf.amount],
        ),
    );
}

function pair(a: Hex, b: Hex): Hex {
    const [x, y] = a < b ? [a, b] : [b, a];

    return keccak256(
        encodeAbiParameters([{ type: 'bytes32' }, { type: 'bytes32' }], [x, y]),
    );
}

// Returns the root and a proof for every leaf, in input order.
export function buildTree(leaves: Leaf[]): { root: Hex; proofs: Hex[][] } {
    let level = leaves.map(leafHash);
    const proofs: Hex[][] = leaves.map(() => []);
    let index = leaves.map((_, i) => i);

    while (level.length > 1) {
        const next: Hex[] = [];

        for (let i = 0; i < level.length; i += 2) {
            const left = level[i]!;
            const right = level[i + 1];

            next.push(right ? pair(left, right) : left);
        }

        index = index.map((pos, leaf) => {
            const sibling = pos ^ 1;

            if (sibling < level.length) {
                proofs[leaf]!.push(level[sibling]!);
            }

            return pos >> 1;
        });
        level = next;
    }

    return { root: level[0]!, proofs };
}
