// SPDX-License-Identifier: MIT
pragma solidity ^0.8.20;

/**
 * @title DeterministicVaultSelector
 * @notice Library for selecting vaults based on allocation deltas for optimal rebalancing
 * @dev Used by DStake Router V2 to deterministically select top under/over allocated vaults
 *      during deposits and withdrawals. Provides gas-efficient alternative to weighted random
 *      selection by using partial sort algorithm for predictable vault selection.
 *
 * Key Features:
 * - Allocation-based prioritization: Selects most misallocated vaults to converge toward targets
 * - Partial sort algorithm: O(k*n) complexity optimized for selecting 1-3 vaults from 5-10 total
 */
library DeterministicVaultSelector {
    /// @dev Error thrown when arrays have mismatched lengths
    error ArrayLengthMismatch();

    /// @dev Error thrown when no items are available for selection
    error NoItemsAvailable();

    /// @dev Error thrown when requesting more items than available
    error InsufficientItems();

    /// @dev Error thrown when selection count is zero
    error InvalidSelectionCount();

    /**
     * @dev Struct to hold vault data during sorting operations
     */
    struct VaultData {
        address vault;
        uint256 delta;
        uint256 originalIndex;
    }

    /**
     * @notice Calculates underallocation amounts for deposit weight calculation
     * @dev Underallocation = max(0, targetBps - currentBps) for underweight vaults
     * @param currentAllocations Array of current allocations in basis points
     * @param targetAllocations Array of target allocations in basis points
     * @return underallocations Array of calculated underallocations
     */
    function calculateUnderallocations(
        uint256[] memory currentAllocations,
        uint256[] memory targetAllocations
    ) internal pure returns (uint256[] memory underallocations) {
        if (currentAllocations.length != targetAllocations.length) {
            revert ArrayLengthMismatch();
        }

        underallocations = new uint256[](currentAllocations.length);

        for (uint256 i = 0; i < currentAllocations.length; i++) {
            // Underallocation = max(0, target - current) for underweight vaults
            if (targetAllocations[i] > currentAllocations[i]) {
                underallocations[i] = targetAllocations[i] - currentAllocations[i];
            } else {
                underallocations[i] = 0;
            }
        }

        return underallocations;
    }

    /**
     * @notice Calculates overallocation amounts for withdrawal weight calculation
     * @dev Overallocation = max(0, currentBps - targetBps) for overweight vaults
     * @param currentAllocations Array of current allocations in basis points
     * @param targetAllocations Array of target allocations in basis points
     * @return overallocations Array of calculated overallocations
     */
    function calculateOverallocations(
        uint256[] memory currentAllocations,
        uint256[] memory targetAllocations
    ) internal pure returns (uint256[] memory overallocations) {
        if (currentAllocations.length != targetAllocations.length) {
            revert ArrayLengthMismatch();
        }

        overallocations = new uint256[](currentAllocations.length);

        for (uint256 i = 0; i < currentAllocations.length; i++) {
            // Overallocation = max(0, current - target) for overweight vaults
            if (currentAllocations[i] > targetAllocations[i]) {
                overallocations[i] = currentAllocations[i] - targetAllocations[i];
            } else {
                overallocations[i] = 0;
            }
        }

        return overallocations;
    }

    /**
     * @notice Selects top X most underallocated vaults for deposit operations
     * @dev Uses partial sort algorithm to find vaults with highest (target - current) deltas
     * @param vaults Array of vault addresses to select from
     * @param currentBps Array of current allocations in basis points
     * @param targetBps Array of target allocations in basis points
     * @param count Number of vaults to select (must be <= vaults.length)
     * @return selectedVaults Array of selected vault addresses
     * @return selectedIndices Array of indices of selected vaults in original array
     */
    function selectTopUnderallocated(
        address[] memory vaults,
        uint256[] memory currentBps,
        uint256[] memory targetBps,
        uint256 count
    ) internal pure returns (address[] memory selectedVaults, uint256[] memory selectedIndices) {
        if (vaults.length != currentBps.length || currentBps.length != targetBps.length) {
            revert ArrayLengthMismatch();
        }

        if (vaults.length == 0) {
            revert NoItemsAvailable();
        }

        if (count == 0) {
            revert InvalidSelectionCount();
        }

        if (count > vaults.length) {
            revert InsufficientItems();
        }

        // Calculate underallocations
        uint256[] memory underallocations = calculateUnderallocations(currentBps, targetBps);

        // Check if any underallocations exist
        bool hasUnderallocations = false;
        for (uint256 i = 0; i < underallocations.length; i++) {
            if (underallocations[i] > 0) {
                hasUnderallocations = true;
                break;
            }
        }

        // If no underallocations, select first count vaults deterministically
        if (!hasUnderallocations) {
            selectedVaults = new address[](count);
            selectedIndices = new uint256[](count);
            for (uint256 i = 0; i < count; i++) {
                selectedVaults[i] = vaults[i];
                selectedIndices[i] = i;
            }
            return (selectedVaults, selectedIndices);
        }

        // Use partial sort to find top count underallocated vaults
        return _selectTopVaultsByDelta(vaults, underallocations, count);
    }

    /**
     * @notice Selects top X most overallocated vaults for withdrawal operations
     * @dev Uses partial sort algorithm to find vaults with highest (current - target) deltas
     * @param vaults Array of vault addresses to select from
     * @param currentBps Array of current allocations in basis points
     * @param targetBps Array of target allocations in basis points
     * @param count Number of vaults to select (must be <= vaults.length)
     * @return selectedVaults Array of selected vault addresses
     * @return selectedIndices Array of indices of selected vaults in original array
     */
    function selectTopOverallocated(
        address[] memory vaults,
        uint256[] memory currentBps,
        uint256[] memory targetBps,
        uint256 count
    ) internal pure returns (address[] memory selectedVaults, uint256[] memory selectedIndices) {
        if (vaults.length != currentBps.length || currentBps.length != targetBps.length) {
            revert ArrayLengthMismatch();
        }

        if (vaults.length == 0) {
            revert NoItemsAvailable();
        }

        if (count == 0) {
            revert InvalidSelectionCount();
        }

        if (count > vaults.length) {
            revert InsufficientItems();
        }

        // Calculate overallocations
        uint256[] memory overallocations = calculateOverallocations(currentBps, targetBps);

        // Check if any overallocations exist
        bool hasOverallocations = false;
        for (uint256 i = 0; i < overallocations.length; i++) {
            if (overallocations[i] > 0) {
                hasOverallocations = true;
                break;
            }
        }

        // If no overallocations, select first count vaults deterministically
        if (!hasOverallocations) {
            selectedVaults = new address[](count);
            selectedIndices = new uint256[](count);
            for (uint256 i = 0; i < count; i++) {
                selectedVaults[i] = vaults[i];
                selectedIndices[i] = i;
            }
            return (selectedVaults, selectedIndices);
        }

        // Use partial sort to find top count overallocated vaults
        return _selectTopVaultsByDelta(vaults, overallocations, count);
    }

    /**
     * @notice Internal function that implements partial sort to select top vaults by delta
     * @dev Uses selection algorithm optimized for small count values (O(k*n) complexity)
     * @param vaults Array of vault addresses
     * @param deltas Array of allocation deltas (under/over allocations)
     * @param count Number of top vaults to select
     * @return selectedVaults Array of selected vault addresses
     * @return selectedIndices Array of indices of selected vaults in original array
     */
    function _selectTopVaultsByDelta(
        address[] memory vaults,
        uint256[] memory deltas,
        uint256 count
    ) private pure returns (address[] memory selectedVaults, uint256[] memory selectedIndices) {
        // Create working array of vault data
        VaultData[] memory vaultData = new VaultData[](vaults.length);
        for (uint256 i = 0; i < vaults.length; i++) {
            vaultData[i] = VaultData({ vault: vaults[i], delta: deltas[i], originalIndex: i });
        }

        // Perform partial sort using selection algorithm
        // For each position in the top count, find the maximum in remaining array
        for (uint256 pos = 0; pos < count; pos++) {
            uint256 maxIndex = pos;
            uint256 maxDelta = vaultData[pos].delta;

            // Find the vault with maximum delta in remaining unsorted portion
            for (uint256 i = pos + 1; i < vaultData.length; i++) {
                if (
                    vaultData[i].delta > maxDelta ||
                    (vaultData[i].delta == maxDelta && vaultData[i].originalIndex < vaultData[maxIndex].originalIndex)
                ) {
                    maxIndex = i;
                    maxDelta = vaultData[i].delta;
                }
            }

            // Swap maximum element to current position
            if (maxIndex != pos) {
                VaultData memory temp = vaultData[pos];
                vaultData[pos] = vaultData[maxIndex];
                vaultData[maxIndex] = temp;
            }
        }

        // Extract results from sorted portion
        selectedVaults = new address[](count);
        selectedIndices = new uint256[](count);

        for (uint256 i = 0; i < count; i++) {
            selectedVaults[i] = vaultData[i].vault;
            selectedIndices[i] = vaultData[i].originalIndex;
        }

        return (selectedVaults, selectedIndices);
    }
}
