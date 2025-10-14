// SPDX-License-Identifier: MIT
pragma solidity ^0.8.20;

import {OracleBaseV1_1} from "../OracleBaseV1_1.sol";
import {IOracleWrapperV1_1} from "../interface/IOracleWrapperV1_1.sol";

/**
 * @dev Hard peg oracle wrapper that always returns a guardian-governed fixed price with
 *      configurable guard rails to avoid accidental misconfiguration.
 */
contract HardPegOracleWrapperV1_1 is OracleBaseV1_1, IOracleWrapperV1_1 {

  struct PegConfig {
    uint192 pricePeg;
    uint192 lowerGuard;
    uint192 upperGuard;
    uint64 lastUpdatedAt;
    bool exists;
  }

  mapping(address => PegConfig) private _pegs;

  event PegConfigured(address indexed asset, uint192 pricePeg, uint192 lowerGuard, uint192 upperGuard);
  event PegUpdated(address indexed asset, uint192 previousPeg, uint192 newPeg, uint64 updatedAt);
  event GuardRailsUpdated(address indexed asset, uint192 lowerGuard, uint192 upperGuard);

  error PegNotConfigured(address asset);
  error PegOutOfBounds(address asset, uint192 price, uint192 lowerGuard, uint192 upperGuard);
  error InvalidGuardRails(address asset, uint192 lowerGuard, uint192 upperGuard);

  constructor(address baseCurrency_, uint256 baseCurrencyUnit_, address initialAdmin)
    OracleBaseV1_1(baseCurrency_, baseCurrencyUnit_, initialAdmin)
  {}

  function configurePeg(
    address asset,
    uint192 pricePeg,
    uint192 lowerGuard,
    uint192 upperGuard
  ) external onlyRole(ORACLE_MANAGER_ROLE) {
    if (upperGuard != 0 && lowerGuard > upperGuard) {
      revert InvalidGuardRails(asset, lowerGuard, upperGuard);
    }
    if (upperGuard != 0 && (pricePeg < lowerGuard || pricePeg > upperGuard)) {
      revert PegOutOfBounds(asset, pricePeg, lowerGuard, upperGuard);
    }

    PegConfig storage config = _pegs[asset];
    config.pricePeg = pricePeg;
    config.lowerGuard = lowerGuard;
    config.upperGuard = upperGuard;
    config.lastUpdatedAt = uint64(block.timestamp);
    config.exists = true;

    emit PegConfigured(asset, pricePeg, lowerGuard, upperGuard);
  }

  function updatePeg(address asset, uint192 newPeg) external onlyRole(GUARDIAN_ROLE) {
    PegConfig storage config = _pegs[asset];
    if (!config.exists) {
      revert PegNotConfigured(asset);
    }

    if (config.upperGuard != 0 && (newPeg < config.lowerGuard || newPeg > config.upperGuard)) {
      revert PegOutOfBounds(asset, newPeg, config.lowerGuard, config.upperGuard);
    }

    uint192 previousPeg = config.pricePeg;
    config.pricePeg = newPeg;
    config.lastUpdatedAt = uint64(block.timestamp);

    emit PegUpdated(asset, previousPeg, newPeg, config.lastUpdatedAt);
  }

  function updateGuardRails(address asset, uint192 lowerGuard, uint192 upperGuard) external onlyRole(ORACLE_MANAGER_ROLE) {
    PegConfig storage config = _pegs[asset];
    if (!config.exists) {
      revert PegNotConfigured(asset);
    }
    if (upperGuard != 0 && lowerGuard > upperGuard) {
      revert InvalidGuardRails(asset, lowerGuard, upperGuard);
    }
    if (upperGuard != 0 && (config.pricePeg < lowerGuard || config.pricePeg > upperGuard)) {
      revert PegOutOfBounds(asset, config.pricePeg, lowerGuard, upperGuard);
    }

    config.lowerGuard = lowerGuard;
    config.upperGuard = upperGuard;
    emit GuardRailsUpdated(asset, lowerGuard, upperGuard);
  }

  function getAssetPrice(address asset) external view override returns (uint256) {
    PegConfig storage config = _pegs[asset];
    if (!config.exists) {
      revert PegNotConfigured(asset);
    }
    return config.pricePeg;
  }

  function getPriceInfo(address asset) public view override returns (PriceData memory) {
    PegConfig storage config = _pegs[asset];
    if (!config.exists) {
      revert PegNotConfigured(asset);
    }

    return PriceData({ price: config.pricePeg, updatedAt: config.lastUpdatedAt, isAlive: true });
  }

  function pegConfig(address asset) external view returns (PegConfig memory) {
    return _pegs[asset];
  }

  function BASE_CURRENCY() public view override(OracleBaseV1_1, IOracleWrapperV1_1) returns (address) {
    return OracleBaseV1_1.BASE_CURRENCY();
  }

  function BASE_CURRENCY_UNIT() public view override(OracleBaseV1_1, IOracleWrapperV1_1) returns (uint256) {
    return OracleBaseV1_1.BASE_CURRENCY_UNIT();
  }
}
