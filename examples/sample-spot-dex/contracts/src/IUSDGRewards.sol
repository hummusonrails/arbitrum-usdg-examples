// SPDX-License-Identifier: MIT
pragma solidity 0.8.28;

/// @notice The one USDG rewards engine call a pool makes itself. The full
/// interface lives in Paxos's PayoutGroupFacet, routed through the USDG token.
interface IUSDGRewards {
    /// @notice Accepts a pending registration proposed for the caller.
    function acceptRegisterRewardAddress(uint32 payoutGroupId) external;
}
