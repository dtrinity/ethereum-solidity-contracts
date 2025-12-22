// SPDX-License-Identifier: MIT
pragma solidity ^0.8.20;

contract MockTotalSupplyToken {
    uint256 private _totalSupply;

    function setTotalSupply(uint256 newSupply) external {
        _totalSupply = newSupply;
    }

    function totalSupply() external view returns (uint256) {
        return _totalSupply;
    }
}
