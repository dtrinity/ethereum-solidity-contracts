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

import { OracleBaseV1_1 } from "../../oracle_aggregator/OracleBaseV1_1.sol";
import { IOracleWrapperV1_1 } from "../../oracle_aggregator/interface/IOracleWrapperV1_1.sol";

contract MockOracleAggregator is IOracleWrapperV1_1 {
    address public immutable BASE_CURRENCY;
    uint256 public immutable BASE_CURRENCY_UNIT;

    mapping(address => OracleBaseV1_1.PriceData) private _priceData;

    constructor(address _baseCurrency, uint256 _baseCurrencyUnit) {
        BASE_CURRENCY = _baseCurrency;
        BASE_CURRENCY_UNIT = _baseCurrencyUnit;
    }

    function setAssetPrice(address _asset, uint192 _price, bool alive) external {
        if (_asset == BASE_CURRENCY) {
            revert("Cannot set price for base currency");
        }

        _priceData[_asset] = OracleBaseV1_1.PriceData({
            price: _price,
            updatedAt: uint64(block.timestamp),
            isAlive: alive
        });
    }

    function setAssetAlive(address _asset, bool _isAlive) external {
        OracleBaseV1_1.PriceData storage data = _priceData[_asset];
        data.isAlive = _isAlive;
    }

    function setAssetPriceWithTimestamp(address _asset, uint192 _price, uint64 updatedAt, bool alive) external {
        _priceData[_asset] = OracleBaseV1_1.PriceData({ price: _price, updatedAt: updatedAt, isAlive: alive });
    }

    function getAssetPrice(address _asset) external view override returns (uint256) {
        if (_asset == BASE_CURRENCY) {
            return BASE_CURRENCY_UNIT;
        }

        OracleBaseV1_1.PriceData memory data = _priceData[_asset];
        require(data.isAlive, "Price feed is not alive");

        return data.price;
    }

    function getPriceInfo(address _asset) external view override returns (OracleBaseV1_1.PriceData memory) {
        if (_asset == BASE_CURRENCY) {
            return
                OracleBaseV1_1.PriceData({
                    price: uint192(BASE_CURRENCY_UNIT),
                    updatedAt: uint64(block.timestamp),
                    isAlive: true
                });
        }

        return _priceData[_asset];
    }
}
