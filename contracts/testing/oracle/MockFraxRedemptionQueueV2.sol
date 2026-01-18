// SPDX-License-Identifier: MIT
pragma solidity ^0.8.20;

/**
 * @title MockFraxRedemptionQueueV2
 * @notice Minimal mock exposing redemptionQueueState for testing.
 */
contract MockFraxRedemptionQueueV2 {
    uint64 public redemptionFee; // 1e6 precision
    bool public shouldRevert;

    function setRedemptionFee(uint64 feeE6) external {
        redemptionFee = feeE6;
    }

    function setShouldRevert(bool value) external {
        shouldRevert = value;
    }

    function redemptionQueueState()
        external
        view
        returns (
            uint64 nextNftId,
            uint64 queueLengthSecs,
            uint64 redemptionFeeE6,
            uint120 ttlEthRequested,
            uint120 ttlEthServed
        )
    {
        if (shouldRevert) revert("MockFraxRedemptionQueueV2: revert requested");
        return (0, 0, redemptionFee, 0, 0);
    }
}
