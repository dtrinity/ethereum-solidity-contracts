// SPDX-License-Identifier: MIT
pragma solidity ^0.8.20;

import { IERC20 } from "@openzeppelin/contracts/token/ERC20/IERC20.sol";
import { SafeERC20 } from "@openzeppelin/contracts/token/ERC20/utils/SafeERC20.sol";
import { Math } from "@openzeppelin/contracts/utils/math/Math.sol";

import { IDStableConversionAdapterV2 } from "vaults/dstake/interfaces/IDStableConversionAdapterV2.sol";
import { IMintableERC20 } from "common/IMintableERC20.sol";

import { StrategyShare } from "./InvariantStableAdapter.sol";

/// @notice Adapter used in invariants that maintains a floating share price by holding raw dStable reserves.
/// @dev Share price is inferred from on-hand reserves and share supply; additional helpers allow the harness
///      to inject yield or realize losses without touching the router.
contract InvariantDynamicStrategyAdapter is IDStableConversionAdapterV2 {
    using SafeERC20 for IERC20;

    error NotOwner();
    error ZeroSharesMinted();
    error SharePriceOutOfBounds(uint256 priceRay);

    uint256 private constant PRICE_SCALE = 1e18;
    uint256 private constant MIN_PRICE_RAY = 5e17; // 0.5 dStable per share
    uint256 private constant MAX_PRICE_RAY = 2e18; // 2 dStable per share

    IERC20 public immutable dStable;
    IMintableERC20 private immutable _mintableStable;
    address public immutable collateralVault;
    StrategyShare public immutable strategyShareToken;

    address public owner;

    constructor(address stable, address vault) {
        dStable = IERC20(stable);
        _mintableStable = IMintableERC20(stable);
        collateralVault = vault;
        strategyShareToken = new StrategyShare();
        owner = msg.sender;
    }

    modifier onlyOwner() {
        if (msg.sender != owner) revert NotOwner();
        _;
    }

    function setOwner(address newOwner) external onlyOwner {
        owner = newOwner;
    }

    function depositIntoStrategy(
        uint256 stableAmount
    ) external override returns (address strategyShareAddr, uint256 strategyShareAmount) {
        dStable.safeTransferFrom(msg.sender, address(this), stableAmount);

        uint256 priceRay = _sharePriceRay();
        strategyShareAmount = Math.mulDiv(stableAmount, PRICE_SCALE, priceRay);
        if (strategyShareAmount == 0) revert ZeroSharesMinted();

        strategyShareToken.mint(collateralVault, strategyShareAmount);
        return (address(strategyShareToken), strategyShareAmount);
    }

    function withdrawFromStrategy(uint256 strategyShareAmount) external override returns (uint256 stableAmount) {
        uint256 priceRay = _sharePriceRay();

        strategyShareToken.transferFrom(msg.sender, address(this), strategyShareAmount);
        strategyShareToken.burn(strategyShareAmount);

        stableAmount = Math.mulDiv(strategyShareAmount, priceRay, PRICE_SCALE);
        uint256 reserves = dStable.balanceOf(address(this));
        if (stableAmount > reserves) {
            stableAmount = reserves;
        }
        dStable.safeTransfer(msg.sender, stableAmount);
    }

    function previewDepositIntoStrategy(
        uint256 stableAmount
    ) external view override returns (address strategyShareAddr, uint256 strategyShareAmount) {
        uint256 priceRay = _sharePriceRay();
        strategyShareAmount = Math.mulDiv(stableAmount, PRICE_SCALE, priceRay);
        return (address(strategyShareToken), strategyShareAmount);
    }

    function previewWithdrawFromStrategy(
        uint256 strategyShareAmount
    ) external view override returns (uint256 stableAmount) {
        uint256 priceRay = _sharePriceRay();
        return Math.mulDiv(strategyShareAmount, priceRay, PRICE_SCALE);
    }

    function strategyShareValueInDStable(
        address strategyShareAddr,
        uint256 strategyShareAmount
    ) external view override returns (uint256 stableValue) {
        require(strategyShareAddr == address(strategyShareToken), "InvariantAdapter: wrong share");
        uint256 priceRay = _sharePriceRay();
        return Math.mulDiv(strategyShareAmount, priceRay, PRICE_SCALE);
    }

    function strategyShare() external view override returns (address) {
        return address(strategyShareToken);
    }

    function vaultAsset() external view override returns (address) {
        return address(strategyShareToken);
    }

    /// @notice Apply a signed NAV delta to emulate external strategy gains or losses.
    /// @dev Positive deltas pull freshly minted dStable from the owner; negative deltas burn on-hand reserves.
    function adjustReserves(int256 delta) external onlyOwner returns (uint256 newSharePriceRay) {
        if (delta > 0) {
            uint256 amount = uint256(delta);
            dStable.safeTransferFrom(msg.sender, address(this), amount);
        } else if (delta < 0) {
            uint256 amount = uint256(-delta);
            uint256 reserves = dStable.balanceOf(address(this));
            if (amount > reserves) {
                amount = reserves;
            }
            _mintableStable.burn(amount);
        }

        newSharePriceRay = _sharePriceRay();
        if (newSharePriceRay < MIN_PRICE_RAY || newSharePriceRay > MAX_PRICE_RAY) {
            revert SharePriceOutOfBounds(newSharePriceRay);
        }
    }

    function sharePriceRay() external view returns (uint256) {
        return _sharePriceRay();
    }

    function _sharePriceRay() internal view returns (uint256) {
        uint256 supply = strategyShareToken.totalSupply();
        if (supply == 0) {
            return PRICE_SCALE;
        }
        uint256 reserves = dStable.balanceOf(address(this));
        if (reserves == 0) {
            return 0;
        }
        return Math.mulDiv(reserves, PRICE_SCALE, supply);
    }
}
