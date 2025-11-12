// SPDX-License-Identifier: MIT
pragma solidity ^0.8.20;

import { AccessControl } from "@openzeppelin/contracts/access/AccessControl.sol";
import { IERC20 } from "@openzeppelin/contracts/token/ERC20/IERC20.sol";
import { IERC4626 } from "@openzeppelin/contracts/interfaces/IERC4626.sol";
import { SafeERC20 } from "@openzeppelin/contracts/token/ERC20/utils/SafeERC20.sol";
import { IDStableConversionAdapterV2 } from "../interfaces/IDStableConversionAdapterV2.sol";

/**
 * @title GenericERC4626ConversionAdapter
 * @notice Conversion adapter that bridges a dSTABLE asset directly into an ERC4626 vault where the
 *         share token is used as a dSTAKE strategy. Useful for idle vaults that simply hold dUSD.
 */
contract GenericERC4626ConversionAdapter is IDStableConversionAdapterV2, AccessControl {
    using SafeERC20 for IERC20;

    // --- Errors ---
    error ZeroAddress();
    error InvalidAmount();
    error VaultAssetMismatch(address expected, address actual);
    error IncorrectStrategyShare(address expected, address actual);
    error EmergencyWithdrawFailed();

    // --- State ---
    address public immutable dStable;
    IERC4626 public immutable vault;
    address public immutable collateralVault;

    // --- Events ---
    event EmergencyWithdrawal(address indexed token, address indexed to, uint256 amount);

    constructor(address _dStable, address _vault, address _collateralVault, address _admin) {
        if (_dStable == address(0) || _vault == address(0) || _collateralVault == address(0) || _admin == address(0)) {
            revert ZeroAddress();
        }

        if (IERC4626(_vault).asset() != _dStable) {
            revert VaultAssetMismatch(_dStable, IERC4626(_vault).asset());
        }

        dStable = _dStable;
        vault = IERC4626(_vault);
        collateralVault = _collateralVault;

        _grantRole(DEFAULT_ADMIN_ROLE, _admin);
        if (_admin != msg.sender) {
            _grantRole(DEFAULT_ADMIN_ROLE, msg.sender);
        }
    }

    // --- IDStableConversionAdapterV2 ---

    function depositIntoStrategy(
        uint256 stableAmount
    ) external override returns (address shareToken, uint256 strategyShareAmount) {
        if (stableAmount == 0) {
            revert InvalidAmount();
        }

        IERC20(dStable).safeTransferFrom(msg.sender, address(this), stableAmount);
        IERC20(dStable).forceApprove(address(vault), stableAmount);

        strategyShareAmount = vault.deposit(stableAmount, collateralVault);
        shareToken = address(vault);
    }

    function withdrawFromStrategy(uint256 strategyShareAmount) external override returns (uint256 stableAmount) {
        if (strategyShareAmount == 0) {
            revert InvalidAmount();
        }

        IERC20(address(vault)).safeTransferFrom(msg.sender, address(this), strategyShareAmount);
        stableAmount = vault.redeem(strategyShareAmount, msg.sender, address(this));

        if (stableAmount == 0) {
            revert InvalidAmount();
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
        address _strategyShare,
        uint256 strategyShareAmount
    ) external view override returns (uint256 stableValue) {
        if (_strategyShare != address(vault)) {
            revert IncorrectStrategyShare(address(vault), _strategyShare);
        }

        stableValue = vault.previewRedeem(strategyShareAmount);
    }

    function strategyShare() external view override returns (address) {
        return address(vault);
    }

    function vaultAsset() external view override returns (address) {
        return address(vault);
    }

    /**
     * @notice Emergency hook allowing admins to recover arbitrary tokens or ETH held by the adapter.
     * @param token Asset to pull (use address(0) for native ETH).
     * @param to Recipient that will receive the rescued funds.
     * @param amount Amount to transfer.
     */
    function emergencyWithdraw(address token, address to, uint256 amount) external onlyRole(DEFAULT_ADMIN_ROLE) {
        if (to == address(0)) {
            revert ZeroAddress();
        }

        if (token == address(0)) {
            (bool success, ) = to.call{ value: amount }("");
            if (!success) {
                revert EmergencyWithdrawFailed();
            }
        } else {
            IERC20(token).safeTransfer(to, amount);
        }

        emit EmergencyWithdrawal(token, to, amount);
    }

    /**
     * @notice Allow the adapter to accept ETH so accidental transfers can be recovered.
     */
    receive() external payable {}
}
