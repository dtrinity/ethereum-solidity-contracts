// SPDX-License-Identifier: MIT
pragma solidity ^0.8.20;

import { IDStableConversionAdapterV2 } from "contracts/vaults/dstake/interfaces/IDStableConversionAdapterV2.sol";
import { IMintableERC20 } from "contracts/common/IMintableERC20.sol";
import { IERC20 } from "@openzeppelin/contracts/token/ERC20/IERC20.sol";
import { SafeERC20 } from "@openzeppelin/contracts/token/ERC20/utils/SafeERC20.sol";

/**
 * @title MockDevaluingAdapter
 * @notice Test adapter that mints strategy shares 1:1 but reports a much lower withdraw preview value.
 *         Used to ensure router value-based slippage guards reject devalued share positions.
 */
contract MockDevaluingAdapter is IDStableConversionAdapterV2 {
    using SafeERC20 for IERC20;

    address public immutable dStable;
    address public immutable collateralVault;
    IMintableERC20 public immutable strategyShareToken;
    uint256 public immutable valueFactorBps;

    error InvalidValueFactor();

    constructor(
        address _dStable,
        address _collateralVault,
        IMintableERC20 _strategyShareToken,
        uint256 _valueFactorBps
    ) {
        if (_valueFactorBps > 10_000) revert InvalidValueFactor();
        dStable = _dStable;
        collateralVault = _collateralVault;
        strategyShareToken = _strategyShareToken;
        valueFactorBps = _valueFactorBps;
    }

    function depositIntoStrategy(uint256 stableAmount) external override returns (address, uint256) {
        IERC20(dStable).safeTransferFrom(msg.sender, address(this), stableAmount);
        strategyShareToken.mint(collateralVault, stableAmount);
        return (address(strategyShareToken), stableAmount);
    }

    function withdrawFromStrategy(uint256) external pure override returns (uint256) {
        revert("Not implemented");
    }

    function previewDepositIntoStrategy(uint256 stableAmount) external view override returns (address, uint256) {
        return (address(strategyShareToken), stableAmount);
    }

    function previewWithdrawFromStrategy(uint256 strategyShareAmount) external view override returns (uint256) {
        return (strategyShareAmount * valueFactorBps) / 10_000;
    }

    function strategyShareValueInDStable(
        address,
        uint256 strategyShareAmount
    ) external view override returns (uint256) {
        return (strategyShareAmount * valueFactorBps) / 10_000;
    }

    function strategyShare() external view override returns (address) {
        return address(strategyShareToken);
    }
}
