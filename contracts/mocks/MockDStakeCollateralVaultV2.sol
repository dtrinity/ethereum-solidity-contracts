// SPDX-License-Identifier: MIT
pragma solidity ^0.8.20;

import { IDStakeCollateralVaultV2 } from "../vaults/dstake/interfaces/IDStakeCollateralVaultV2.sol";

error MockNotImplemented();

contract MockDStakeCollateralVaultV2 is IDStakeCollateralVaultV2 {
    address private immutable dStableAsset;
    address private dStakeToken_;
    address private router_;
    uint256 private totalValue;

    constructor(address dStable_) {
        dStableAsset = dStable_;
    }

    function setDStakeToken(address token) external {
        dStakeToken_ = token;
    }

    function setRouter(address newRouter) external {
        router_ = newRouter;
    }

    function setTotalValue(uint256 newValue) external {
        totalValue = newValue;
    }

    function totalValueInDStable() external view override returns (uint256) {
        return totalValue;
    }

    function dStable() external view override returns (address) {
        return dStableAsset;
    }

    function dStakeToken() external view override returns (address) {
        return dStakeToken_;
    }

    function router() external view override returns (address) {
        return router_;
    }

    function supportedStrategyShares(uint256) external pure override returns (address) {
        return address(0);
    }

    function getSupportedStrategyShares() external pure override returns (address[] memory) {
        return new address[](0);
    }

    function transferStrategyShares(address, uint256, address) external pure override {
        revert MockNotImplemented();
    }

    function addSupportedStrategyShare(address) external pure override {
        revert MockNotImplemented();
    }

    function removeSupportedStrategyShare(address) external pure override {
        revert MockNotImplemented();
    }
}
