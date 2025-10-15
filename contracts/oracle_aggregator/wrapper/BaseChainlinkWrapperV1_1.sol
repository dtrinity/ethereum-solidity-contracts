// SPDX-License-Identifier: MIT
pragma solidity ^0.8.20;

import { OracleBaseV1_1 } from "../OracleBaseV1_1.sol";
import { IOracleWrapperV1_1 } from "../interface/IOracleWrapperV1_1.sol";
import { AggregatorV3Interface } from "../interface/chainlink/IAggregatorV3Interface.sol";
import { Math } from "@openzeppelin/contracts/utils/math/Math.sol";
import { SafeCast } from "@openzeppelin/contracts/utils/math/SafeCast.sol";

/**
 * @dev Abstract base for Chainlink style oracle wrappers. Handles feed wiring, heartbeat configuration,
 *      and standardised validation of latest round data before reporting back to the aggregator.
 */
abstract contract BaseChainlinkWrapperV1_1 is OracleBaseV1_1, IOracleWrapperV1_1 {
  using SafeCast for uint256;
  using SafeCast for int256;

  uint16 public constant MAX_BPS = 10_000;

  struct FeedConfig {
    AggregatorV3Interface feed;
    uint256 decimalsFactor;
    uint64 heartbeat;
    uint64 maxStaleTime;
    uint16 maxDeviationBps;
    uint192 minAnswer;
    uint192 maxAnswer;
    bool exists;
    PriceData lastGoodPrice;
  }

  mapping(address => FeedConfig) internal _feedConfigs;

  event FeedConfigured(
    address indexed asset,
    address indexed feed,
    uint8 decimals,
    uint64 heartbeat,
    uint64 maxStaleTime,
    uint16 maxDeviationBps,
    uint192 minAnswer,
    uint192 maxAnswer
  );
  event FeedRemoved(address indexed asset, address indexed feed);
  event FeedHeartbeatUpdated(address indexed asset, uint64 previousHeartbeat, uint64 newHeartbeat);
  event FeedMaxStaleTimeUpdated(address indexed asset, uint64 previousMaxStaleTime, uint64 newMaxStaleTime);
  event FeedBoundsUpdated(address indexed asset, uint192 minAnswer, uint192 maxAnswer);
  event FeedDeviationUpdated(address indexed asset, uint16 previousDeviationBps, uint16 newDeviationBps);
  event FeedObservationRecorded(address indexed asset, uint192 price, uint64 updatedAt);

  error FeedNotConfigured(address asset);
  error FeedDecimalsChanged(address asset, uint8 expectedDecimals, uint8 providedDecimals);
  error FeedAddressZero();
  error FeedAddressNotContract(address feed);
  error InvalidDeviationSetting();
  error FeedPriceNotAlive(address asset);

  constructor(
    address baseCurrency_,
    uint256 baseCurrencyUnit_,
    address initialAdmin
  ) OracleBaseV1_1(baseCurrency_, baseCurrencyUnit_, initialAdmin) {}

  function getAssetPrice(address asset) external view override returns (uint256) {
    PriceData memory data = getPriceInfo(asset);
    if (!data.isAlive) {
      revert FeedPriceNotAlive(asset);
    }
    return data.price;
  }

  function getPriceInfo(address asset) public view virtual override returns (PriceData memory) {
    FeedConfig storage config = _feedConfigs[asset];
    if (!config.exists) {
      revert FeedNotConfigured(asset);
    }

    AggregatorV3Interface feed = config.feed;
    (uint80 roundId, int256 answer, uint256 startedAt, uint256 updatedAt, uint80 answeredInRound) = feed.latestRoundData();

    PriceData memory data;
    bool alive = true;

    if (answer <= 0) {
      alive = false;
    }

    if (answeredInRound < roundId) {
      alive = false;
    }

    if (updatedAt == 0 || updatedAt > block.timestamp) {
      alive = false;
    }

    if (startedAt == 0 || startedAt > updatedAt) {
      alive = false;
    }

    uint64 updatedAt64 = updatedAt.toUint64();

    uint256 normalizedPrice = 0;
    if (alive) {
      normalizedPrice = _normalisePrice(asset, uint256(answer), config.decimalsFactor);
      if (config.minAnswer != 0 && normalizedPrice < config.minAnswer) {
        alive = false;
      }
      if (config.maxAnswer != 0 && normalizedPrice > config.maxAnswer) {
        alive = false;
      }

      uint64 heartbeat = config.heartbeat == 0 ? DEFAULT_HEARTBEAT : config.heartbeat;
      uint64 staleLimit = config.maxStaleTime == 0 ? DEFAULT_MAX_STALE_TIME : config.maxStaleTime;
      if (block.timestamp - updatedAt64 > heartbeat + staleLimit) {
        alive = false;
      }

      if (alive && config.maxDeviationBps != 0 && config.lastGoodPrice.price != 0) {
        uint192 referencePrice = config.lastGoodPrice.price;
        uint256 difference = normalizedPrice > referencePrice ? normalizedPrice - referencePrice : referencePrice - normalizedPrice;
        uint256 deviationBps = Math.mulDiv(difference, MAX_BPS, referencePrice);
        if (deviationBps > config.maxDeviationBps) {
          alive = false;
        }
      }
    } else {
      normalizedPrice = uint256(answer > 0 ? answer : int256(0));
    }

    if (normalizedPrice > type(uint192).max) {
      alive = false;
    }

    data.price = normalizedPrice.toUint192();
    data.updatedAt = updatedAt64;
    data.isAlive = alive;
    return data;
  }

  function configureFeed(
    address asset,
    address feed,
    uint64 heartbeat,
    uint64 maxStaleTime,
    uint16 maxDeviationBps,
    uint192 minAnswer,
    uint192 maxAnswer
  ) external onlyRole(ORACLE_MANAGER_ROLE) {
    if (feed == address(0)) {
      revert FeedAddressZero();
    }
    if (feed.code.length == 0) {
      revert FeedAddressNotContract(feed);
    }
    if (maxDeviationBps > MAX_BPS) {
      revert InvalidDeviationSetting();
    }

    AggregatorV3Interface aggregator = AggregatorV3Interface(feed);
    uint8 feedDecimals = aggregator.decimals();
    uint256 decimalsFactor = 10 ** uint256(feedDecimals);

    FeedConfig storage config = _feedConfigs[asset];
    if (config.exists && config.decimalsFactor != 0 && config.decimalsFactor != decimalsFactor) {
      revert FeedDecimalsChanged(asset, _factorToDecimals(config.decimalsFactor), feedDecimals);
    }

    address previousFeed = address(config.feed);
    bool feedChanged = previousFeed != feed;
    config.feed = aggregator;
    config.decimalsFactor = decimalsFactor;
    config.heartbeat = heartbeat;
    config.maxStaleTime = maxStaleTime;
    config.maxDeviationBps = maxDeviationBps;
    config.minAnswer = minAnswer;
    config.maxAnswer = maxAnswer;
    config.exists = true;
    if (feedChanged) {
      config.lastGoodPrice = PriceData({ price: 0, updatedAt: 0, isAlive: false });
    }

    emit FeedConfigured(asset, feed, feedDecimals, heartbeat, maxStaleTime, maxDeviationBps, minAnswer, maxAnswer);
  }

  function removeFeed(address asset) external onlyRole(ORACLE_MANAGER_ROLE) {
    FeedConfig storage config = _feedConfigs[asset];
    if (!config.exists) {
      revert FeedNotConfigured(asset);
    }
    address previousFeed = address(config.feed);
    delete _feedConfigs[asset];
    emit FeedRemoved(asset, previousFeed);
  }

  function updateHeartbeat(address asset, uint64 newHeartbeat) external onlyRole(ORACLE_MANAGER_ROLE) {
    FeedConfig storage config = _feedConfigs[asset];
    if (!config.exists) {
      revert FeedNotConfigured(asset);
    }
    uint64 previous = config.heartbeat;
    config.heartbeat = newHeartbeat;
    emit FeedHeartbeatUpdated(asset, previous, newHeartbeat);
  }

  function updateMaxStaleTime(address asset, uint64 newMaxStaleTime) external onlyRole(ORACLE_MANAGER_ROLE) {
    FeedConfig storage config = _feedConfigs[asset];
    if (!config.exists) {
      revert FeedNotConfigured(asset);
    }
    uint64 previous = config.maxStaleTime;
    config.maxStaleTime = newMaxStaleTime;
    emit FeedMaxStaleTimeUpdated(asset, previous, newMaxStaleTime);
  }

  function updateAnswerBounds(address asset, uint192 minAnswer, uint192 maxAnswer) external onlyRole(ORACLE_MANAGER_ROLE) {
    FeedConfig storage config = _feedConfigs[asset];
    if (!config.exists) {
      revert FeedNotConfigured(asset);
    }
    config.minAnswer = minAnswer;
    config.maxAnswer = maxAnswer;
    emit FeedBoundsUpdated(asset, minAnswer, maxAnswer);
  }

  function updateDeviationThreshold(address asset, uint16 newDeviationBps) external onlyRole(ORACLE_MANAGER_ROLE) {
    if (newDeviationBps > MAX_BPS) {
      revert InvalidDeviationSetting();
    }
    FeedConfig storage config = _feedConfigs[asset];
    if (!config.exists) {
      revert FeedNotConfigured(asset);
    }
    uint16 previous = config.maxDeviationBps;
    config.maxDeviationBps = newDeviationBps;
    emit FeedDeviationUpdated(asset, previous, newDeviationBps);
  }

  function recordLastGoodPrice(address asset) external onlyRole(ORACLE_MANAGER_ROLE) returns (PriceData memory) {
    FeedConfig storage config = _feedConfigs[asset];
    if (!config.exists) {
      revert FeedNotConfigured(asset);
    }

    PriceData memory data = getPriceInfo(asset);
    if (!data.isAlive) {
      revert FeedPriceNotAlive(asset);
    }

    config.lastGoodPrice = data;
    emit FeedObservationRecorded(asset, data.price, data.updatedAt);
    return data;
  }

  function feedConfig(address asset) external view returns (FeedConfig memory) {
    return _feedConfigs[asset];
  }

  function BASE_CURRENCY() public view override(OracleBaseV1_1, IOracleWrapperV1_1) returns (address) {
    return OracleBaseV1_1.BASE_CURRENCY();
  }

  function BASE_CURRENCY_UNIT() public view override(OracleBaseV1_1, IOracleWrapperV1_1) returns (uint256) {
    return OracleBaseV1_1.BASE_CURRENCY_UNIT();
  }

  function _normalisePrice(address asset, uint256 price, uint256 decimalsFactor) internal view returns (uint256) {
    if (decimalsFactor == 0) {
      revert FeedDecimalsChanged(asset, 0, 0);
    }
    return Math.mulDiv(price, BASE_CURRENCY_UNIT(), decimalsFactor);
  }

  function _factorToDecimals(uint256 factor) private pure returns (uint8) {
    uint8 decimals = 0;
    while (factor > 1) {
      factor /= 10;
      unchecked {
        ++decimals;
      }
    }
    return decimals;
  }
}
