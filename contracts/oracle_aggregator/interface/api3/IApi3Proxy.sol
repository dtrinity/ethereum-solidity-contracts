// SPDX-License-Identifier: MIT
pragma solidity ^0.8.20;

interface IApi3Proxy {
    function read() external view returns (int224 value, uint256 timestamp);
}
