// SPDX-License-Identifier: MIT
pragma solidity ^0.8.20;

contract RevertingOracleTarget {
    function getConsolidatedEthFrxEthBalanceView(bool) external pure {
        revert("forced revert");
    }

    function redemptionQueueState() external pure returns (uint64, uint64, uint64, uint120, uint120) {
        revert("forced revert");
    }
}
