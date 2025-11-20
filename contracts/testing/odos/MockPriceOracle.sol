// SPDX-License-Identifier: MIT
pragma solidity ^0.8.20;

import { IPriceOracleGetter } from "contracts/dlend/core/interfaces/IPriceOracleGetter.sol";

contract MockPriceOracle is IPriceOracleGetter {
    mapping(address => uint256) private prices;

    function setAssetPrice(address asset, uint256 price) external {
        prices[asset] = price;
    }

    function BASE_CURRENCY() external pure override returns (address) {
        return address(0);
    }

    function BASE_CURRENCY_UNIT() external pure override returns (uint256) {
        return 1e8;
    }

    function getAssetPrice(address asset) external view override returns (uint256) {
        return prices[asset];
    }
}
