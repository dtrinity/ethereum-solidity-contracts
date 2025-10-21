// SPDX-License-Identifier: MIT
pragma solidity ^0.8.20;

import { IERC20 } from "@openzeppelin/contracts/token/ERC20/IERC20.sol";
import { SafeERC20 } from "@openzeppelin/contracts/token/ERC20/utils/SafeERC20.sol";

/**
 * @title MockUniversalRewardsDistributor
 * @notice Mock implementation of Morpho's Universal Rewards Distributor for testing
 * @dev Simulates Merkle tree-based reward distribution without actual Merkle verification
 */
contract MockUniversalRewardsDistributor {
    using SafeERC20 for IERC20;

    // Current Merkle root (for testing, we don't actually verify)
    bytes32 public root;

    // Track claimed amounts per account per reward token
    mapping(address => mapping(address => uint256)) public claimed;

    // Mock pending rewards (set by test setup)
    mapping(address => mapping(address => uint256)) public pendingRewards;

    // Events
    event Claimed(address indexed account, address indexed reward, uint256 amount);
    event RootSet(bytes32 newRoot);
    event PendingRewardSet(address indexed account, address indexed reward, uint256 amount);

    constructor() {
        // Set a dummy root for testing
        root = keccak256("test_root");
    }

    /**
     * @notice Claims rewards for an account
     * @param account The account to claim for
     * @param reward The reward token address
     * @param claimable The total claimable amount (cumulative)
     * @return amount The amount actually claimed
     */
    function claim(
        address account,
        address reward,
        uint256 claimable,
        bytes32[] calldata /* proof */
    ) external returns (uint256) {
        // In the mock, we use pendingRewards instead of Merkle verification
        uint256 alreadyClaimed = claimed[account][reward];
        uint256 pending = pendingRewards[account][reward];

        // Simulate the real URD behavior: claimable is cumulative
        if (claimable <= alreadyClaimed) {
            return 0; // Nothing to claim
        }

        uint256 toClaim = claimable - alreadyClaimed;

        // If trying to claim more than pending and no pending, revert (for testing)
        if (toClaim > 0 && pending == 0) {
            revert("No pending rewards");
        }

        // Cap at what we have pending (for test control)
        if (toClaim > pending) {
            toClaim = pending;
        }

        if (toClaim == 0) {
            return 0;
        }

        // Update state
        claimed[account][reward] = alreadyClaimed + toClaim;
        pendingRewards[account][reward] = pending - toClaim;

        // Transfer tokens to the specified account (matches real URD behavior)
        IERC20(reward).safeTransfer(account, toClaim);

        emit Claimed(account, reward, toClaim);

        return toClaim;
    }

    /**
     * @notice Sets the Merkle root (mock functionality)
     * @param newRoot The new root to set
     */
    function setRoot(bytes32 newRoot) external {
        root = newRoot;
        emit RootSet(newRoot);
    }

    /**
     * @notice Sets pending rewards for testing
     * @param account The account to set rewards for
     * @param reward The reward token
     * @param amount The pending amount
     */
    function setPendingReward(address account, address reward, uint256 amount) external {
        pendingRewards[account][reward] = amount;
        emit PendingRewardSet(account, reward, amount);
    }

    /**
     * @notice Funds the distributor with reward tokens for testing
     * @param token The token to fund
     * @param amount The amount to fund
     */
    function fund(address token, uint256 amount) external {
        IERC20(token).safeTransferFrom(msg.sender, address(this), amount);
    }
}
