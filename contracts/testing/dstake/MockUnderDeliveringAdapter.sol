// SPDX-License-Identifier: MIT
pragma solidity ^0.8.20;

import { IDStableConversionAdapterV2 } from "contracts/vaults/dstake/interfaces/IDStableConversionAdapterV2.sol";
import { IMintableERC20 } from "contracts/common/IMintableERC20.sol";
import { IERC20 } from "@openzeppelin/contracts/token/ERC20/IERC20.sol";
import { SafeERC20 } from "@openzeppelin/contracts/token/ERC20/utils/SafeERC20.sol";

/**
 * @title MockUnderDeliveringAdapter
 * @notice Test adapter that intentionally under-delivers strategy shares compared to the preview result.
 *         Used only in Hardhat tests to verify router slippage protections.
 */
contract MockUnderDeliveringAdapter is IDStableConversionAdapterV2 {
    using SafeERC20 for IERC20;

    address public immutable dStable;
    address public immutable collateralVault;
    IMintableERC20 public immutable strategyShareToken;

    uint256 public immutable factorBps; // e.g. 9000 => mints 90% of preview amount

    error InvalidFactor();

    constructor(address _dStable, address _collateralVault, IMintableERC20 _strategyShareToken, uint256 _factorBps) {
        if (_factorBps == 0 || _factorBps > 10_000) revert InvalidFactor();
        dStable = _dStable;
        collateralVault = _collateralVault;
        strategyShareToken = _strategyShareToken;
        factorBps = _factorBps;
    }

    // ---------------- IDStableConversionAdapterV2 ----------------

    function depositIntoStrategy(uint256 stableAmount) external override returns (address, uint256) {
        // Pull dStable from caller
        IERC20(dStable).safeTransferFrom(msg.sender, address(this), stableAmount);

        uint256 shares = (stableAmount * factorBps) / 10_000;

        // Mint shares directly to collateral vault (simulating under-delivery)
        strategyShareToken.mint(collateralVault, shares);

        return (address(strategyShareToken), shares);
    }

    function withdrawFromStrategy(uint256 strategyShareAmount) external pure override returns (uint256) {
        // Not needed for this mock; revert to prevent unexpected use
        revert("Not implemented");
    }

    function previewDepositIntoStrategy(uint256 stableAmount) external view override returns (address, uint256) {
        // Preview assumes 1:1 conversion
        return (address(strategyShareToken), stableAmount);
    }

    function previewWithdrawFromStrategy(uint256 strategyShareAmount) external pure override returns (uint256) {
        return strategyShareAmount; // 1:1
    }

    function strategyShareValueInDStable(
        address /*vaultAsset*/,
        uint256 strategyShareAmount
    ) external pure override returns (uint256) {
        return strategyShareAmount;
    }

    function strategyShare() external view override returns (address) {
        return address(strategyShareToken);
    }
}
