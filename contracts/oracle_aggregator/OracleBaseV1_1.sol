// SPDX-License-Identifier: MIT
pragma solidity ^0.8.20;

import {AccessControlEnumerable} from "@openzeppelin/contracts/access/extensions/AccessControlEnumerable.sol";
import {SafeCast} from "@openzeppelin/contracts/utils/math/SafeCast.sol";
import {Math} from "@openzeppelin/contracts/utils/math/Math.sol";

/**
 * @dev Abstract base contract shared by all oracle wrappers in the V1.1 stack.
 *      Provides shared data-structures, access control glue, and validation helpers
 *      so concrete wrappers only need to focus on provider specific integrations.
 */
abstract contract OracleBaseV1_1 is AccessControlEnumerable {
  using SafeCast for uint256;
  using SafeCast for int256;

  /// @notice Standardised view of an oracle observation consumed by the aggregator stack.
  struct PriceData {
    uint192 price; // price normalised to the aggregator's BASE_CURRENCY_UNIT
    uint64 updatedAt; // provider supplied timestamp of the observation
    bool isAlive; // whether the underlying feed considers the price usable
  }

  /// @notice configuration that concrete wrappers can embed or extend.
  struct AssetConfig {
    bool exists;
    uint64 heartbeat; // expected heartbeat for the feed (seconds)
    uint64 maxStaleTime; // override for stale threshold (seconds)
    uint16 maxDeviationBps; // deviation gating threshold relative to last good price
    uint192 minAnswer; // lower bound clamp in provider native units
    uint192 maxAnswer; // upper bound clamp in provider native units
  }

  /// @notice role used by governance / admin accounts.
  bytes32 public constant ADMIN_ROLE = keccak256("ADMIN_ROLE");

  /// @notice role allowed to manage per asset feed wiring and threshold tuning.
  bytes32 public constant ORACLE_MANAGER_ROLE = keccak256("ORACLE_MANAGER_ROLE");

  /// @notice role allowed to perform emergency actions such as freezing assets.
  bytes32 public constant GUARDIAN_ROLE = keccak256("GUARDIAN_ROLE");

  /// @notice canonical heartbeat default (1 hour) used unless overridden per-asset.
  uint64 public constant DEFAULT_HEARTBEAT = 1 hours;

  /// @notice canonical max stale default (1 hour) used unless overridden per-asset.
  uint64 public constant DEFAULT_MAX_STALE_TIME = 1 hours;

  /// @notice Error thrown when trying to operate on an asset configuration that does not exist.
  error AssetNotConfigured(address asset);

  /// @notice Error thrown when a zero address is provided where non-zero is required.
  error ZeroAddress(string param);

  /// @notice Error thrown when a target address is not a deployed contract.
  error TargetNotContract(address target);

  /// @notice Error thrown when a price lies below the configured minimum answer clamp.
  error PriceBelowMinimum(address asset, uint192 price, uint192 minAnswer);

  /// @notice Error thrown when a price lies above the configured maximum answer clamp.
  error PriceAboveMaximum(address asset, uint192 price, uint192 maxAnswer);

  /// @notice Error thrown when the oracle data is stale relative to the configured heartbeat.
  error StalePrice(address asset, uint64 updatedAt, uint64 heartbeat, uint64 buffer, uint64 currentTimestamp);

  /// @notice Error thrown when a timestamp is in the future relative to the current block.
  error TimestampInFuture(address asset, uint64 updatedAt, uint64 currentTimestamp);

  /// @notice Error emitted when deviation exceeds configured bounds.
  error DeviationExceeded(address asset, uint192 price, uint192 referencePrice, uint16 maxDeviationBps);

  event AdminGranted(address indexed account);
  event OracleManagerGranted(address indexed account);
  event GuardianGranted(address indexed account);

  address internal immutable _baseCurrency;
  uint256 internal immutable _baseCurrencyUnit;

  constructor(address baseCurrency_, uint256 baseCurrencyUnit_, address initialAdmin) {
    if (baseCurrencyUnit_ == 0) {
      revert ZeroAddress("baseCurrencyUnit");
    }
    if (initialAdmin == address(0)) {
      revert ZeroAddress("initialAdmin");
    }
    _baseCurrency = baseCurrency_;
    _baseCurrencyUnit = baseCurrencyUnit_;

    _grantRole(DEFAULT_ADMIN_ROLE, initialAdmin);
    _grantRole(ADMIN_ROLE, initialAdmin);
    _grantRole(ORACLE_MANAGER_ROLE, initialAdmin);
    _grantRole(GUARDIAN_ROLE, initialAdmin);
  }

  /**
   * @notice Base currency address shared across the oracle stack.
   */
  function BASE_CURRENCY() public view virtual returns (address) {
    return _baseCurrency;
  }

  /**
   * @notice Base currency unit shared across the oracle stack.
   */
  function BASE_CURRENCY_UNIT() public view virtual returns (uint256) {
    return _baseCurrencyUnit;
  }

  /**
   * @dev Utility to ensure an address is non-zero and a deployed contract.
   */
  function _assertContractAddress(address target, string memory param) internal view {
    if (target == address(0)) {
      revert ZeroAddress(param);
    }
    if (target.code.length == 0) {
      revert TargetNotContract(target);
    }
  }

  /**
   * @dev Ensures the supplied timestamp is not in the future and within allowed staleness.
   */
  function _checkFreshness(
    address asset,
    uint64 updatedAt,
    uint64 maxStaleTime,
    uint64 heartbeatBuffer
  ) internal view {
    uint64 currentTimestamp = uint64(block.timestamp);
    if (updatedAt > currentTimestamp) {
      revert TimestampInFuture(asset, updatedAt, currentTimestamp);
    }

    uint64 threshold = maxStaleTime == 0 ? DEFAULT_MAX_STALE_TIME : maxStaleTime;
    uint64 heartbeat = heartbeatBuffer == 0 ? DEFAULT_HEARTBEAT : heartbeatBuffer;
    if (currentTimestamp - updatedAt > threshold + heartbeat) {
      revert StalePrice(asset, updatedAt, heartbeat, threshold, currentTimestamp);
    }
  }

  /**
   * @dev Ensures the supplied price is inside configured bounds.
   */
  function _checkBounds(
    address asset,
    uint192 price,
    uint192 minAnswer,
    uint192 maxAnswer
  ) internal pure {
    if (minAnswer != 0 && price < minAnswer) {
      revert PriceBelowMinimum(asset, price, minAnswer);
    }
    if (maxAnswer != 0 && price > maxAnswer) {
      revert PriceAboveMaximum(asset, price, maxAnswer);
    }
  }

  /**
   * @dev Ensures the deviation between price and reference is within limits.
   */
  function _checkDeviation(
    address asset,
    uint192 price,
    uint192 referencePrice,
    uint16 maxDeviationBps
  ) internal pure {
    if (maxDeviationBps == 0 || referencePrice == 0) {
      return;
    }

    uint256 difference = price > referencePrice ? price - referencePrice : referencePrice - price;
    uint256 deviationBps = referencePrice == 0
      ? 0
      : Math.mulDiv(difference, 10_000, referencePrice);

    if (deviationBps > maxDeviationBps) {
      revert DeviationExceeded(asset, price, referencePrice, maxDeviationBps);
    }
  }
}
