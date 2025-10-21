// SPDX-License-Identifier: MIT
pragma solidity ^0.8.20;

import { IERC20 } from "@openzeppelin/contracts/token/ERC20/IERC20.sol";
import { MockERC4626Simple } from "./MockERC4626Simple.sol";
import { IDStableConversionAdapterV2 } from "../vaults/dstake/interfaces/IDStableConversionAdapterV2.sol";

/**
 * @title MockAdapterSmallDepositRevert
 * @notice Test-only adapter that intentionally reverts when `depositIntoStrategy`
 *         is called with < 2 wei of dSTABLE.  Used to reproduce the dStakeRouter
 *         surplus-rounding DoS in unit tests.
 */
contract MockAdapterSmallDepositRevert is IDStableConversionAdapterV2 {
    // --- Errors ---
    error ZeroAddress();
    error DepositTooSmall(uint256 amount);

    // --- Constants ---
    uint256 private constant MIN_DEPOSIT = 2; // Wei of dSTABLE required for a successful deposit

    // --- State ---
    IERC20 public immutable dStable; // underlying stablecoin
    MockERC4626Simple public immutable vaultAssetToken; // mock wrapped asset
    address public immutable collateralVault; // DStakeCollateralVaultV2 address (receiver of minted shares)

    constructor(address _dStable, address _collateralVault) {
        if (_dStable == address(0) || _collateralVault == address(0)) {
            revert ZeroAddress();
        }
        dStable = IERC20(_dStable);
        collateralVault = _collateralVault;
        // Deploy the simple ERC4626 vault token (1:1 deposit)
        vaultAssetToken = new MockERC4626Simple(IERC20(_dStable));
    }

    // ---------------- IDStableConversionAdapterV2 ----------------

    function depositIntoStrategy(
        uint256 stableAmount
    ) external override returns (address _strategyShare, uint256 strategyShareAmount) {
        if (stableAmount < MIN_DEPOSIT) revert DepositTooSmall(stableAmount);

        // Pull dStable from caller (Router)
        dStable.transferFrom(msg.sender, address(this), stableAmount);

        // Deposit dStable into the ERC4626 mock, minting shares to the vault
        IERC20(address(dStable)).approve(address(vaultAssetToken), stableAmount);
        vaultAssetToken.deposit(stableAmount, collateralVault);

        _strategyShare = address(vaultAssetToken);
        strategyShareAmount = stableAmount;
    }

    function withdrawFromStrategy(uint256 strategyShareAmount) external override returns (uint256 stableAmount) {
        // Pull shares from caller (Router)
        IERC20(address(vaultAssetToken)).transferFrom(msg.sender, address(this), strategyShareAmount);

        // Redeem shares for dStable, sending the dStable directly to the router (msg.sender)
        stableAmount = vaultAssetToken.redeem(strategyShareAmount, msg.sender, address(this));
    }

    function previewDepositIntoStrategy(
        uint256 stableAmount
    ) external view override returns (address _strategyShare, uint256 strategyShareAmount) {
        _strategyShare = address(vaultAssetToken);
        strategyShareAmount = stableAmount;
    }

    function previewWithdrawFromStrategy(
        uint256 strategyShareAmount
    ) external pure override returns (uint256 stableAmount) {
        return (strategyShareAmount * 11000) / 10000; // 1.1x like MockERC4626Simple
    }

    function strategyShareValueInDStable(
        address _strategyShare,
        uint256 strategyShareAmount
    ) external pure override returns (uint256 dStableValue) {
        require(_strategyShare == address(0) || _strategyShare != address(0), "NOP"); // dummy check to silence linter
        return (strategyShareAmount * 11000) / 10000;
    }

    function strategyShare() external view override returns (address) {
        return address(vaultAssetToken);
    }
}
