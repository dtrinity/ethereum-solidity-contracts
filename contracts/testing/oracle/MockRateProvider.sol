// SPDX-License-Identifier: MIT
pragma solidity ^0.8.20;

contract MockRateProvider {
  uint256 private _rate;
  uint256 private _updatedAt;

  function setRate(uint256 rate, uint256 updatedAt) external {
    _rate = rate;
    _updatedAt = updatedAt;
  }

  function getRateSafe() external view returns (uint256 rate, uint256 updatedAt) {
    return (_rate, _updatedAt);
  }
}
