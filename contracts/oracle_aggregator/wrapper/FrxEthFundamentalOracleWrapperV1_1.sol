// SPDX-License-Identifier: MIT
pragma solidity ^0.8.20;

import "../interface/IOracleWrapperV1_1.sol";
import "@openzeppelin/contracts/access/AccessControl.sol";

/**
 * @title FrxEthFundamentalOracleWrapperV1_1
 * @notice Fundamental frxETH/ETH oracle using EtherRouter consolidated balances and RedemptionQueue fee.
 * @dev Returns ETH per frxETH scaled to BASE_CURRENCY_UNIT. Defensive: returns (0,false) on any upstream read failure.
 */
contract FrxEthFundamentalOracleWrapperV1_1 is IOracleWrapperV1_1, AccessControl {
    /* Roles */
    bytes32 public constant ORACLE_MANAGER_ROLE = keccak256("ORACLE_MANAGER_ROLE");

    /* Constants */
    uint256 private constant FEE_PRECISION = 1e6;

    /* Immutables */
    address public immutable BASE_CURRENCY;
    uint256 public immutable BASE_CURRENCY_UNIT;
    IERC20SupplyLike public immutable frxEth;
    IEtherRouterLike public immutable etherRouter;
    IRedemptionQueueV2Like public immutable redemptionQueue;
    // If true, forces EtherRouter to recompute balances (can be expensive). Defaults to true.
    bool public forceLive;

    /* Errors */
    error UnsupportedAsset(address asset);
    error PriceIsStale();
    error InvalidBaseCurrencyUnit(uint256 unit);

    constructor(
        address baseCurrency,
        uint256 baseCurrencyUnit,
        address frxEth_,
        address etherRouter_,
        address redemptionQueue_
    ) {
        if (baseCurrencyUnit == 0) {
            revert InvalidBaseCurrencyUnit(baseCurrencyUnit);
        }

        BASE_CURRENCY = baseCurrency;
        BASE_CURRENCY_UNIT = baseCurrencyUnit;
        frxEth = IERC20SupplyLike(frxEth_);
        etherRouter = IEtherRouterLike(etherRouter_);
        redemptionQueue = IRedemptionQueueV2Like(redemptionQueue_);
        forceLive = true;

        _grantRole(DEFAULT_ADMIN_ROLE, msg.sender);
        _grantRole(ORACLE_MANAGER_ROLE, msg.sender);
    }

    /* ========== Admin ========== */

    function setForceLive(bool forceLive_) external onlyRole(ORACLE_MANAGER_ROLE) {
        forceLive = forceLive_;
    }

    /* ========== Views ========== */

    function getPriceInfo(address asset) public view override returns (uint256 price, bool isAlive) {
        if (asset != address(frxEth)) {
            revert UnsupportedAsset(asset);
        }

        uint256 supply;
        try frxEth.totalSupply() returns (uint256 s) {
            supply = s;
        } catch {
            return (0, false);
        }
        if (supply == 0) {
            return (0, false);
        }

        uint256 backingEth;
        try etherRouter.getConsolidatedEthFrxEthBalanceView(forceLive) returns (
            IEtherRouterLike.CachedConsEFxBalances memory balances
        ) {
            if (balances.isStale) {
                return (0, false);
            }
            backingEth = uint256(balances.ethTotalBalanced);
        } catch {
            return (0, false);
        }

        uint64 redemptionFee;
        try redemptionQueue.redemptionQueueState() returns (uint64, uint64, uint64 redemptionFeeE6, uint120, uint120) {
            redemptionFee = redemptionFeeE6;
        } catch {
            return (0, false);
        }

        if (redemptionFee >= FEE_PRECISION) {
            return (0, false);
        }

        uint256 baseUnit = BASE_CURRENCY_UNIT;
        uint256 nav = (backingEth * baseUnit) / supply;
        uint256 redemptionRate = (baseUnit * (FEE_PRECISION - uint256(redemptionFee))) / FEE_PRECISION;

        uint256 min1 = nav < baseUnit ? nav : baseUnit;
        price = min1 < redemptionRate ? min1 : redemptionRate;
        isAlive = price > 0;
    }

    function getAssetPrice(address asset) external view override returns (uint256) {
        (uint256 price, bool alive) = getPriceInfo(asset);
        if (!alive) revert PriceIsStale();
        return price;
    }
}

/* ========== Minimal interfaces (scoped locally) ========== */

interface IERC20SupplyLike {
    function totalSupply() external view returns (uint256);
}

interface IEtherRouterLike {
    struct CachedConsEFxBalances {
        bool isStale;
        address amoAddress;
        uint96 ethFree;
        uint96 ethInLpBalanced;
        uint96 ethTotalBalanced;
        uint96 frxEthFree;
        uint96 frxEthInLpBalanced;
    }

    function getConsolidatedEthFrxEthBalanceView(bool forceLive) external view returns (CachedConsEFxBalances memory);
}

interface IRedemptionQueueV2Like {
    function redemptionQueueState()
        external
        view
        returns (
            uint64 nextNftId,
            uint64 queueLengthSecs,
            uint64 redemptionFee,
            uint120 ttlEthRequested,
            uint120 ttlEthServed
        );
}
