// SPDX-License-Identifier: MIT
pragma solidity ^0.8.20;

import { IERC20 } from "@openzeppelin/contracts/token/ERC20/IERC20.sol";
import { SafeERC20 } from "@openzeppelin/contracts/token/ERC20/utils/SafeERC20.sol";
import { IERC4626 } from "@openzeppelin/contracts/interfaces/IERC4626.sol";
import { Math } from "@openzeppelin/contracts/utils/math/Math.sol";

import { BasisPointConstants } from "../../common/BasisPointConstants.sol";
import { IDStableConversionAdapterV2 } from "./interfaces/IDStableConversionAdapterV2.sol";
import { IDStakeCollateralVaultV2 } from "./interfaces/IDStakeCollateralVaultV2.sol";

/**
 * @title DStakeRouterV2RebalanceModule
 * @notice Handles rebalancing flows for {@link DStakeRouterV2} via delegatecall.
 * @dev Storage layout mirrors the router. All functions assume they are executed
 *      through delegatecall from the router, which enforces access control.
 */
contract DStakeRouterV2RebalanceModule {
    using SafeERC20 for IERC20;
    using Math for uint256;

    // --- Errors (mirrors router) ---
    error ZeroAddress();
    error AdapterNotFound(address strategyShare);
    error ZeroPreviewWithdrawAmount(address strategyShare);
    error AdapterAssetMismatch(address adapter, address expectedAsset, address actualAsset);
    error SlippageCheckFailed(address asset, uint256 actualAmount, uint256 requiredAmount);
    error ZeroInputDStableValue(address fromAsset, uint256 fromAmount);
    error InvalidAmount();
    error InvalidVaultConfig();
    error VaultNotActive(address vault);
    error VaultNotFound(address vault);
    error InsufficientActiveVaults();
    error NoLiquidityAvailable();

    // --- Events ---
    event StrategySharesExchanged(
        address indexed fromStrategyShare,
        address indexed toStrategyShare,
        uint256 fromShareAmount,
        uint256 toShareAmount,
        uint256 dStableAmountEquivalent,
        address indexed exchanger
    );
    event StrategiesRebalanced(
        address indexed fromVault,
        address indexed toVault,
        uint256 amount,
        address indexed initiator
    );

    // --- Immutable addresses (mirrors router constructor) ---
    address public immutable dStakeToken;
    IDStakeCollateralVaultV2 public immutable collateralVault;
    address public immutable dStable;

    // --- Shared state (must match router layout) ---
    uint256 public dustTolerance = 1;
    uint256 public maxVaultCount = 10;
    uint256 public depositCap;
    uint256 public settlementShortfall;
    uint256 public reinvestIncentiveBps;
    uint256 internal _withdrawalFeeBps;
    mapping(address => address) internal _strategyShareToAdapter;
    address public defaultDepositStrategyShare;

    enum OperationType {
        DEPOSIT,
        WITHDRAWAL
    }

    enum VaultStatus {
        Active,
        Suspended,
        Impaired
    }

    struct VaultConfig {
        address strategyVault;
        address adapter;
        uint256 targetBps;
        VaultStatus status;
    }

    VaultConfig[] public vaultConfigs;
    mapping(address => uint256) public vaultToIndex;
    mapping(address => bool) public vaultExists;

    address public governanceModule;
    address public rebalanceModule;

    struct ExchangeLocals {
        address fromAdapterAddress;
        address toAdapterAddress;
        IDStableConversionAdapterV2 fromAdapter;
        IDStableConversionAdapterV2 toAdapter;
        uint256 dStableValueIn;
        uint256 calculatedToStrategyShareAmount;
    }

    constructor(address dStakeToken_, address collateralVault_) {
        if (dStakeToken_ == address(0) || collateralVault_ == address(0)) revert ZeroAddress();
        dStakeToken = dStakeToken_;
        collateralVault = IDStakeCollateralVaultV2(collateralVault_);
        dStable = collateralVault.dStable();
        if (dStable == address(0)) revert ZeroAddress();
    }

    // --- Rebalance entry points (delegate-called) ---

    function rebalanceStrategiesByShares(
        address fromStrategyShare,
        address toStrategyShare,
        uint256 fromShareAmount,
        uint256 minToShareAmount
    ) external {
        _rebalanceStrategiesByShares(fromStrategyShare, toStrategyShare, fromShareAmount, minToShareAmount);
    }

    function rebalanceStrategiesBySharesViaExternalLiquidity(
        address fromStrategyShare,
        address toStrategyShare,
        uint256 fromShareAmount,
        uint256 minToShareAmount
    ) external {
        if (fromShareAmount == 0) revert ZeroInputDStableValue(fromStrategyShare, 0);
        if (fromStrategyShare == address(0) || toStrategyShare == address(0)) revert ZeroAddress();

        ExchangeLocals memory locals;
        locals.fromAdapterAddress = _strategyShareToAdapter[fromStrategyShare];
        locals.toAdapterAddress = _strategyShareToAdapter[toStrategyShare];

        if (locals.fromAdapterAddress == address(0)) revert AdapterNotFound(fromStrategyShare);
        if (locals.toAdapterAddress == address(0)) revert AdapterNotFound(toStrategyShare);

        VaultConfig memory fromConfig = _getVaultConfig(fromStrategyShare);
        if (!_isVaultStatusEligible(fromConfig.status, OperationType.WITHDRAWAL)) {
            revert VaultNotActive(fromStrategyShare);
        }

        VaultConfig memory toConfig = _getVaultConfig(toStrategyShare);
        if (!_isVaultStatusEligible(toConfig.status, OperationType.DEPOSIT)) {
            revert VaultNotActive(toStrategyShare);
        }

        locals.fromAdapter = IDStableConversionAdapterV2(locals.fromAdapterAddress);
        locals.toAdapter = IDStableConversionAdapterV2(locals.toAdapterAddress);

        locals.dStableValueIn = locals.fromAdapter.previewWithdrawFromStrategy(fromShareAmount);
        if (locals.dStableValueIn == 0) revert ZeroInputDStableValue(fromStrategyShare, fromShareAmount);

        (address expectedToShare, uint256 tmpToAmount) = locals.toAdapter.previewDepositIntoStrategy(
            locals.dStableValueIn
        );
        if (expectedToShare != toStrategyShare)
            revert AdapterAssetMismatch(locals.toAdapterAddress, toStrategyShare, expectedToShare);
        locals.calculatedToStrategyShareAmount = tmpToAmount;

        if (locals.calculatedToStrategyShareAmount < minToShareAmount) {
            revert SlippageCheckFailed(toStrategyShare, locals.calculatedToStrategyShareAmount, minToShareAmount);
        }

        collateralVault.transferStrategyShares(fromStrategyShare, fromShareAmount, address(this));
        IERC20(fromStrategyShare).forceApprove(locals.fromAdapterAddress, fromShareAmount);
        uint256 receivedDStable = locals.fromAdapter.withdrawFromStrategy(fromShareAmount);
        IERC20(fromStrategyShare).forceApprove(locals.fromAdapterAddress, 0);

        IERC20(dStable).forceApprove(locals.toAdapterAddress, receivedDStable);
        (address actualToStrategyShare, uint256 resultingToShareAmount) = locals.toAdapter.depositIntoStrategy(
            receivedDStable
        );
        if (actualToStrategyShare != toStrategyShare)
            revert AdapterAssetMismatch(locals.toAdapterAddress, toStrategyShare, actualToStrategyShare);

        {
            uint256 previewValue = locals.toAdapter.previewWithdrawFromStrategy(resultingToShareAmount);
            uint256 dustAdjusted = locals.dStableValueIn > dustTolerance ? locals.dStableValueIn - dustTolerance : 0;
            if (previewValue < dustAdjusted) {
                revert SlippageCheckFailed(dStable, previewValue, dustAdjusted);
            }
        }

        if (resultingToShareAmount < minToShareAmount) {
            uint256 shareShortfall = minToShareAmount - resultingToShareAmount;
            uint256 shortfallValue = shareShortfall.mulDiv(
                locals.dStableValueIn,
                locals.calculatedToStrategyShareAmount,
                Math.Rounding.Ceil
            );

            if (shortfallValue > dustTolerance) {
                revert SlippageCheckFailed(toStrategyShare, resultingToShareAmount, minToShareAmount);
            }
        }

        IERC20(dStable).forceApprove(locals.toAdapterAddress, 0);

        emit StrategySharesExchanged(
            fromStrategyShare,
            toStrategyShare,
            fromShareAmount,
            resultingToShareAmount,
            locals.dStableValueIn,
            msg.sender
        );
    }

    function rebalanceStrategiesByValue(
        address fromVault,
        address toVault,
        uint256 amount,
        uint256 minToShareAmount
    ) external {
        if (amount == 0) revert InvalidAmount();
        if (fromVault == toVault) revert InvalidVaultConfig();

        VaultConfig memory fromConfig = _getVaultConfig(fromVault);
        VaultConfig memory toConfig = _getVaultConfig(toVault);

        if (fromConfig.status != VaultStatus.Active || toConfig.status != VaultStatus.Active) {
            revert VaultNotActive(fromConfig.status == VaultStatus.Active ? toVault : fromVault);
        }

        if (!_isVaultHealthyForDeposits(toVault)) revert VaultNotActive(toVault);
        if (!_isVaultHealthyForWithdrawals(fromVault)) revert VaultNotActive(fromVault);

        uint256 requiredVaultAssetAmount = IERC4626(fromVault).previewWithdraw(amount);
        _rebalanceStrategiesByShares(fromVault, toVault, requiredVaultAssetAmount, minToShareAmount);

        emit StrategiesRebalanced(fromVault, toVault, amount, msg.sender);
    }

    // --- Internal helpers (copies of router logic) ---

    function _rebalanceStrategiesByShares(
        address fromStrategyShare,
        address toStrategyShare,
        uint256 fromShareAmount,
        uint256 minToShareAmount
    ) internal {
        address fromAdapterAddress = _strategyShareToAdapter[fromStrategyShare];
        address toAdapterAddress = _strategyShareToAdapter[toStrategyShare];
        if (fromAdapterAddress == address(0)) revert AdapterNotFound(fromStrategyShare);
        if (toAdapterAddress == address(0)) revert AdapterNotFound(toStrategyShare);

        VaultConfig memory fromConfig = _getVaultConfig(fromStrategyShare);
        if (!_isVaultStatusEligible(fromConfig.status, OperationType.WITHDRAWAL)) {
            revert VaultNotActive(fromStrategyShare);
        }

        VaultConfig memory toConfig = _getVaultConfig(toStrategyShare);
        if (!_isVaultStatusEligible(toConfig.status, OperationType.DEPOSIT)) {
            revert VaultNotActive(toStrategyShare);
        }

        IDStableConversionAdapterV2 fromAdapter = IDStableConversionAdapterV2(fromAdapterAddress);
        IDStableConversionAdapterV2 toAdapter = IDStableConversionAdapterV2(toAdapterAddress);

        uint256 dStableAmountEquivalent = fromAdapter.previewWithdrawFromStrategy(fromShareAmount);
        if (dStableAmountEquivalent <= dustTolerance) {
            return;
        }
        collateralVault.transferStrategyShares(fromStrategyShare, fromShareAmount, address(this));

        IERC20(fromStrategyShare).forceApprove(fromAdapterAddress, fromShareAmount);
        uint256 receivedDStable = fromAdapter.withdrawFromStrategy(fromShareAmount);
        IERC20(fromStrategyShare).forceApprove(fromAdapterAddress, 0);

        IERC20(dStable).forceApprove(toAdapterAddress, receivedDStable);
        (address actualToStrategyShare, uint256 resultingToShareAmount) = toAdapter.depositIntoStrategy(
            receivedDStable
        );
        if (actualToStrategyShare != toStrategyShare) {
            revert AdapterAssetMismatch(toAdapterAddress, toStrategyShare, actualToStrategyShare);
        }
        if (resultingToShareAmount < minToShareAmount) {
            revert SlippageCheckFailed(toStrategyShare, resultingToShareAmount, minToShareAmount);
        }
        IERC20(dStable).forceApprove(toAdapterAddress, 0);

        {
            uint256 previewValue = toAdapter.previewWithdrawFromStrategy(resultingToShareAmount);
            uint256 dustAdjusted = dStableAmountEquivalent > dustTolerance
                ? dStableAmountEquivalent - dustTolerance
                : 0;
            if (previewValue < dustAdjusted) {
                revert SlippageCheckFailed(dStable, previewValue, dustAdjusted);
            }
        }

        emit StrategySharesExchanged(
            fromStrategyShare,
            toStrategyShare,
            fromShareAmount,
            resultingToShareAmount,
            dStableAmountEquivalent,
            msg.sender
        );
    }

    function _getVaultConfig(address vault) internal view returns (VaultConfig memory config) {
        if (!vaultExists[vault]) revert VaultNotFound(vault);
        return vaultConfigs[vaultToIndex[vault]];
    }

    function _isVaultStatusEligible(VaultStatus status, OperationType operationType) internal pure returns (bool) {
        if (operationType == OperationType.DEPOSIT) {
            return status == VaultStatus.Active;
        }

        return status == VaultStatus.Active || status == VaultStatus.Impaired;
    }

    function _isVaultHealthyForDeposits(address vault) internal view returns (bool healthy) {
        try IERC4626(vault).totalAssets() returns (uint256) {
            try IERC4626(vault).previewDeposit(1e18) returns (uint256 shares) {
                return shares > 0;
            } catch {
                return false;
            }
        } catch {
            return false;
        }
    }

    function _isVaultHealthyForWithdrawals(address vault) internal view returns (bool healthy) {
        try IERC4626(vault).totalAssets() returns (uint256) {
            uint256 vaultShares = IERC20(vault).balanceOf(address(collateralVault));
            if (vaultShares == 0) return false;

            try IERC4626(vault).previewRedeem(vaultShares) returns (uint256 assets) {
                return assets > 0;
            } catch {
                return false;
            }
        } catch {
            return false;
        }
    }
}
