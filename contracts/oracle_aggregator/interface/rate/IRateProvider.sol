// SPDX-License-Identifier: MIT
pragma solidity ^0.8.20;

interface IRateProvider {
    function getRateSafe() external view returns (uint256 rate, uint256 updatedAt);
}
