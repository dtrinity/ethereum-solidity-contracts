// SPDX-License-Identifier: MIT
pragma solidity ^0.8.20;

import { OracleBaseV1_1 } from "./OracleBaseV1_1.sol";
import { IOracleWrapperV1_1 } from "./interface/IOracleWrapperV1_1.sol";
import { SafeCast } from "@openzeppelin/contracts/utils/math/SafeCast.sol";
import { Math } from "@openzeppelin/contracts/utils/math/Math.sol";

/**
 * @title OracleAggregatorV1_1
 * @notice Safety focused oracle aggregator coordinating multiple provider wrappers with
 *         guardian driven circuit breakers and per-asset risk controls.
 */
contract OracleAggregatorV1_1 is OracleBaseV1_1, IOracleWrapperV1_1 {
    using SafeCast for uint256;

    uint16 public constant MAX_BPS = 10_000;

    enum PriceResolution {
        NONE,
        PRIMARY,
        FALLBACK,
        LAST_GOOD
    }

    struct AggregatorAssetConfig {
        address oracle;
        address fallbackOracle;
        AssetConfig risk;
        bool isFrozen;
        PriceData lastGoodPrice;
    }

    uint64 public immutable globalMaxStaleTime;

    mapping(address => AggregatorAssetConfig) private _assetConfigs;

    address private _pendingAdmin;
    address private _handoverInitiator;

    event AdminHandoverStarted(address indexed currentAdmin, address indexed pendingAdmin);
    event AdminHandoverAccepted(address indexed previousAdmin, address indexed newAdmin);

    event OracleAdded(address indexed asset, address indexed oracle);
    event OracleReplaced(address indexed asset, address indexed previousOracle, address indexed newOracle);
    event OracleRemoved(address indexed asset, address indexed previousOracle);
    event FallbackOracleUpdated(address indexed asset, address indexed previousFallback, address indexed newFallback);

    event AssetConfigUpdated(
        address indexed asset,
        uint64 maxStaleTime,
        uint64 heartbeat,
        uint16 maxDeviationBps,
        uint192 minAnswer,
        uint192 maxAnswer
    );

    event AssetFrozen(address indexed asset, uint192 price, uint64 updatedAt);
    event AssetUnfrozen(address indexed asset);
    event FrozenPricePushed(address indexed asset, uint192 price, uint64 updatedAt);

    event LastGoodPriceStored(address indexed asset, uint192 price, uint64 updatedAt, PriceResolution resolution);

    event AssetPaused(address indexed asset);
    event AssetUnpaused(address indexed asset);

    error PendingAdminAlreadySet();
    error NoPendingAdmin();
    error OnlyPendingAdmin();
    error AdminArrayEmpty();
    error OracleBaseCurrencyMismatch(address oracle, address expected, address actual);
    error OracleBaseUnitMismatch(address oracle, uint256 expected, uint256 actual);
    error PriceNotAlive(address asset);
    error NoValidPrice(address asset);
    error AssetFrozenError(address asset);
    error AssetNotFrozen(address asset);
    error LastGoodPriceUnset(address asset);
    error InvalidAnswerBounds();
    error InvalidDeviationThreshold();
    error FallbackMatchesPrimary(address asset, address oracle);

    constructor(
        address baseCurrency,
        uint256 baseCurrencyUnit,
        address[] memory admins,
        address[] memory oracleManagers,
        address[] memory guardians,
        uint64 maxStaleTimeDefault
    ) OracleBaseV1_1(baseCurrency, baseCurrencyUnit, _requireAdmin(admins)) {
        globalMaxStaleTime = maxStaleTimeDefault == 0 ? DEFAULT_MAX_STALE_TIME : maxStaleTimeDefault;

        _seedRoleGrants(admins, oracleManagers, guardians);
    }

    /* ---------------------------------- Admin --------------------------------- */

    function beginAdminHandover(address newAdmin) external onlyRole(ADMIN_ROLE) {
        if (newAdmin == address(0)) {
            revert ZeroAddress("newAdmin");
        }
        if (_pendingAdmin != address(0)) {
            revert PendingAdminAlreadySet();
        }
        _pendingAdmin = newAdmin;
        _handoverInitiator = msg.sender;
        emit AdminHandoverStarted(msg.sender, newAdmin);
    }

    function acceptAdminHandover() external {
        address pending = _pendingAdmin;
        if (pending == address(0)) {
            revert NoPendingAdmin();
        }
        if (pending != msg.sender) {
            revert OnlyPendingAdmin();
        }

        address previousAdmin = _handoverInitiator;

        _grantRole(DEFAULT_ADMIN_ROLE, pending);
        _grantRole(ADMIN_ROLE, pending);

        _pendingAdmin = address(0);
        _handoverInitiator = address(0);

        emit AdminHandoverAccepted(previousAdmin, pending);
    }

    function cancelAdminHandover() external onlyRole(ADMIN_ROLE) {
        if (_pendingAdmin == address(0)) {
            revert NoPendingAdmin();
        }
        _pendingAdmin = address(0);
        _handoverInitiator = address(0);
    }

    function pendingAdmin() external view returns (address) {
        return _pendingAdmin;
    }

    /* ------------------------------- Configuration ---------------------------- */

    function setOracle(address asset, address oracle) external onlyRole(ORACLE_MANAGER_ROLE) {
        _setOracle(asset, oracle);
    }

    function setFallbackOracle(address asset, address fallbackOracle) external onlyRole(ORACLE_MANAGER_ROLE) {
        _configureFallbackOracle(asset, fallbackOracle);
    }

    function updateAssetRiskConfig(
        address asset,
        uint64 maxStaleTime,
        uint64 heartbeatOverride,
        uint16 maxDeviationBps,
        uint192 minAnswer,
        uint192 maxAnswer
    ) external onlyRole(ORACLE_MANAGER_ROLE) {
        _configureRisk(asset, maxStaleTime, heartbeatOverride, maxDeviationBps, minAnswer, maxAnswer);
    }

    function configureAsset(
        address asset,
        address oracle,
        address fallbackOracle,
        uint64 maxStaleTime,
        uint64 heartbeatOverride,
        uint16 maxDeviationBps,
        uint192 minAnswer,
        uint192 maxAnswer
    ) external onlyRole(ORACLE_MANAGER_ROLE) {
        _setOracle(asset, oracle);
        _configureFallbackOracle(asset, fallbackOracle);
        _configureRisk(asset, maxStaleTime, heartbeatOverride, maxDeviationBps, minAnswer, maxAnswer);
    }

    function removeAsset(address asset) external onlyRole(ORACLE_MANAGER_ROLE) {
        AggregatorAssetConfig storage config = _assetConfigs[asset];
        if (!config.risk.exists) {
            revert AssetNotConfigured(asset);
        }
        address previousOracle = config.oracle;

        delete _assetConfigs[asset];

        emit OracleRemoved(asset, previousOracle);
    }

    function pauseAsset(address asset) external onlyRole(GUARDIAN_ROLE) {
        AggregatorAssetConfig storage config = _assetConfigs[asset];
        if (!config.risk.exists) {
            revert AssetNotConfigured(asset);
        }
        if (config.isFrozen) {
            revert AssetFrozenError(asset);
        }
        if (config.lastGoodPrice.updatedAt == 0) {
            revert LastGoodPriceUnset(asset);
        }

        config.isFrozen = true;
        emit AssetPaused(asset);
        emit AssetFrozen(asset, config.lastGoodPrice.price, config.lastGoodPrice.updatedAt);
    }

    function unpauseAsset(address asset) external onlyRole(GUARDIAN_ROLE) {
        AggregatorAssetConfig storage config = _assetConfigs[asset];
        if (!config.risk.exists) {
            revert AssetNotConfigured(asset);
        }
        if (!config.isFrozen) {
            revert AssetNotFrozen(asset);
        }

        config.isFrozen = false;
        emit AssetUnpaused(asset);
        emit AssetUnfrozen(asset);
    }

    function pushFrozenPrice(address asset, uint192 price, uint64 updatedAt) external onlyRole(GUARDIAN_ROLE) {
        AggregatorAssetConfig storage config = _assetConfigs[asset];
        if (!config.risk.exists) {
            revert AssetNotConfigured(asset);
        }
        if (!config.isFrozen) {
            revert AssetNotFrozen(asset);
        }
        if (updatedAt == 0 || updatedAt > block.timestamp) {
            revert TimestampInFuture(asset, updatedAt, uint64(block.timestamp));
        }

        config.lastGoodPrice = PriceData({ price: price, updatedAt: updatedAt, isAlive: false });

        emit FrozenPricePushed(asset, price, updatedAt);
    }

    function updateLastGoodPrice(address asset) external onlyRole(ORACLE_MANAGER_ROLE) returns (PriceData memory) {
        AggregatorAssetConfig storage config = _assetConfigs[asset];
        if (!config.risk.exists) {
            revert AssetNotConfigured(asset);
        }
        if (config.isFrozen) {
            revert AssetFrozenError(asset);
        }
        (PriceData memory data, PriceResolution resolution) = _evaluatePrice(asset, config);
        if (resolution != PriceResolution.PRIMARY && resolution != PriceResolution.FALLBACK) {
            revert NoValidPrice(asset);
        }

        config.lastGoodPrice = data;
        emit LastGoodPriceStored(asset, data.price, data.updatedAt, resolution);
        return data;
    }

    /* --------------------------------- Views ---------------------------------- */

    function getAssetPrice(address asset) external view override returns (uint256) {
        PriceData memory data = getPriceInfo(asset);
        if (!data.isAlive) {
            revert PriceNotAlive(asset);
        }
        return data.price;
    }

    function getPriceInfo(address asset) public view override returns (PriceData memory) {
        AggregatorAssetConfig storage config = _assetConfigs[asset];
        if (!config.risk.exists) {
            if (_isBaseAsset(asset)) {
                return _baseCurrencyPriceData();
            }
            revert AssetNotConfigured(asset);
        }

        if (config.isFrozen) {
            PriceData memory frozen = config.lastGoodPrice;
            frozen.isAlive = false;
            return frozen;
        }

        (PriceData memory data, PriceResolution resolution) = _evaluatePrice(asset, config);
        if (resolution == PriceResolution.NONE) {
            revert NoValidPrice(asset);
        }

        if (resolution == PriceResolution.LAST_GOOD) {
            PriceData memory lgp = config.lastGoodPrice;
            lgp.isAlive = false;
            return lgp;
        }

        return data;
    }

    function batchRefresh(
        address[] calldata assets
    ) external view returns (PriceData[] memory prices, bool[] memory isFrozen, bool[] memory usedFallback) {
        uint256 length = assets.length;
        prices = new PriceData[](length);
        isFrozen = new bool[](length);
        usedFallback = new bool[](length);

        for (uint256 i = 0; i < length; ++i) {
            address asset = assets[i];
            AggregatorAssetConfig storage config = _assetConfigs[asset];
            if (!config.risk.exists) {
                if (_isBaseAsset(asset)) {
                    prices[i] = _baseCurrencyPriceData();
                }
                continue;
            }

            isFrozen[i] = config.isFrozen;
            if (config.isFrozen) {
                PriceData memory frozen = config.lastGoodPrice;
                frozen.isAlive = false;
                prices[i] = frozen;
                continue;
            }

            (PriceData memory data, PriceResolution resolution) = _evaluatePrice(asset, config);
            if (resolution == PriceResolution.PRIMARY || resolution == PriceResolution.FALLBACK) {
                prices[i] = data;
                usedFallback[i] = resolution == PriceResolution.FALLBACK;
            } else if (resolution == PriceResolution.LAST_GOOD) {
                PriceData memory lgp = config.lastGoodPrice;
                lgp.isAlive = false;
                prices[i] = lgp;
            }
        }
    }

    function getAssetConfig(address asset) external view returns (AggregatorAssetConfig memory) {
        return _assetConfigs[asset];
    }

    function BASE_CURRENCY() public view override(OracleBaseV1_1, IOracleWrapperV1_1) returns (address) {
        return OracleBaseV1_1.BASE_CURRENCY();
    }

    function BASE_CURRENCY_UNIT() public view override(OracleBaseV1_1, IOracleWrapperV1_1) returns (uint256) {
        return OracleBaseV1_1.BASE_CURRENCY_UNIT();
    }

    /* -------------------------------- Internal -------------------------------- */

    function _setOracle(address asset, address oracle) private {
        _assertContractAddress(oracle, "oracle");
        _validateOracleCompatibility(oracle);

        AggregatorAssetConfig storage config = _assetConfigs[asset];
        address previousOracle = config.oracle;
        bool previouslyConfigured = config.risk.exists;

        if (config.fallbackOracle != address(0) && config.fallbackOracle == oracle) {
            revert FallbackMatchesPrimary(asset, oracle);
        }

        config.oracle = oracle;
        config.risk.exists = true;

        if (!previouslyConfigured || previousOracle == address(0)) {
            emit OracleAdded(asset, oracle);
        } else if (previousOracle != oracle) {
            emit OracleReplaced(asset, previousOracle, oracle);
            config.lastGoodPrice = PriceData({ price: 0, updatedAt: 0, isAlive: false });
        }
    }

    function _configureFallbackOracle(address asset, address fallbackOracle) private {
        AggregatorAssetConfig storage config = _assetConfigs[asset];
        if (!config.risk.exists) {
            revert AssetNotConfigured(asset);
        }

        if (fallbackOracle != address(0)) {
            _assertContractAddress(fallbackOracle, "fallbackOracle");
            _validateOracleCompatibility(fallbackOracle);
            if (config.oracle == fallbackOracle) {
                revert FallbackMatchesPrimary(asset, fallbackOracle);
            }
        }

        address previousFallback = config.fallbackOracle;
        if (previousFallback != fallbackOracle) {
            config.fallbackOracle = fallbackOracle;
            emit FallbackOracleUpdated(asset, previousFallback, fallbackOracle);
        }
    }

    function _configureRisk(
        address asset,
        uint64 maxStaleTime,
        uint64 heartbeatOverride,
        uint16 maxDeviationBps,
        uint192 minAnswer,
        uint192 maxAnswer
    ) private {
        AggregatorAssetConfig storage config = _assetConfigs[asset];
        if (!config.risk.exists) {
            revert AssetNotConfigured(asset);
        }

        if (maxDeviationBps > MAX_BPS) {
            revert InvalidDeviationThreshold();
        }
        if (maxAnswer != 0 && minAnswer > maxAnswer) {
            revert InvalidAnswerBounds();
        }
        heartbeatOverride = _requireConfiguredHeartbeat(heartbeatOverride);

        config.risk.maxStaleTime = maxStaleTime;
        config.risk.heartbeat = heartbeatOverride;
        config.risk.maxDeviationBps = maxDeviationBps;
        config.risk.minAnswer = minAnswer;
        config.risk.maxAnswer = maxAnswer;

        emit AssetConfigUpdated(asset, maxStaleTime, heartbeatOverride, maxDeviationBps, minAnswer, maxAnswer);
    }

    function _evaluatePrice(
        address asset,
        AggregatorAssetConfig storage config
    ) internal view returns (PriceData memory data, PriceResolution resolution) {
        if (config.isFrozen) {
            return (config.lastGoodPrice, PriceResolution.LAST_GOOD);
        }

        (PriceData memory primaryData, bool primaryOk) = _pullPrice(config.oracle, asset);
        if (primaryOk) {
            if (_isUsablePrice(config, primaryData)) {
                return (primaryData, PriceResolution.PRIMARY);
            }
        }

        if (config.fallbackOracle != address(0)) {
            (PriceData memory fallbackData, bool fallbackOk) = _pullPrice(config.fallbackOracle, asset);
            if (fallbackOk) {
                if (_isUsablePrice(config, fallbackData)) {
                    return (fallbackData, PriceResolution.FALLBACK);
                }
            }
        }

        if (config.lastGoodPrice.updatedAt != 0) {
            return (config.lastGoodPrice, PriceResolution.LAST_GOOD);
        }

        return (PriceData({ price: 0, updatedAt: 0, isAlive: false }), PriceResolution.NONE);
    }

    function _pullPrice(address oracle, address asset) private view returns (PriceData memory data, bool success) {
        if (oracle == address(0)) {
            return (data, false);
        }
        try IOracleWrapperV1_1(oracle).getPriceInfo(asset) returns (PriceData memory fetched) {
            data = fetched;
            success = true;
        } catch {
            success = false;
        }
    }

    function _isUsablePrice(AggregatorAssetConfig storage config, PriceData memory data) private view returns (bool) {
        if (!data.isAlive || data.price == 0 || data.updatedAt == 0) {
            return false;
        }

        if (data.updatedAt > block.timestamp) {
            return false;
        }

        uint64 staleThreshold = config.risk.maxStaleTime == 0 ? globalMaxStaleTime : config.risk.maxStaleTime;
        uint64 heartbeat = _requireConfiguredHeartbeat(config.risk.heartbeat);

        if (block.timestamp - data.updatedAt > staleThreshold + heartbeat) {
            return false;
        }

        if (config.risk.minAnswer != 0 && data.price < config.risk.minAnswer) {
            return false;
        }
        if (config.risk.maxAnswer != 0 && data.price > config.risk.maxAnswer) {
            return false;
        }

        if (config.risk.maxDeviationBps != 0 && config.lastGoodPrice.price != 0) {
            uint256 difference = data.price > config.lastGoodPrice.price
                ? data.price - config.lastGoodPrice.price
                : config.lastGoodPrice.price - data.price;
            uint256 deviationBps = Math.mulDiv(difference, MAX_BPS, config.lastGoodPrice.price);
            if (deviationBps > config.risk.maxDeviationBps) {
                return false;
            }
        }

        return true;
    }

    function _isBaseAsset(address asset) private view returns (bool) {
        return asset == BASE_CURRENCY();
    }

    function _baseCurrencyPriceData() private view returns (PriceData memory) {
        return
            PriceData({ price: BASE_CURRENCY_UNIT().toUint192(), updatedAt: uint64(block.timestamp), isAlive: true });
    }

    function _validateOracleCompatibility(address oracle) private view {
        address oracleBaseCurrency = IOracleWrapperV1_1(oracle).BASE_CURRENCY();
        uint256 oracleBaseUnit = IOracleWrapperV1_1(oracle).BASE_CURRENCY_UNIT();
        if (oracleBaseCurrency != BASE_CURRENCY()) {
            revert OracleBaseCurrencyMismatch(oracle, BASE_CURRENCY(), oracleBaseCurrency);
        }
        if (oracleBaseUnit != BASE_CURRENCY_UNIT()) {
            revert OracleBaseUnitMismatch(oracle, BASE_CURRENCY_UNIT(), oracleBaseUnit);
        }
    }

    function _seedRoleGrants(
        address[] memory admins,
        address[] memory oracleManagers,
        address[] memory guardians
    ) private {
        for (uint256 i = 0; i < admins.length; ++i) {
            if (admins[i] == address(0)) {
                revert ZeroAddress("admin");
            }
            _grantRole(DEFAULT_ADMIN_ROLE, admins[i]);
            _grantRole(ADMIN_ROLE, admins[i]);
        }
        for (uint256 i = 0; i < oracleManagers.length; ++i) {
            if (oracleManagers[i] == address(0)) {
                revert ZeroAddress("oracleManager");
            }
            _grantRole(ORACLE_MANAGER_ROLE, oracleManagers[i]);
        }
        for (uint256 i = 0; i < guardians.length; ++i) {
            if (guardians[i] == address(0)) {
                revert ZeroAddress("guardian");
            }
            _grantRole(GUARDIAN_ROLE, guardians[i]);
        }
    }

    function _requireAdmin(address[] memory admins) private pure returns (address) {
        if (admins.length == 0) {
            revert AdminArrayEmpty();
        }
        return admins[0];
    }
}
