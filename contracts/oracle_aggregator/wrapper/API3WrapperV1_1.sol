// SPDX-License-Identifier: MIT
pragma solidity ^0.8.20;

import { OracleBaseV1_1 } from "../OracleBaseV1_1.sol";
import { IOracleWrapperV1_1 } from "../interface/IOracleWrapperV1_1.sol";
import { IApi3Proxy } from "../interface/api3/IApi3Proxy.sol";
import { Math } from "@openzeppelin/contracts/utils/math/Math.sol";
import { SafeCast } from "@openzeppelin/contracts/utils/math/SafeCast.sol";

contract API3WrapperV1_1 is OracleBaseV1_1, IOracleWrapperV1_1 {
  using SafeCast for uint256;
  using SafeCast for int256;

  uint16 public constant MAX_BPS = 10_000;

  struct ProxyConfig {
    address proxy;
    uint8 decimals;
    uint256 decimalsFactor;
    uint64 heartbeat;
    uint64 maxStaleTime;
    uint16 maxDeviationBps;
    uint192 minAnswer;
    uint192 maxAnswer;
    bool exists;
    PriceData lastGoodPrice;
  }

  mapping(address => ProxyConfig) private _proxyConfigs;

  event ProxyConfigured(
    address indexed asset,
    address indexed proxy,
    uint8 decimals,
    uint64 heartbeat,
    uint64 maxStaleTime,
    uint16 maxDeviationBps,
    uint192 minAnswer,
    uint192 maxAnswer
  );
  event ProxyRemoved(address indexed asset, address indexed proxy);
  event ProxyHeartbeatUpdated(address indexed asset, uint64 previousHeartbeat, uint64 newHeartbeat);
  event ProxyBoundsUpdated(address indexed asset, uint192 minAnswer, uint192 maxAnswer);
  event ProxyDeviationUpdated(address indexed asset, uint16 previousDeviationBps, uint16 newDeviationBps);
  event ProxyObservationRecorded(address indexed asset, uint192 price, uint64 updatedAt);

  error ProxyNotConfigured(address asset);
  error ProxyNotContract(address proxy);
  error InvalidProxyDecimals(uint8 decimals);
  error ProxyPriceNotAlive(address asset);
  error InvalidDeviationSetting();
  error InvalidAnswerBounds(uint192 minAnswer, uint192 maxAnswer);

  constructor(
    address baseCurrency_,
    uint256 baseCurrencyUnit_,
    address initialAdmin
  ) OracleBaseV1_1(baseCurrency_, baseCurrencyUnit_, initialAdmin) {}

  function configureProxy(
    address asset,
    address proxy,
    uint8 decimals,
    uint64 heartbeat,
    uint64 maxStaleTime,
    uint16 maxDeviationBps,
    uint192 minAnswer,
    uint192 maxAnswer
  ) external onlyRole(ORACLE_MANAGER_ROLE) {
    if (proxy.code.length == 0) {
      revert ProxyNotContract(proxy);
    }
    if (decimals == 0 || decimals > 24) {
      revert InvalidProxyDecimals(decimals);
    }
    if (maxDeviationBps > MAX_BPS) {
      revert InvalidDeviationSetting();
    }
    if (maxAnswer != 0 && minAnswer > maxAnswer) {
      revert InvalidAnswerBounds(minAnswer, maxAnswer);
    }

    ProxyConfig storage config = _proxyConfigs[asset];
    config.proxy = proxy;
    config.decimals = decimals;
    config.decimalsFactor = 10 ** uint256(decimals);
    config.heartbeat = heartbeat;
    config.maxStaleTime = maxStaleTime;
    config.maxDeviationBps = maxDeviationBps;
    config.minAnswer = minAnswer;
    config.maxAnswer = maxAnswer;
    config.exists = true;
    config.lastGoodPrice = PriceData({ price: 0, updatedAt: 0, isAlive: false });

    emit ProxyConfigured(asset, proxy, decimals, heartbeat, maxStaleTime, maxDeviationBps, minAnswer, maxAnswer);
  }

  function removeProxy(address asset) external onlyRole(ORACLE_MANAGER_ROLE) {
    ProxyConfig storage config = _proxyConfigs[asset];
    if (!config.exists) {
      revert ProxyNotConfigured(asset);
    }
    address previousProxy = config.proxy;
    delete _proxyConfigs[asset];
    emit ProxyRemoved(asset, previousProxy);
  }

  function updateProxyHeartbeat(address asset, uint64 newHeartbeat) external onlyRole(ORACLE_MANAGER_ROLE) {
    ProxyConfig storage config = _proxyConfigs[asset];
    if (!config.exists) {
      revert ProxyNotConfigured(asset);
    }
    uint64 previous = config.heartbeat;
    config.heartbeat = newHeartbeat;
    emit ProxyHeartbeatUpdated(asset, previous, newHeartbeat);
  }

  function updateProxyBounds(address asset, uint192 minAnswer, uint192 maxAnswer) external onlyRole(ORACLE_MANAGER_ROLE) {
    ProxyConfig storage config = _proxyConfigs[asset];
    if (!config.exists) {
      revert ProxyNotConfigured(asset);
    }
    config.minAnswer = minAnswer;
    config.maxAnswer = maxAnswer;
    emit ProxyBoundsUpdated(asset, minAnswer, maxAnswer);
  }

  function updateProxyDeviation(address asset, uint16 newDeviationBps) external onlyRole(ORACLE_MANAGER_ROLE) {
    if (newDeviationBps > MAX_BPS) {
      revert InvalidDeviationSetting();
    }
    ProxyConfig storage config = _proxyConfigs[asset];
    if (!config.exists) {
      revert ProxyNotConfigured(asset);
    }
    uint16 previous = config.maxDeviationBps;
    config.maxDeviationBps = newDeviationBps;
    emit ProxyDeviationUpdated(asset, previous, newDeviationBps);
  }

  function recordLastGoodPrice(address asset) external onlyRole(ORACLE_MANAGER_ROLE) returns (PriceData memory) {
    PriceData memory data = getPriceInfo(asset);
    if (!data.isAlive) {
      revert ProxyPriceNotAlive(asset);
    }
    ProxyConfig storage config = _proxyConfigs[asset];
    config.lastGoodPrice = data;
    emit ProxyObservationRecorded(asset, data.price, data.updatedAt);
    return data;
  }

  function getAssetPrice(address asset) external view override returns (uint256) {
    PriceData memory data = getPriceInfo(asset);
    if (!data.isAlive) {
      revert ProxyPriceNotAlive(asset);
    }
    return data.price;
  }

  function getPriceInfo(address asset) public view override returns (PriceData memory) {
    ProxyConfig storage config = _proxyConfigs[asset];
    if (!config.exists) {
      revert ProxyNotConfigured(asset);
    }

    (int224 rawValue, uint256 timestamp) = IApi3Proxy(config.proxy).read();
    PriceData memory data;
    bool alive = true;

    if (rawValue <= 0) {
      alive = false;
    }
    if (timestamp == 0 || timestamp > block.timestamp) {
      alive = false;
    }

    uint64 updatedAt = timestamp.toUint64();
    uint256 normalizedPrice = 0;

    if (alive) {
      uint256 magnitude = uint256(int256(rawValue));
      uint256 decimalsFactor = config.decimalsFactor;
      normalizedPrice = Math.mulDiv(magnitude, BASE_CURRENCY_UNIT(), decimalsFactor);

      if (config.minAnswer != 0 && normalizedPrice < config.minAnswer) {
        alive = false;
      }
      if (config.maxAnswer != 0 && normalizedPrice > config.maxAnswer) {
        alive = false;
      }

      uint64 heartbeat = config.heartbeat == 0 ? DEFAULT_HEARTBEAT : config.heartbeat;
      uint64 staleLimit = config.maxStaleTime == 0 ? DEFAULT_MAX_STALE_TIME : config.maxStaleTime;
      if (block.timestamp - updatedAt > heartbeat + staleLimit) {
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
      normalizedPrice = rawValue > 0 ? Math.mulDiv(uint256(int256(rawValue)), BASE_CURRENCY_UNIT(), config.decimalsFactor) : 0;
    }

    if (normalizedPrice > type(uint192).max) {
      alive = false;
    }

    data.price = normalizedPrice.toUint192();
    data.updatedAt = updatedAt;
    data.isAlive = alive;
    return data;
  }

  function proxyConfig(address asset) external view returns (ProxyConfig memory) {
    return _proxyConfigs[asset];
  }

  function BASE_CURRENCY() public view override(OracleBaseV1_1, IOracleWrapperV1_1) returns (address) {
    return OracleBaseV1_1.BASE_CURRENCY();
  }

  function BASE_CURRENCY_UNIT() public view override(OracleBaseV1_1, IOracleWrapperV1_1) returns (uint256) {
    return OracleBaseV1_1.BASE_CURRENCY_UNIT();
  }
}
