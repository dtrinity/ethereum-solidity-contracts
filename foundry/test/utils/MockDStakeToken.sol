// SPDX-License-Identifier: MIT
pragma solidity ^0.8.20;

import { ERC20 } from "@openzeppelin/contracts/token/ERC20/ERC20.sol";

/// @notice Minimal dStake token used to exercise router accounting in invariants.
contract MockDStakeToken is ERC20 {
    address public immutable underlyingAsset;
    address public owner;
    address public router;

    uint256 public backingAssets;

    error NotOwner();
    error NotRouter();
    error InvalidShareAmount(uint256 assets, uint256 shares);

    modifier onlyOwner() {
        if (msg.sender != owner) revert NotOwner();
        _;
    }

    constructor(address asset_) ERC20("Mock dStake Token", "mdSTK") {
        underlyingAsset = asset_;
        owner = msg.sender;
    }

    function setOwner(address newOwner) external onlyOwner {
        owner = newOwner;
    }

    function setRouter(address newRouter) external onlyOwner {
        router = newRouter;
    }

    function asset() external view returns (address) {
        return underlyingAsset;
    }

    function totalAssets() public view returns (uint256) {
        return backingAssets;
    }

    function previewDeposit(uint256 assets) public pure returns (uint256) {
        return assets;
    }

    function previewMint(uint256 shares) public pure returns (uint256) {
        return shares;
    }

    function previewWithdraw(uint256 assets) public pure returns (uint256) {
        return assets;
    }

    function previewRedeem(uint256 shares) public pure returns (uint256) {
        return shares;
    }

    function mintForRouter(address, address receiver, uint256 assets, uint256 shares) external {
        if (msg.sender != router) revert NotRouter();
        if (shares != assets) revert InvalidShareAmount(assets, shares);
        backingAssets += assets;
        _mint(receiver, shares);
    }

    function burnFromRouter(address, address, address ownerAccount, uint256 assets, uint256 shares) external {
        if (msg.sender != router) revert NotRouter();
        backingAssets -= assets;
        _burn(ownerAccount, shares);
    }
}
