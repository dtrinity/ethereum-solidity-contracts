// SPDX-License-Identifier: MIT
pragma solidity ^0.8.20;

import { BasisPointConstants } from "../../../common/BasisPointConstants.sol";

/**
 * @title AllocationCalculator
 * @notice Library for calculating allocations, deficits, and amount distributions
 * @dev Provides stateless functions for allocation calculations used in the DStake Morpho Router V2
 */
library AllocationCalculator {
    // Unused error types removed in refactor

    /**
     * @notice Calculates current allocations in basis points from vault balances
     * @dev Allocation for vault i = (balance[i] * BasisPointConstants.ONE_HUNDRED_PERCENT_BPS) / totalBalance
     * @param vaultBalances Array of vault balances
     * @return allocations Array of current allocations in basis points
     * @return totalBalance Sum of all vault balances
     */
    function calculateCurrentAllocations(
        uint256[] memory vaultBalances
    ) internal pure returns (uint256[] memory allocations, uint256 totalBalance) {
        if (vaultBalances.length == 0) {
            return (new uint256[](0), 0);
        }

        // Calculate total balance
        totalBalance = 0;
        for (uint256 i = 0; i < vaultBalances.length; i++) {
            totalBalance += vaultBalances[i];
        }

        allocations = new uint256[](vaultBalances.length);

        // Handle edge case where all balances are zero
        if (totalBalance == 0) {
            // All allocations remain 0
            return (allocations, totalBalance);
        }

        // Calculate allocations in basis points
        for (uint256 i = 0; i < vaultBalances.length; i++) {
            allocations[i] = (vaultBalances[i] * BasisPointConstants.ONE_HUNDRED_PERCENT_BPS) / totalBalance;
        }

        return (allocations, totalBalance);
    }

    // Unused AllocationCalculator helpers removed in refactor. Library intentionally only exposes
    // calculateCurrentAllocations for production usage.
}
