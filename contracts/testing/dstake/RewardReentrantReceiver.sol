// SPDX-License-Identifier: MIT
pragma solidity ^0.8.20;

import { IERC20 } from "@openzeppelin/contracts/token/ERC20/IERC20.sol";
import { IRewardHookReceiver } from "contracts/testing/token/MockRewardHookToken.sol";
import { RewardReceiverGriefingHarness } from "./RewardReceiverGriefingHarness.sol";

/// @dev Receiver harness that reenters compoundRewards via reward token hooks.
contract RewardReentrantReceiver is IRewardHookReceiver {
    RewardReceiverGriefingHarness public rewardManager;
    IERC20 public exchangeAsset;
    address public immutable admin;
    bool public attempted;

    constructor() {
        admin = msg.sender;
    }

    function configure(address manager_, address exchangeAsset_) external {
        require(msg.sender == admin, "unauthorised");
        rewardManager = RewardReceiverGriefingHarness(manager_);
        exchangeAsset = IERC20(exchangeAsset_);
    }

    function onRewardReceived(address, uint256) external override {
        if (attempted || address(rewardManager) == address(0)) {
            return;
        }
        attempted = true;

        uint256 threshold = rewardManager.exchangeThreshold();
        if (threshold == 0) {
            return;
        }

        exchangeAsset.approve(address(rewardManager), type(uint256).max);

        address[] memory rewardTokens = new address[](1);
        rewardTokens[0] = address(rewardManager.rewardToken());

        rewardManager.compoundRewards(threshold, rewardTokens, address(this));
    }
}
