// SPDX-License-Identifier: MIT
pragma solidity ^0.8.20;

import { RewardClaimable } from "../../rewards_claimable/RewardClaimable.sol";
import { IDStakeRouterV2 } from "../interfaces/IDStakeRouterV2.sol";
import { IDStakeCollateralVaultV2 } from "../interfaces/IDStakeCollateralVaultV2.sol";
import { IERC20 } from "@openzeppelin/contracts/token/ERC20/IERC20.sol";
import { SafeERC20 } from "@openzeppelin/contracts/token/ERC20/utils/SafeERC20.sol";
import { Pausable } from "@openzeppelin/contracts/utils/Pausable.sol";

interface IGuardedCompoundingRouter {
    function BACKING_GUARD_VERSION() external view returns (uint256);
}

/**
 * @notice Permissionless fixed-threshold reward auction for dSTAKE holders.
 * @dev Public execution is intentional: ANY keeper may pay >= exchangeThreshold
 *      for the selected available reward inventory, net of treasury fees. The
 *      payment becomes backing; no sdAsset is minted to the keeper. The threshold
 *      is NOT an oracle-valued bid and no new price/discretionary operator gate is
 *      introduced here. Configuration remains privileged.
 *
 *      Unlike the generic RewardClaimable default, this entry point intentionally
 *      has no REWARDS_MANAGER_ROLE modifier. It is non-virtual so concrete dSTAKE
 *      integrations cannot drop pause/input/accounting checks. Only the reward
 *      acquisition hook is customized. New managers start PAUSED and need no
 *      direct adapter authorization. Existing immutable managers must be retired.
 */
abstract contract DStakeRewardManagerBase is RewardClaimable, Pausable {
    using SafeERC20 for IERC20;

    bytes32 public constant COMPOUND_PAUSER_ROLE = keccak256("COMPOUND_PAUSER_ROLE");
    uint256 public constant SETTLEMENT_VERSION = 2;
    address public immutable dStakeCollateralVault;
    IDStakeRouterV2 public immutable dStakeRouter;

    error InvalidCompoundingRouter();
    error StaleCompoundingRouter(address expected, address current);
    error InvalidRewardToken(address token);
    error DuplicateRewardToken(address token);
    error ExchangeAssetBalanceMismatch(uint256 expected, uint256 received);

    event ExchangeAssetProcessed(
        address indexed strategyShare,
        uint256 strategyShares,
        uint256 dStableCompoundedAmount
    );

    constructor(
        address collateral,
        address router,
        address treasury_,
        uint256 maxFee,
        uint256 fee,
        uint256 threshold
    ) RewardClaimable(IDStakeCollateralVaultV2(collateral).dStable(), treasury_, maxFee, fee, threshold) {
        if (router == address(0) || collateral == address(0)) revert InvalidCompoundingRouter();
        IDStakeRouterV2 checkedRouter = IDStakeRouterV2(router);
        if (
            address(checkedRouter.collateralVault()) != collateral ||
            checkedRouter.dStakeToken() != IDStakeCollateralVaultV2(collateral).dStakeToken() ||
            IGuardedCompoundingRouter(router).BACKING_GUARD_VERSION() != 3
        ) revert InvalidCompoundingRouter();
        dStakeCollateralVault = collateral;
        dStakeRouter = checkedRouter;
        _grantRole(COMPOUND_PAUSER_ROLE, msg.sender);
        _pause();
    }

    function pauseCompounding() external onlyRole(COMPOUND_PAUSER_ROLE) {
        _pause();
    }

    // Emergency signers may stop auctions, but cannot reopen them.
    function unpauseCompounding() external onlyRole(DEFAULT_ADMIN_ROLE) {
        _requireCurrentRouter();
        _unpause();
    }

    /// @inheritdoc RewardClaimable
    function compoundRewards(
        uint256 amount,
        address[] calldata rewardTokens,
        address receiver
    ) public override nonReentrant whenNotPaused {
        if (amount < exchangeThreshold) revert ExchangeAmountTooLow(amount, exchangeThreshold);
        if (receiver == address(0)) revert ZeroReceiverAddress();
        if (rewardTokens.length == 0) revert ZeroRewardTokens();
        for (uint256 i; i < rewardTokens.length; ++i) {
            if (rewardTokens[i] == address(0)) revert InvalidRewardToken(address(0));
            for (uint256 j; j < i; ++j) {
                if (rewardTokens[j] == rewardTokens[i]) revert DuplicateRewardToken(rewardTokens[i]);
            }
        }
        _requireCurrentRouter();

        uint256 beforeBalance = IERC20(exchangeAsset).balanceOf(address(this));
        IERC20(exchangeAsset).safeTransferFrom(msg.sender, address(this), amount);
        uint256 afterBalance = IERC20(exchangeAsset).balanceOf(address(this));
        uint256 received = afterBalance >= beforeBalance ? afterBalance - beforeBalance : 0;
        if (received != amount) revert ExchangeAssetBalanceMismatch(amount, received);

        // Establish backing BEFORE paying rewards. Reverts roll back payment and
        // claims together. Processing first also prevents exchangeAsset rewards
        // from confusing the keeper's contribution with auction inventory.
        _processExchangeAssetDeposit(amount);
        uint256[] memory rewardAmounts = _claimRewards(rewardTokens, address(this));
        if (rewardAmounts.length != rewardTokens.length) {
            revert RewardAmountsLengthMismatch(rewardAmounts.length, rewardTokens.length);
        }
        for (uint256 i; i < rewardTokens.length; ++i) {
            uint256 fee = getTreasuryFee(rewardAmounts[i]);
            if (fee > rewardAmounts[i]) revert TreasuryFeeExceedsRewardAmount(fee, rewardAmounts[i]);
            if (fee != 0) IERC20(rewardTokens[i]).safeTransfer(treasury, fee);
            uint256 net = rewardAmounts[i] - fee;
            if (net != 0) IERC20(rewardTokens[i]).safeTransfer(receiver, net);
        }
        emit RewardCompounded(exchangeAsset, amount, rewardTokens);
    }

    // Final implementation: derived managers cannot restore a direct-adapter bypass.
    function _processExchangeAssetDeposit(uint256 amount) internal override {
        _requireCurrentRouter();
        IERC20(exchangeAsset).forceApprove(address(dStakeRouter), amount);
        (address strategyShare, uint256 shares) = dStakeRouter.compoundDeposit(amount);
        IERC20(exchangeAsset).forceApprove(address(dStakeRouter), 0);
        emit ExchangeAssetProcessed(strategyShare, shares, amount);
    }

    function _requireCurrentRouter() internal view {
        address current = IDStakeCollateralVaultV2(dStakeCollateralVault).router();
        if (current != address(dStakeRouter)) revert StaleCompoundingRouter(address(dStakeRouter), current);
    }
}
