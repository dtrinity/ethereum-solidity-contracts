// SPDX-License-Identifier: MIT
pragma solidity ^0.8.20;

contract MockApi3Proxy {
    int224 private _value;
    uint256 private _timestamp;

    function setValue(int224 value, uint256 timestamp) external {
        _value = value;
        _timestamp = timestamp;
    }

    function read() external view returns (int224 value, uint256 timestamp) {
        return (_value, _timestamp);
    }
}
