// SPDX-License-Identifier: MIT
pragma solidity ^0.8.20;

contract MockPoolAddressesProvider {
    address private priceOracle;

    function setPriceOracle(address newOracle) external {
        priceOracle = newOracle;
    }

    function getPriceOracle() external view returns (address) {
        return priceOracle;
    }
}
