// SPDX-License-Identifier: MIT
pragma solidity ^0.8.20;

import { IERC20 } from "@openzeppelin/contracts/token/ERC20/IERC20.sol";
import { SafeERC20 } from "@openzeppelin/contracts/token/ERC20/utils/SafeERC20.sol";

import { BasisPointConstants } from "../common/BasisPointConstants.sol";
import { SupportsWithdrawalFee } from "../common/SupportsWithdrawalFee.sol";
import { IDStakeRouterV2 } from "../vaults/dstake/interfaces/IDStakeRouterV2.sol";
import { IDStakeCollateralVaultV2 } from "../vaults/dstake/interfaces/IDStakeCollateralVaultV2.sol";

error MockRouterNotImplemented();
error MockRouterUnauthorized();
error MockRouterNetMismatch(uint256 expected, uint256 actual);
error MockRouterInsufficientAssets();

contract MockDStakeRouterV2 is IDStakeRouterV2, SupportsWithdrawalFee {
    using SafeERC20 for IERC20;

    address public immutable owner;
    address public override dStakeToken;
    IDStakeCollateralVaultV2 public override collateralVault;
    IERC20 public immutable asset;

    bool public override paused;
    uint256 private managedAssets;
    uint256 private shortfall;

    constructor(address dStakeToken_, IDStakeCollateralVaultV2 collateralVault_, IERC20 asset_) {
        owner = msg.sender;
        dStakeToken = dStakeToken_;
        collateralVault = collateralVault_;
        asset = asset_;

        _initializeWithdrawalFee(0);
    }

    modifier onlyOwner() {
        if (msg.sender != owner) {
            revert MockRouterUnauthorized();
        }
        _;
    }

    modifier onlyDStakeToken() {
        if (msg.sender != dStakeToken) {
            revert MockRouterUnauthorized();
        }
        _;
    }

    function setDStakeToken(address newToken) external onlyOwner {
        dStakeToken = newToken;
    }

    function setCollateralVault(IDStakeCollateralVaultV2 newVault) external onlyOwner {
        collateralVault = newVault;
    }

    function setShortfall(uint256 newShortfall) external onlyOwner {
        shortfall = newShortfall;
    }

    function totalManagedAssets() external view override returns (uint256) {
        return managedAssets;
    }

    function currentShortfall() external view override returns (uint256) {
        return shortfall;
    }

    function withdrawalFeeBps() public view override returns (uint256) {
        return getWithdrawalFeeBps();
    }

    function maxWithdrawalFeeBps() public pure override returns (uint256) {
        return BasisPointConstants.ONE_PERCENT_BPS;
    }

    function _maxWithdrawalFeeBps() internal pure override returns (uint256) {
        return BasisPointConstants.ONE_PERCENT_BPS;
    }

    function maxDeposit(address) external pure override returns (uint256) {
        return type(uint256).max;
    }

    function maxMint(address) external pure override returns (uint256) {
        return type(uint256).max;
    }

    function maxWithdraw(address) external view override returns (uint256) {
        return managedAssets;
    }

    function maxRedeem(address) external pure override returns (uint256) {
        return type(uint256).max;
    }

    function getActiveVaultsForDeposits() external pure override returns (address[] memory) {
        return new address[](0);
    }

    function getMaxSingleVaultWithdraw() external view override returns (uint256) {
        return managedAssets;
    }

    function strategyShareToAdapter(address) external pure override returns (address) {
        return address(0);
    }

    function handleDeposit(address, uint256 assets, uint256, address) external override onlyDStakeToken {
        if (assets > 0) {
            asset.safeTransferFrom(msg.sender, address(this), assets);
            managedAssets += assets;
        }
    }

    function handleWithdraw(
        address,
        address receiver,
        address,
        uint256 grossAssets,
        uint256 expectedNetAssets
    ) external override onlyDStakeToken returns (uint256 netAssets, uint256 fee) {
        if (grossAssets > managedAssets) {
            revert MockRouterInsufficientAssets();
        }

        fee = _calculateWithdrawalFee(grossAssets);
        netAssets = grossAssets - fee;

        if (netAssets != expectedNetAssets) {
            revert MockRouterNetMismatch(expectedNetAssets, netAssets);
        }

        managedAssets -= grossAssets;

        if (netAssets > 0) {
            asset.safeTransfer(receiver, netAssets);
        }

        return (netAssets, fee);
    }

    function solverDepositAssets(
        address[] calldata,
        uint256[] calldata,
        uint256,
        address
    ) external pure override returns (uint256) {
        revert MockRouterNotImplemented();
    }

    function solverDepositShares(
        address[] calldata,
        uint256[] calldata,
        uint256,
        address
    ) external pure override returns (uint256) {
        revert MockRouterNotImplemented();
    }

    function solverWithdrawAssets(
        address[] calldata,
        uint256[] calldata,
        uint256,
        address,
        address
    ) external pure override returns (uint256, uint256, uint256) {
        revert MockRouterNotImplemented();
    }

    function solverWithdrawShares(
        address[] calldata,
        uint256[] calldata,
        uint256,
        address,
        address
    ) external pure override returns (uint256, uint256, uint256) {
        revert MockRouterNotImplemented();
    }

    function reinvestFees() external pure override returns (uint256, uint256) {
        revert MockRouterNotImplemented();
    }

    function setReinvestIncentive(uint256) external pure override {
        revert MockRouterNotImplemented();
    }

    function setWithdrawalFee(uint256 newFeeBps) external override onlyDStakeToken {
        _setWithdrawalFee(newFeeBps);
    }

    function recordShortfall(uint256 delta) external override onlyDStakeToken {
        shortfall += delta;
    }

    function clearShortfall(uint256 amount) external override onlyDStakeToken {
        if (amount > shortfall) {
            shortfall = 0;
        } else {
            shortfall -= amount;
        }
    }
}
