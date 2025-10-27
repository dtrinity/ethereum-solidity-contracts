// SPDX-License-Identifier: MIT
pragma solidity ^0.8.20;

import { RewardClaimable } from "contracts/vaults/rewards_claimable/RewardClaimable.sol";
import { IERC20 } from "@openzeppelin/contracts/token/ERC20/IERC20.sol";
import { SafeERC20 } from "@openzeppelin/contracts/token/ERC20/utils/SafeERC20.sol";

/// @dev Harness exposing RewardClaimable internals for receiver adversary testing.
contract RewardReceiverGriefingHarness is RewardClaimable {
    using SafeERC20 for IERC20;

    error UnsupportedRewardToken(address token);
    error InsufficientRewardBalance(uint256 available, uint256 required);

    IERC20 public immutable rewardToken;
    address public immutable vault;
    uint256 public claimAmount;

    constructor(
        address exchangeAsset_,
        address rewardToken_,
        address treasury_,
        address vault_
    ) RewardClaimable(exchangeAsset_, treasury_, 10_000, 0, 1) {
        rewardToken = IERC20(rewardToken_);
        vault = vault_;
    }

    function setClaimAmount(uint256 amount) external {
        claimAmount = amount;
    }

    function fundRewards(uint256 amount) external {
        rewardToken.safeTransferFrom(msg.sender, address(this), amount);
    }

    function _claimRewards(
        address[] calldata rewardTokens,
        address receiver
    ) internal override returns (uint256[] memory amounts) {
        if (rewardTokens.length != 1 || rewardTokens[0] != address(rewardToken)) {
            revert UnsupportedRewardToken(rewardTokens.length == 0 ? address(0) : rewardTokens[0]);
        }

        uint256 payout = claimAmount;
        uint256 balance = rewardToken.balanceOf(address(this));
        if (balance < payout) {
            revert InsufficientRewardBalance(balance, payout);
        }

        rewardToken.safeTransfer(receiver, payout);

        amounts = new uint256[](1);
        amounts[0] = payout;
    }

    function _processExchangeAssetDeposit(uint256 amount) internal override {
        if (amount == 0) {
            return;
        }
        IERC20(exchangeAsset).safeTransfer(vault, amount);
    }
}
