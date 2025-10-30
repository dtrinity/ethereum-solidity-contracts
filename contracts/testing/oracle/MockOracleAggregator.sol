// SPDX-License-Identifier: GPL-2.0-or-later
/* ———————————————————————————————————————————————————————————————————————————————— *
 *    _____     ______   ______     __     __   __     __     ______   __  __       *
 *   /\  __-.  /\__  _\ /\  == \   /\ \   /\ "-.\ \   /\ \   /\__  _\ /\ \_\ \      *
 *   \ \ \/\ \ \/_/\ \/ \ \  __<   \ \ \  \ \ \-.  \  \ \ \  \/_/\ \/ \ \____ \     *
 *    \ \____-    \ \_\  \ \_\ \_\  \ \_\  \ \_\\"\_\  \ \_\    \ \_\  \/\_____\    *
 *     \/____/     \/_/   \/_/ /_/   \/_/   \/_/ \/_/   \/_/     \/_/   \/_____/    *
 *                                                                                  *
 * ————————————————————————————————— dtrinity.org ————————————————————————————————— *
 *                                                                                  *
 *                                         ▲                                        *
 *                                        ▲ ▲                                       *
 *                                                                                  *
 * ———————————————————————————————————————————————————————————————————————————————— *
 * dTRINITY Protocol: https://github.com/dtrinity                                   *
 * ———————————————————————————————————————————————————————————————————————————————— */

pragma solidity ^0.8.20;

import { IOracleWrapperV1_1 } from "../../oracle_aggregator/interface/IOracleWrapperV1_1.sol";

contract MockOracleAggregator is IOracleWrapperV1_1 {
    struct PriceInfo {
        uint256 price;
        bool isAlive;
    }

    address public immutable BASE_CURRENCY;
    uint256 private immutable _baseCurrencyUnit;

    mapping(address => PriceInfo) private _priceData;

    constructor(address baseCurrency, uint256 baseCurrencyUnit) {
        BASE_CURRENCY = baseCurrency;
        _baseCurrencyUnit = baseCurrencyUnit;
    }

    function setPrice(address asset, uint256 price, bool isAlive) external {
        _priceData[asset] = PriceInfo({ price: price, isAlive: isAlive });
    }

    function BASE_CURRENCY_UNIT() external view override returns (uint256) {
        return _baseCurrencyUnit;
    }

    function getAssetPrice(address asset) external view override returns (uint256) {
        (uint256 price, bool isAlive) = getPriceInfo(asset);
        if (!isAlive) {
            revert("Price feed is not alive");
        }
        return price;
    }

    function getPriceInfo(address asset) public view override returns (uint256 price, bool isAlive) {
        if (asset == BASE_CURRENCY) {
            return (_baseCurrencyUnit, true);
        }

        PriceInfo memory info = _priceData[asset];
        return (info.price, info.isAlive);
    }
}
