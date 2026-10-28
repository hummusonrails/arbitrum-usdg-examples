// SPDX-License-Identifier: MIT
pragma solidity 0.8.28;

/// @notice The two USDG calls the margin vault makes itself. Paxos routes them
/// through the USDG token to its facets: the rewards engine's PayoutGroupFacet
/// and the TokenExtensionsFacet that implements EIP-3009.
interface IUSDG {
    /// @notice Accepts a pending rewards registration proposed for the caller.
    function acceptRegisterRewardAddress(uint32 payoutGroupId) external;

    /// @notice Moves `value` from `from` to the caller with `from`'s EIP-3009
    /// signature. The caller must be `to`. A nonce that was already used makes
    /// the call return without moving any USDG.
    function receiveWithAuthorization(
        address from,
        address to,
        uint256 value,
        uint256 validAfter,
        uint256 validBefore,
        bytes32 nonce,
        bytes memory signature
    ) external;
}
