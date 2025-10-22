// SPDX-License-Identifier: MIT
pragma solidity ^0.8.20;

import "../../vaults/dstake/libraries/AllocationCalculator.sol";

/**
 * @title AllocationCalculatorHarness
 * @notice Test harness to expose library functions for unit testing
 */
contract AllocationCalculatorHarness {
    using AllocationCalculator for *;

    function calculateCurrentAllocations(
        uint256[] memory vaultBalances
    ) external pure returns (uint256[] memory allocations, uint256 totalBalance) {
        return AllocationCalculator.calculateCurrentAllocations(vaultBalances);
    }

    // All other helpers were removed in refactor to minimize surface area
}
