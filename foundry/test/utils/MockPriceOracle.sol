// SPDX-License-Identifier: MIT
pragma solidity ^0.8.20;

import "common/IAaveOracle.sol";

/// @notice Lightweight oracle for Foundry invariants with manually pushed prices.
contract MockPriceOracle is IPriceOracleGetter {
    address public immutable baseCurrency;
    uint256 public immutable baseCurrencyUnit;

    mapping(address => uint256) private _prices;

    error PriceNotSet(address asset);

    constructor(address baseCurrency_, uint256 baseCurrencyUnit_) {
        baseCurrency = baseCurrency_;
        baseCurrencyUnit = baseCurrencyUnit_;
    }

    function setPrice(address asset, uint256 price) external {
        _prices[asset] = price;
    }

    function BASE_CURRENCY() external view override returns (address) {
        return baseCurrency;
    }

    function BASE_CURRENCY_UNIT() external view override returns (uint256) {
        return baseCurrencyUnit;
    }

    function getAssetPrice(address asset) external view override returns (uint256) {
        if (asset == baseCurrency) {
            return baseCurrencyUnit;
        }

        uint256 price = _prices[asset];
        if (price == 0) {
            revert PriceNotSet(asset);
        }
        return price;
    }
}
