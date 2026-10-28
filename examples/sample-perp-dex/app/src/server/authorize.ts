// A trader's one signature margin deposit: an EIP-3009 ReceiveWithAuthorization
// naming the vault as the payee, so only the vault can submit it.
import { signReceiveAuthorization } from '@arbitrum-usdg/usdg';
import { toHex, type Address, type Hex, type LocalAccount } from 'viem';

// How long a signed deposit stays valid.
export const DEPOSIT_WINDOW_S = 3_600n;

export async function signDeposit(
    trader: LocalAccount,
    vault: Address,
    amount: bigint,
    // Block time on the chain, which runs ahead of the wall clock after the
    // fork's clock moves.
    now: bigint,
) {
    const nonce: Hex = toHex(crypto.getRandomValues(new Uint8Array(32)));
    const authorization = {
        from: trader.address,
        to: vault,
        value: amount,
        validAfter: 0n,
        validBefore: now + DEPOSIT_WINDOW_S,
        nonce,
    };
    const signature = await signReceiveAuthorization(trader, authorization);

    return { ...authorization, signature };
}

export type SignedDeposit = Awaited<ReturnType<typeof signDeposit>>;

// The vault call that carries the signed deposit.
export function depositArgs(d: SignedDeposit) {
    return [
        d.from,
        d.value,
        d.validAfter,
        d.validBefore,
        d.nonce,
        d.signature,
    ] as const;
}
