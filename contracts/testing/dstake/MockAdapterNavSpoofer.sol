// SPDX-License-Identifier: MIT
pragma solidity ^0.8.20;

import { IERC20 } from "@openzeppelin/contracts/token/ERC20/IERC20.sol";
import { SafeERC20 } from "@openzeppelin/contracts/token/ERC20/utils/SafeERC20.sol";
import { IDStableConversionAdapterV2 } from "contracts/vaults/dstake/interfaces/IDStableConversionAdapterV2.sol";
import { MockERC4626Simple } from "./MockERC4626Simple.sol";

/**
 * @dev Test-only adapter that can skew mint and valuation math.
 */
contract MockAdapterNavSpoofer is IDStableConversionAdapterV2 {
    using SafeERC20 for IERC20;

    uint256 private constant BASIS_POINTS = 10_000;

    address public immutable dStable;
    address public immutable collateralVault;
    MockERC4626Simple public immutable vaultToken;

    address public owner;
    uint256 public mintFactorBps;
    uint256 public valueFactorBps;

    error NotOwner();
    constructor(address _dStable, address _collateralVault) {
        dStable = _dStable;
        collateralVault = _collateralVault;
        vaultToken = new MockERC4626Simple(IERC20(_dStable));
        owner = msg.sender;
        mintFactorBps = BASIS_POINTS;
        valueFactorBps = BASIS_POINTS;
    }

    modifier onlyOwner() {
        if (msg.sender != owner) revert NotOwner();
        _;
    }

    function setMintFactorBps(uint256 newMintFactorBps) external onlyOwner {
        mintFactorBps = newMintFactorBps;
    }

    function setValueFactorBps(uint256 newValueFactorBps) external onlyOwner {
        valueFactorBps = newValueFactorBps;
    }

    function transferOwnership(address newOwner) external onlyOwner {
        owner = newOwner;
    }

    function depositIntoStrategy(
        uint256 stableAmount
    ) external override returns (address strategyShareAddr, uint256 strategyShareAmount) {
        IERC20(dStable).safeTransferFrom(msg.sender, address(this), stableAmount);
        IERC20(dStable).forceApprove(address(vaultToken), stableAmount);

        uint256 mintedShares = vaultToken.deposit(stableAmount, address(this));
        uint256 desiredShares = (mintedShares * mintFactorBps) / BASIS_POINTS;
        uint256 availableShares = IERC20(address(vaultToken)).balanceOf(address(this));
        uint256 forwardedShares = desiredShares < availableShares ? desiredShares : availableShares;

        if (forwardedShares > 0) {
            IERC20(address(vaultToken)).safeTransfer(collateralVault, forwardedShares);
        }

        IERC20(dStable).forceApprove(address(vaultToken), 0);
        return (address(vaultToken), forwardedShares);
    }

    function withdrawFromStrategy(uint256 strategyShareAmount) external override returns (uint256 stableAmount) {
        IERC20(address(vaultToken)).safeTransferFrom(msg.sender, address(this), strategyShareAmount);
        IERC20(address(vaultToken)).forceApprove(address(vaultToken), strategyShareAmount);

        stableAmount = vaultToken.redeem(strategyShareAmount, msg.sender, address(this));

        IERC20(address(vaultToken)).forceApprove(address(vaultToken), 0);
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
        uint256 baseValue = vaultToken.previewRedeem(strategyShareAmount);
        return (baseValue * valueFactorBps) / BASIS_POINTS;
    }

    function strategyShare() external view override returns (address) {
        return address(vaultToken);
    }

    function vaultAsset() external view override returns (address) {
        return address(vaultToken);
    }
}
