// SPDX-License-Identifier: MIT
pragma solidity ^0.8.20;

import { RewardClaimable } from "contracts/vaults/rewards_claimable/RewardClaimable.sol";
import { IERC20 } from "@openzeppelin/contracts/token/ERC20/IERC20.sol";
import { SafeERC20 } from "@openzeppelin/contracts/token/ERC20/utils/SafeERC20.sol";
import { IMintableERC20 } from "contracts/common/IMintableERC20.sol";

/**
 * @dev Harness exposing deterministic dust behavior for RewardClaimable tests.
 *      Tests can configure reward emission amounts per token and control how much
 *      of each caller deposit is forwarded versus retained as dust.
 */
contract RewardExchangeDustHarness is RewardClaimable {
    using SafeERC20 for IERC20;

    error InvalidDustDivisor();
    error ZeroDepositSink();
    error ClaimConfigLengthMismatch();

    mapping(address => uint256) public claimAmounts;
    uint256 public dustDivisor;
    address public depositSink;

    constructor(address exchangeAsset_, address treasury_, address depositSink_)
        RewardClaimable(exchangeAsset_, treasury_, 10_000, 0, 1)
    {
        if (depositSink_ == address(0)) {
            revert ZeroDepositSink();
        }
        dustDivisor = 1;
        depositSink = depositSink_;
    }

    function setClaimAmounts(address[] calldata tokens, uint256[] calldata amounts) external {
        if (tokens.length != amounts.length) {
            revert ClaimConfigLengthMismatch();
        }
        for (uint256 i = 0; i < tokens.length; i++) {
            claimAmounts[tokens[i]] = amounts[i];
        }
    }

    function setDustDivisor(uint256 newDustDivisor) external {
        if (newDustDivisor == 0) {
            revert InvalidDustDivisor();
        }
        dustDivisor = newDustDivisor;
    }

    function setDepositSink(address newSink) external {
        if (newSink == address(0)) {
            revert ZeroDepositSink();
        }
        depositSink = newSink;
    }

    function _claimRewards(address[] calldata rewardTokens, address receiver)
        internal
        override
        returns (uint256[] memory rewardAmounts)
    {
        rewardAmounts = new uint256[](rewardTokens.length);
        for (uint256 i = 0; i < rewardTokens.length; i++) {
            address token = rewardTokens[i];
            uint256 amount = claimAmounts[token];
            if (amount > 0) {
                IMintableERC20(token).mint(receiver, amount);
            }
            rewardAmounts[i] = amount;
        }
    }

    function _processExchangeAssetDeposit(uint256 amount) internal override {
        if (depositSink == address(0)) {
            revert ZeroDepositSink();
        }
        if (amount == 0) {
            return;
        }

        uint256 divisor = dustDivisor;
        if (divisor <= 1) {
            IERC20(exchangeAsset).safeTransfer(depositSink, amount);
            return;
        }

        uint256 remainder = amount % divisor;
        uint256 forwarded = amount - remainder;

        if (forwarded > 0) {
            IERC20(exchangeAsset).safeTransfer(depositSink, forwarded);
        }

        // Leave the deterministic remainder parked on the contract for assertions.
    }
}
