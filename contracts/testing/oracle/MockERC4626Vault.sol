// SPDX-License-Identifier: MIT
pragma solidity ^0.8.20;

import { IERC4626 } from "@openzeppelin/contracts/interfaces/IERC4626.sol";
import { IERC20Metadata } from "@openzeppelin/contracts/token/ERC20/extensions/IERC20Metadata.sol";
import { ERC20 } from "@openzeppelin/contracts/token/ERC20/ERC20.sol";

/**
 * @notice Minimal ERC4626-style vault for testing oracle math only.
 * @dev Only convert/preview helpers are implemented; deposit/withdraw revert.
 */
contract MockERC4626Vault is ERC20, IERC4626 {
    address private immutable _asset;
    uint8 private immutable _decimals;
    uint256 private _assetsPerShare;

    constructor(
        string memory name_,
        string memory symbol_,
        address asset_,
        uint8 shareDecimals_,
        uint256 assetsPerShare_
    ) ERC20(name_, symbol_) {
        _asset = asset_;
        _decimals = shareDecimals_;
        IERC20Metadata(asset_).decimals(); // Ensure asset exposes decimals for realistic behavior
        _assetsPerShare = assetsPerShare_;
        // Seed supply to avoid zero-share division in previews
        _mint(msg.sender, 1e6 * (10 ** shareDecimals_));
    }

    function setAssetsPerShare(uint256 newRate) external {
        _assetsPerShare = newRate;
    }

    function asset() external view override returns (address) {
        return _asset;
    }

    function totalAssets() public view override returns (uint256) {
        return (totalSupply() * _assetsPerShare) / (10 ** _decimals);
    }

    function convertToAssets(uint256 shares) public view override returns (uint256) {
        return (shares * _assetsPerShare) / (10 ** _decimals);
    }

    function convertToShares(uint256 assets) public view override returns (uint256) {
        return (assets * (10 ** _decimals)) / _assetsPerShare;
    }

    function maxDeposit(address) external pure override returns (uint256) {
        return type(uint256).max;
    }

    function previewDeposit(uint256 assets) external view override returns (uint256) {
        return convertToShares(assets);
    }

    function deposit(uint256, address) external pure override returns (uint256) {
        revert("MockERC4626Vault: deposit disabled");
    }

    function maxMint(address) external pure override returns (uint256) {
        return type(uint256).max;
    }

    function previewMint(uint256 shares) external view override returns (uint256) {
        return convertToAssets(shares);
    }

    function mint(uint256, address) external pure override returns (uint256) {
        revert("MockERC4626Vault: mint disabled");
    }

    function maxWithdraw(address) external pure override returns (uint256) {
        return type(uint256).max;
    }

    function previewWithdraw(uint256 assets) external view override returns (uint256) {
        return convertToShares(assets);
    }

    function withdraw(uint256, address, address) external pure override returns (uint256) {
        revert("MockERC4626Vault: withdraw disabled");
    }

    function maxRedeem(address) external pure override returns (uint256) {
        return type(uint256).max;
    }

    function previewRedeem(uint256 shares) external view override returns (uint256) {
        return convertToAssets(shares);
    }

    function redeem(uint256, address, address) external pure override returns (uint256) {
        revert("MockERC4626Vault: redeem disabled");
    }

    function decimals() public view override(ERC20, IERC20Metadata) returns (uint8) {
        return _decimals;
    }
}
