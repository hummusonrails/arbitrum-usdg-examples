import {
    BaseError,
    ContractFunctionRevertedError,
    decodeErrorResult,
    type Hex,
} from 'viem';

import { usdgAbi } from './abi.ts';

export type UsdgErrorCode =
    | 'AddressFrozen'
    | 'ContractPaused'
    | 'ZeroAddress'
    | 'FacetNotFound'
    | 'InsufficientFunds'
    | 'Unknown';

const MESSAGES: Record<UsdgErrorCode, string> = {
    AddressFrozen:
        'The sender or recipient is frozen by the token issuer, so USDG cannot move.',
    ContractPaused: 'USDG transfers are paused by the token issuer.',
    ZeroAddress: 'USDG cannot be sent to the zero address.',
    FacetNotFound: 'The USDG contract does not support this call.',
    InsufficientFunds: 'The wallet does not hold enough USDG for this transfer.',
    Unknown: 'The USDG call reverted.',
};

function codeFromData(data: Hex | undefined): UsdgErrorCode | undefined {
    if (!data || data === '0x') {
        return undefined;
    }

    try {
        const { errorName } = decodeErrorResult({ abi: usdgAbi, data });

        return errorName in MESSAGES ? (errorName as UsdgErrorCode) : undefined;
    } catch {
        return undefined;
    }
}

// Turns a viem error from a USDG read, simulation, or write into a code and a
// plain sentence the dashboard can show.
export function decodeUsdgError(err: unknown): {
    code: UsdgErrorCode;
    message: string;
} {
    let code: UsdgErrorCode = 'Unknown';

    if (err instanceof BaseError) {
        const reverted = err.walk((e) => e instanceof ContractFunctionRevertedError);

        if (reverted instanceof ContractFunctionRevertedError) {
            const name = reverted.data?.errorName;

            code =
                name && name in MESSAGES
                    ? (name as UsdgErrorCode)
                    : (codeFromData(reverted.raw) ?? 'Unknown');
        } else {
            const withData = err.walk(
                (e) => typeof (e as { data?: unknown }).data === 'string',
            );

            code = codeFromData((withData as { data?: Hex } | null)?.data) ?? 'Unknown';
        }
    }

    return { code, message: MESSAGES[code] };
}
