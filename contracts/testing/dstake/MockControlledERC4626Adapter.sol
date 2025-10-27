// SPDX-License-Identifier: MIT
pragma solidity ^0.8.20;

import { IERC20 } from "@openzeppelin/contracts/token/ERC20/IERC20.sol";
import { IERC4626 } from "@openzeppelin/contracts/interfaces/IERC4626.sol";
import { SafeERC20 } from "@openzeppelin/contracts/token/ERC20/utils/SafeERC20.sol";

import { IDStableConversionAdapterV2 } from "contracts/vaults/dstake/interfaces/IDStableConversionAdapterV2.sol";

/**
 * @title MockControlledERC4626Adapter
 * @notice Test-only adapter that wraps an ERC4626 vault but allows toggling deposit/withdraw failures.
 * @dev Used to ensure router logic surfaces adapter errors and handles partial failures deterministically.
 */
contract MockControlledERC4626Adapter is IDStableConversionAdapterV2 {
    using SafeERC20 for IERC20;

    // --- Errors ---
    error ZeroAddress();
    error InvalidAmount();
    error VaultAssetMismatch(address expected, address actual);
    error AdapterForcedFailure(string action);

    // --- State ---
    address public immutable dStable;
    IERC4626 public immutable vault;
    address public immutable collateralVault;

    bool public failDeposit;
    bool public failWithdraw;

    constructor(address _dStable, address _vault, address _collateralVault) {
        if (_dStable == address(0) || _vault == address(0) || _collateralVault == address(0)) {
            revert ZeroAddress();
        }
        if (IERC4626(_vault).asset() != _dStable) {
            revert VaultAssetMismatch(_dStable, IERC4626(_vault).asset());
        }

        dStable = _dStable;
        vault = IERC4626(_vault);
        collateralVault = _collateralVault;
    }

    // --- Test Controls ---

    function setDepositFailure(bool shouldFail) external {
        failDeposit = shouldFail;
    }

    function setWithdrawFailure(bool shouldFail) external {
        failWithdraw = shouldFail;
    }

    // --- Adapter Implementation ---

    function depositIntoStrategy(
        uint256 stableAmount
    ) external override returns (address shareToken, uint256 strategyShareAmount) {
        if (stableAmount == 0) revert InvalidAmount();
        if (failDeposit) revert AdapterForcedFailure("deposit");

        IERC20(dStable).safeTransferFrom(msg.sender, address(this), stableAmount);
        IERC20(dStable).forceApprove(address(vault), stableAmount);

        strategyShareAmount = vault.deposit(stableAmount, collateralVault);
        shareToken = address(vault);

        IERC20(dStable).forceApprove(address(vault), 0);
    }

    function withdrawFromStrategy(uint256 strategyShareAmount) external override returns (uint256 stableAmount) {
        if (strategyShareAmount == 0) revert InvalidAmount();
        if (failWithdraw) revert AdapterForcedFailure("withdraw");

        IERC20(address(vault)).safeTransferFrom(msg.sender, address(this), strategyShareAmount);
        stableAmount = vault.redeem(strategyShareAmount, msg.sender, address(this));
        if (stableAmount == 0) {
            revert AdapterForcedFailure("zero-withdraw");
        }
    }

    function previewDepositIntoStrategy(
        uint256 stableAmount
    ) external view override returns (address shareToken, uint256 strategyShareAmount) {
        shareToken = address(vault);
        strategyShareAmount = vault.previewDeposit(stableAmount);
    }

    function previewWithdrawFromStrategy(
        uint256 strategyShareAmount
    ) external view override returns (uint256 stableAmount) {
        stableAmount = vault.previewRedeem(strategyShareAmount);
    }

    function strategyShareValueInDStable(
        address strategyShareParam,
        uint256 strategyShareAmount
    ) external view override returns (uint256 stableValue) {
        if (strategyShareParam != address(vault)) {
            revert VaultAssetMismatch(address(vault), strategyShareParam);
        }
        stableValue = vault.previewRedeem(strategyShareAmount);
    }

    function strategyShare() external view override returns (address) {
        return address(vault);
    }

    function vaultAsset() external view override returns (address) {
        return address(vault);
    }
}
