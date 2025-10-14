// SPDX-License-Identifier: MIT
pragma solidity ^0.8.20;

import {OracleBaseV1_1} from "../OracleBaseV1_1.sol";
import {IOracleWrapperV1_1} from "../interface/IOracleWrapperV1_1.sol";
import {AggregatorV3Interface} from "../interface/chainlink/IAggregatorV3Interface.sol";
import {IRateProvider} from "../interface/rate/IRateProvider.sol";
import {Math} from "@openzeppelin/contracts/utils/math/Math.sol";
import {SafeCast} from "@openzeppelin/contracts/utils/math/SafeCast.sol";

contract ChainlinkRateCompositeWrapperV1_1 is OracleBaseV1_1, IOracleWrapperV1_1 {
  using SafeCast for uint256;
  using SafeCast for int256;

  uint16 public constant MAX_BPS = 10_000;

  struct CompositeConfig {
    AggregatorV3Interface priceFeed;
    uint256 priceDecimalsFactor;
    IRateProvider rateProvider;
    uint256 rateDecimalsFactor;
    uint64 priceHeartbeat;
    uint64 rateHeartbeat;
    uint64 maxStaleTime;
    uint16 maxDeviationBps;
    uint192 minAnswer;
    uint192 maxAnswer;
    bool exists;
    PriceData lastGoodPrice;
  }

  mapping(address => CompositeConfig) private _compositeConfigs;

  event CompositeConfigured(
    address indexed asset,
    address indexed priceFeed,
    address indexed rateProvider,
    uint8 priceFeedDecimals,
    uint8 rateDecimals,
    uint64 priceHeartbeat,
    uint64 rateHeartbeat,
    uint64 maxStaleTime,
    uint16 maxDeviationBps,
    uint192 minAnswer,
    uint192 maxAnswer
  );
  event CompositeRemoved(address indexed asset, address indexed priceFeed, address indexed rateProvider);
  event CompositeObservationRecorded(address indexed asset, uint192 price, uint64 updatedAt);

  error CompositeNotConfigured(address asset);
  error FeedDecimalsChanged(address asset, uint8 expected, uint8 actual);
  error InvalidDeviationSetting();
  error CompositePriceNotAlive(address asset);
  error InvalidAnswerBounds(uint192 minAnswer, uint192 maxAnswer);

  constructor(address baseCurrency_, uint256 baseCurrencyUnit_, address initialAdmin)
    OracleBaseV1_1(baseCurrency_, baseCurrencyUnit_, initialAdmin)
  {}

  function configureComposite(
    address asset,
    address priceFeed,
    uint8 priceFeedDecimals,
    address rateProvider,
    uint8 rateDecimals,
    uint64 priceHeartbeat,
    uint64 rateHeartbeat,
    uint64 maxStaleTime,
    uint16 maxDeviationBps,
    uint192 minAnswer,
    uint192 maxAnswer
  ) external onlyRole(ORACLE_MANAGER_ROLE) {
    if (priceFeed.code.length == 0) {
      revert TargetNotContract(priceFeed);
    }
    if (rateProvider.code.length == 0) {
      revert TargetNotContract(rateProvider);
    }
    if (maxDeviationBps > MAX_BPS) {
      revert InvalidDeviationSetting();
    }
    if (maxAnswer != 0 && minAnswer > maxAnswer) {
      revert InvalidAnswerBounds(minAnswer, maxAnswer);
    }

    CompositeConfig storage config = _compositeConfigs[asset];
    config.priceFeed = AggregatorV3Interface(priceFeed);
    config.priceDecimalsFactor = 10 ** uint256(priceFeedDecimals);
    config.rateProvider = IRateProvider(rateProvider);
    config.rateDecimalsFactor = 10 ** uint256(rateDecimals);
    config.priceHeartbeat = priceHeartbeat;
    config.rateHeartbeat = rateHeartbeat;
    config.maxStaleTime = maxStaleTime;
    config.maxDeviationBps = maxDeviationBps;
    config.minAnswer = minAnswer;
    config.maxAnswer = maxAnswer;
    config.exists = true;
    config.lastGoodPrice = PriceData({ price: 0, updatedAt: 0, isAlive: false });

    emit CompositeConfigured(
      asset,
      priceFeed,
      rateProvider,
      priceFeedDecimals,
      rateDecimals,
      priceHeartbeat,
      rateHeartbeat,
      maxStaleTime,
      maxDeviationBps,
      minAnswer,
      maxAnswer
    );
  }

  function removeComposite(address asset) external onlyRole(ORACLE_MANAGER_ROLE) {
    CompositeConfig storage config = _compositeConfigs[asset];
    if (!config.exists) {
      revert CompositeNotConfigured(asset);
    }
    emit CompositeRemoved(asset, address(config.priceFeed), address(config.rateProvider));
    delete _compositeConfigs[asset];
  }

  function recordLastGoodPrice(address asset) external onlyRole(ORACLE_MANAGER_ROLE) returns (PriceData memory) {
    PriceData memory data = getPriceInfo(asset);
    if (!data.isAlive) {
      revert CompositePriceNotAlive(asset);
    }
    CompositeConfig storage config = _compositeConfigs[asset];
    config.lastGoodPrice = data;
    emit CompositeObservationRecorded(asset, data.price, data.updatedAt);
    return data;
  }

  function getAssetPrice(address asset) external view override returns (uint256) {
    PriceData memory data = getPriceInfo(asset);
    if (!data.isAlive) {
      revert CompositePriceNotAlive(asset);
    }
    return data.price;
  }

  function getPriceInfo(address asset) public view override returns (PriceData memory data) {
    CompositeConfig storage config = _compositeConfigs[asset];
    if (!config.exists) {
      revert CompositeNotConfigured(asset);
    }

    uint64 priceUpdatedAt;
    uint256 compositePrice;
    {
      (
        uint80 priceRoundId,
        int256 priceAnswer,
        uint256 priceStartedAt,
        uint256 priceUpdatedRaw,
        uint80 priceAnsweredInRound
      ) = config.priceFeed.latestRoundData();

      if (
        priceAnswer <= 0 ||
        priceAnsweredInRound < priceRoundId ||
        priceUpdatedRaw == 0 ||
        priceUpdatedRaw > block.timestamp ||
        priceStartedAt == 0 ||
        priceStartedAt > priceUpdatedRaw
      ) {
        data.updatedAt = uint64(priceUpdatedRaw);
        data.isAlive = false;
        return data;
      }

      priceUpdatedAt = uint64(priceUpdatedRaw);
      compositePrice = Math.mulDiv(uint256(priceAnswer), BASE_CURRENCY_UNIT(), config.priceDecimalsFactor);
    }

    uint64 rateUpdatedAt;
    {
      (uint256 rateRaw, uint256 rateUpdatedRaw) = config.rateProvider.getRateSafe();
      if (rateRaw == 0 || rateUpdatedRaw == 0 || rateUpdatedRaw > block.timestamp) {
        data.price = compositePrice > type(uint192).max ? type(uint192).max : compositePrice.toUint192();
        data.updatedAt = priceUpdatedAt;
        data.isAlive = false;
        return data;
      }
      rateUpdatedAt = uint64(rateUpdatedRaw);
      compositePrice = Math.mulDiv(compositePrice, rateRaw, config.rateDecimalsFactor);
    }

    bool alive = true;
    uint64 maxStale = config.maxStaleTime == 0 ? DEFAULT_MAX_STALE_TIME : config.maxStaleTime;

    if (block.timestamp - priceUpdatedAt > (config.priceHeartbeat == 0 ? DEFAULT_HEARTBEAT : config.priceHeartbeat) + maxStale) {
      alive = false;
    }
    if (block.timestamp - rateUpdatedAt > (config.rateHeartbeat == 0 ? DEFAULT_HEARTBEAT : config.rateHeartbeat) + maxStale) {
      alive = false;
    }

    if (alive && config.minAnswer != 0 && compositePrice < config.minAnswer) {
      alive = false;
    }
    if (alive && config.maxAnswer != 0 && compositePrice > config.maxAnswer) {
      alive = false;
    }

    if (alive && compositePrice > type(uint192).max) {
      alive = false;
    }

    if (alive && config.maxDeviationBps != 0 && config.lastGoodPrice.price != 0) {
      uint192 lastPrice = config.lastGoodPrice.price;
      uint256 diff = compositePrice > lastPrice ? compositePrice - lastPrice : lastPrice - compositePrice;
      if (Math.mulDiv(diff, MAX_BPS, lastPrice) > config.maxDeviationBps) {
        alive = false;
      }
    }

    data.price = compositePrice > type(uint192).max ? type(uint192).max : compositePrice.toUint192();
    data.updatedAt = priceUpdatedAt > rateUpdatedAt ? priceUpdatedAt : rateUpdatedAt;
    data.isAlive = alive;
    return data;
  }

  function compositeConfig(address asset) external view returns (CompositeConfig memory) {
    return _compositeConfigs[asset];
  }

  function BASE_CURRENCY() public view override(OracleBaseV1_1, IOracleWrapperV1_1) returns (address) {
    return OracleBaseV1_1.BASE_CURRENCY();
  }

  function BASE_CURRENCY_UNIT() public view override(OracleBaseV1_1, IOracleWrapperV1_1) returns (uint256) {
    return OracleBaseV1_1.BASE_CURRENCY_UNIT();
  }
}
