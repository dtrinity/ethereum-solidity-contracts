// SPDX-License-Identifier: MIT
pragma solidity ^0.8.20;

import { IERC20 } from "@openzeppelin/contracts/token/ERC20/IERC20.sol";
import { IERC4626 } from "@openzeppelin/contracts/interfaces/IERC4626.sol";
import { SafeERC20 } from "@openzeppelin/contracts/token/ERC20/utils/SafeERC20.sol";
import { IDStableConversionAdapterV2 } from "../interfaces/IDStableConversionAdapterV2.sol";
import { IDStakeCollateralVaultV2 } from "../interfaces/IDStakeCollateralVaultV2.sol";

/**
 * @notice Value-conservation checks shared by ALL router strategy movements.
 * @dev A preview/share-count match is not evidence of sufficient backing. Measure
 *      the change in the collateral vault's ENTIRE position, not just new shares.
 *      Both the strategy's redeemable value and the adapter's accounting value
 *      must pass. Neither an adapter return value nor existing router cash can
 *      substitute for actual assets received on withdrawal.
 *
 *      Trust boundary: these checks still require an honest, reviewed strategy
 *      valuation implementation. They are not an oracle for a malicious vault,
 *      a guarantee of immediate liquidity, or a cure for external NAV manipulation.
 *      The default is ONE smallest underlying-token unit. Explicit strategy and
 *      operation policies may allow up to SIXTEEN units, never basis points, and
 *      deliberately independent of configurable dustTolerance or share prices.
 */
library StrategyBackingGuard {
    using SafeERC20 for IERC20;

    uint256 internal constant MAX_ROUNDING_LOSS = 1;
    uint256 internal constant HARD_ROUNDING_LOSS_LIMIT = 16;

    error InvalidRoundingLoss(uint256 allowedLoss);

    error StrategyBackingLoss(
        address vault,
        uint8 measure,
        uint256 beforeValue,
        uint256 afterValue,
        uint256 requiredIncrease
    );
    error StrategyWithdrawalLoss(address vault, uint8 measure, uint256 valueLost, uint256 assetsReceived);
    error AssetBalanceMismatch(uint256 expected, uint256 actual);
    error WithdrawalAssetsMismatch(uint256 reported, uint256 actual);
    error AdapterAssetMismatch(address adapter, address expectedAsset, address actualAsset);
    error AdapterSharesMismatch(uint256 actualShares, uint256 reportedShares);
    error SlippageCheckFailed(address asset, uint256 actualAmount, uint256 requiredAmount);
    error ZeroWithdrawalAssets();

    struct Position {
        uint256 cash;
        uint256 shares;
        uint256 redeemable;
        uint256 reported;
    }

    function position(
        address asset,
        address vault,
        address adapter,
        address collateral
    ) internal view returns (Position memory p) {
        p.cash = IERC20(asset).balanceOf(address(this));
        p.shares = IERC20(vault).balanceOf(collateral);
        if (p.shares != 0) {
            p.redeemable = IERC4626(vault).previewRedeem(p.shares);
            p.reported = IDStableConversionAdapterV2(adapter).strategyShareValueInDStable(vault, p.shares);
        }
    }

    function deposit(
        address asset,
        address vault,
        address adapterAddress,
        IDStakeCollateralVaultV2 collateral,
        uint256 assets
    ) internal returns (uint256 actualShares) {
        return deposit(asset, vault, adapterAddress, collateral, assets, MAX_ROUNDING_LOSS);
    }

    function deposit(
        address asset,
        address vault,
        address adapterAddress,
        IDStakeCollateralVaultV2 collateral,
        uint256 assets,
        uint256 allowedLoss
    ) internal returns (uint256 actualShares) {
        _validateRoundingLoss(allowedLoss);
        Position memory beforePosition = position(asset, vault, adapterAddress, address(collateral));
        IDStableConversionAdapterV2 adapter = IDStableConversionAdapterV2(adapterAddress);
        (address expectedVault, uint256 expectedShares) = adapter.previewDepositIntoStrategy(assets);
        if (expectedVault != vault) revert AdapterAssetMismatch(adapterAddress, vault, expectedVault);

        IERC20(asset).forceApprove(adapterAddress, assets);
        (address actualVault, uint256 reportedShares) = adapter.depositIntoStrategy(assets);
        IERC20(asset).forceApprove(adapterAddress, 0);
        if (actualVault != vault) revert AdapterAssetMismatch(adapterAddress, vault, actualVault);

        Position memory afterPosition = position(asset, vault, adapterAddress, address(collateral));
        actualShares = afterPosition.shares - beforePosition.shares;
        if (actualShares < expectedShares) revert SlippageCheckFailed(vault, actualShares, expectedShares);
        if (actualShares != reportedShares) revert AdapterSharesMismatch(actualShares, reportedShares);

        uint256 spent = beforePosition.cash >= afterPosition.cash ? beforePosition.cash - afterPosition.cash : 0;
        if (spent != assets) revert AssetBalanceMismatch(assets, spent);
        assertIncrease(vault, 0, beforePosition.redeemable, afterPosition.redeemable, assets, allowedLoss);
        assertIncrease(vault, 1, beforePosition.reported, afterPosition.reported, assets, allowedLoss);
        // Intentionally no unconditional actualShares != 0 requirement: existing
        // collateral-owned shares may receive the entire, sufficient NAV increase.
    }

    function withdraw(
        address asset,
        address vault,
        address adapterAddress,
        IDStakeCollateralVaultV2 collateral,
        uint256 shares
    ) internal returns (uint256 received) {
        return withdraw(asset, vault, adapterAddress, collateral, shares, MAX_ROUNDING_LOSS);
    }

    function withdraw(
        address asset,
        address vault,
        address adapterAddress,
        IDStakeCollateralVaultV2 collateral,
        uint256 shares,
        uint256 allowedLoss
    ) internal returns (uint256 received) {
        _validateRoundingLoss(allowedLoss);
        Position memory beforePosition = position(asset, vault, adapterAddress, address(collateral));
        collateral.transferStrategyShares(vault, shares, address(this));
        IERC20(vault).forceApprove(adapterAddress, shares);
        uint256 reported = IDStableConversionAdapterV2(adapterAddress).withdrawFromStrategy(shares);
        IERC20(vault).forceApprove(adapterAddress, 0);
        Position memory afterPosition = position(asset, vault, adapterAddress, address(collateral));

        received = afterPosition.cash >= beforePosition.cash ? afterPosition.cash - beforePosition.cash : 0;
        if (received != reported) revert WithdrawalAssetsMismatch(reported, received);
        if (received == 0) revert ZeroWithdrawalAssets();
        assertWithdrawal(vault, 0, beforePosition.redeemable, afterPosition.redeemable, received, allowedLoss);
        assertWithdrawal(vault, 1, beforePosition.reported, afterPosition.reported, received, allowedLoss);
    }

    function pull(address asset, address from, uint256 assets) internal {
        uint256 beforeBalance = IERC20(asset).balanceOf(address(this));
        IERC20(asset).safeTransferFrom(from, address(this), assets);
        uint256 actual = IERC20(asset).balanceOf(address(this)) - beforeBalance;
        if (actual != assets) revert AssetBalanceMismatch(assets, actual);
    }

    function assertIncrease(
        address vault,
        uint8 measure,
        uint256 beforeValue,
        uint256 afterValue,
        uint256 requiredIncrease
    ) internal pure {
        assertIncrease(vault, measure, beforeValue, afterValue, requiredIncrease, MAX_ROUNDING_LOSS);
    }

    function assertIncrease(
        address vault,
        uint8 measure,
        uint256 beforeValue,
        uint256 afterValue,
        uint256 requiredIncrease,
        uint256 allowedLoss
    ) internal pure {
        _validateRoundingLoss(allowedLoss);
        uint256 increase = afterValue > beforeValue ? afterValue - beforeValue : 0;
        // Never allow a positive nominal credit with NO new backing, including
        // one-unit deposits. Subtraction avoids overflowing afterValue + tolerance.
        if (increase == 0 || (increase < requiredIncrease && requiredIncrease - increase > allowedLoss)) {
            revert StrategyBackingLoss(vault, measure, beforeValue, afterValue, requiredIncrease);
        }
    }

    function assertWithdrawal(
        address vault,
        uint8 measure,
        uint256 beforeValue,
        uint256 afterValue,
        uint256 received
    ) internal pure {
        assertWithdrawal(vault, measure, beforeValue, afterValue, received, MAX_ROUNDING_LOSS);
    }

    function assertWithdrawal(
        address vault,
        uint8 measure,
        uint256 beforeValue,
        uint256 afterValue,
        uint256 received,
        uint256 allowedLoss
    ) internal pure {
        _validateRoundingLoss(allowedLoss);
        uint256 lost = beforeValue > afterValue ? beforeValue - afterValue : 0;
        if (lost > received && lost - received > allowedLoss) {
            revert StrategyWithdrawalLoss(vault, measure, lost, received);
        }
    }

    function _validateRoundingLoss(uint256 allowedLoss) private pure {
        if (allowedLoss > HARD_ROUNDING_LOSS_LIMIT) revert InvalidRoundingLoss(allowedLoss);
    }
}
