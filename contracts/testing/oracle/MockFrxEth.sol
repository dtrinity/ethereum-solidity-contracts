// SPDX-License-Identifier: MIT
pragma solidity ^0.8.20;

/**
 * @title MockFrxEth
 * @notice Minimal totalSupply-only mock used by the frxETH fundamental oracle tests.
 */
contract MockFrxEth {
    uint256 private _totalSupply;

    constructor(uint256 initialSupply) {
        _totalSupply = initialSupply;
    }

    function setTotalSupply(uint256 newSupply) external {
        _totalSupply = newSupply;
    }

    function totalSupply() external view returns (uint256) {
        return _totalSupply;
    }
}
