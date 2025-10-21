// SPDX-License-Identifier: MIT
pragma solidity ^0.8.20;

import { IERC20 } from "@openzeppelin/contracts/token/ERC20/IERC20.sol";
import { IDStableConversionAdapterV2 } from "../vaults/dstake/interfaces/IDStableConversionAdapterV2.sol";
import { MockERC4626Simple } from "./MockERC4626Simple.sol";
import { ERC4626 } from "@openzeppelin/contracts/token/ERC20/extensions/ERC4626.sol";
import { SafeERC20 } from "@openzeppelin/contracts/token/ERC20/utils/SafeERC20.sol";

contract MockAdapterPositiveSlippage is IDStableConversionAdapterV2 {
    using SafeERC20 for IERC20;

    address public immutable dStable;
    MockERC4626Simple public immutable vaultToken;
    address public immutable collateralVault;

    constructor(address _dStable, address _collateralVault) {
        dStable = _dStable;
        collateralVault = _collateralVault;
        vaultToken = new MockERC4626Simple(IERC20(_dStable));
    }

    function depositIntoStrategy(
        uint256 stableAmount
    ) external override returns (address strategyShareAddr, uint256 strategyShareAmount) {
        IERC20(dStable).transferFrom(msg.sender, address(this), stableAmount);
        IERC20(dStable).forceApprove(address(vaultToken), stableAmount);
        strategyShareAmount = vaultToken.deposit(stableAmount, collateralVault);
        return (address(vaultToken), strategyShareAmount);
    }

    function withdrawFromStrategy(uint256 strategyShareAmount) external override returns (uint256 stableAmount) {
        // pull strategy shares
        IERC20(address(vaultToken)).transferFrom(msg.sender, address(this), strategyShareAmount);
        IERC20(address(vaultToken)).forceApprove(address(vaultToken), strategyShareAmount);
        stableAmount = vaultToken.redeem(strategyShareAmount, msg.sender, address(this));
    }

    function previewDepositIntoStrategy(
        uint256 stableAmount
    ) external view override returns (address strategyShareAddr, uint256 strategyShareAmount) {
        return (address(vaultToken), stableAmount);
    }

    function previewWithdrawFromStrategy(
        uint256 strategyShareAmount
    ) external view override returns (uint256 stableAmount) {
        return vaultToken.previewRedeem(strategyShareAmount);
    }

    function strategyShareValueInDStable(
        address strategyShareAddr,
        uint256 strategyShareAmount
    ) external view override returns (uint256 stableValue) {
        require(strategyShareAddr == address(vaultToken), "Wrong asset");
        return vaultToken.previewRedeem(strategyShareAmount);
    }

    function strategyShare() external view override returns (address) {
        return address(vaultToken);
    }
}
