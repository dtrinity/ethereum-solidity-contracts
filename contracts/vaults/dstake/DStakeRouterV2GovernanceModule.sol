// SPDX-License-Identifier: MIT
pragma solidity ^0.8.20;

import { IERC20 } from "@openzeppelin/contracts/token/ERC20/IERC20.sol";
import { SafeERC20 } from "@openzeppelin/contracts/token/ERC20/utils/SafeERC20.sol";
import { IERC4626 } from "@openzeppelin/contracts/interfaces/IERC4626.sol";
import { Math } from "@openzeppelin/contracts/utils/math/Math.sol";

import { AllocationCalculator } from "./libraries/AllocationCalculator.sol";
import { BasisPointConstants } from "../../common/BasisPointConstants.sol";
import { IDStableConversionAdapterV2 } from "./interfaces/IDStableConversionAdapterV2.sol";
import { IDStakeCollateralVaultV2 } from "./interfaces/IDStakeCollateralVaultV2.sol";

/**
 * @title DStakeRouterV2GovernanceModule
 * @notice Contains governance and configuration mutators for {@link DStakeRouterV2} executed via delegatecall.
 * @dev This contract is designed to be delegate-called from the router. Storage layout **must** match the router's
 *      layout for all shared state variables. Access control checks are enforced at the router level before
 *      delegating to this module.
 */
contract DStakeRouterV2GovernanceModule {
    using SafeERC20 for IERC20;
    using AllocationCalculator for uint256[];
    using Math for uint256;

    // --- Errors ---
    error ZeroAddress();
    error AdapterNotFound(address strategyShare);
    error ZeroPreviewWithdrawAmount(address strategyShare);
    error VaultAssetManagedByDifferentAdapter(address strategyShare, address existingAdapter);
    error ZeroInputDStableValue(address fromAsset, uint256 fromAmount);
    error AdapterAssetMismatch(address adapter, address expectedAsset, address actualAsset);
    error SlippageCheckFailed(address asset, uint256 actualAmount, uint256 requiredAmount);
    error AdapterSharesMismatch(uint256 actualShares, uint256 reportedShares);
    error InvalidAmount();
    error InvalidVaultConfig();
    error VaultNotActive(address vault);
    error VaultNotFound(address vault);
    error InsufficientActiveVaults();
    error VaultAlreadyExists(address vault);
    error TotalAllocationInvalid(uint256 total);
    error NoLiquidityAvailable();
    error InvalidMaxVaultCount(uint256 count);
    error EmptyArrays();
    error ArrayLengthMismatch();
    error IndexOutOfBounds();
    error WithdrawalShortfall(uint256 expectedNet, uint256 actualNet);
    error ReceiverZero();
    error DepositCapExceeded(uint256 cap, uint256 currentManaged, uint256 incomingAssets);
    error SharesBelowMinimum(uint256 actualShares, uint256 minShares);
    error SharesExceedMaxRedeem(uint256 requestedShares, uint256 maxShares);
    error InvalidDepositCap(uint256 newCap, uint256 currentManaged);
    error InvalidReinvestIncentive(uint256 incentiveBps, uint256 maxBps);
    error SettlementShortfallTooHigh(uint256 shortfall, uint256 managedAssets);
    error UnauthorizedConfigCaller();
    error InvalidWithdrawalFee(uint256 feeBps, uint256 maxFeeBps);
    error VaultMustBeSuspended(address vault);
    error VaultTargetNotZero(address vault, uint256 targetBps);

    // --- Events ---
    event AdapterSet(address indexed strategyShare, address adapterAddress);
    event AdapterRemoved(address indexed strategyShare, address adapterAddress);
    event DefaultDepositStrategyShareSet(address indexed strategyShare);
    event DustToleranceSet(uint256 newDustTolerance);
    event SurplusSwept(uint256 amount, address vaultAsset);
    event SettlementShortfallUpdated(uint256 previousShortfall, uint256 newShortfall);
    event DepositCapUpdated(uint256 previousCap, uint256 newCap);
    event ReinvestIncentiveSet(uint256 newIncentiveBps);
    event WithdrawalFeeSet(uint256 previousFeeBps, uint256 newFeeBps);
    event VaultConfigAdded(address indexed vault, address indexed adapter, uint256 targetBps, VaultStatus status);
    event VaultConfigUpdated(address indexed vault, address indexed adapter, uint256 targetBps, VaultStatus status);
    event VaultConfigRemoved(address indexed vault);
    event MaxVaultCountUpdated(uint256 oldCount, uint256 newCount);

    // --- Immutable addresses (mirrors router constructor state) ---
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

    // Reserved slots for router-managed module pointers (must mirror router layout)
    address public governanceModule;
    address public rebalanceModule;

    uint256 public constant MAX_REINVEST_INCENTIVE_BPS = BasisPointConstants.ONE_PERCENT_BPS * 20;
    uint256 public constant MAX_WITHDRAWAL_FEE_BPS = BasisPointConstants.ONE_PERCENT_BPS;

    constructor(address dStakeToken_, address collateralVault_) {
        if (dStakeToken_ == address(0) || collateralVault_ == address(0)) revert ZeroAddress();
        dStakeToken = dStakeToken_;
        collateralVault = IDStakeCollateralVaultV2(collateralVault_);
        dStable = collateralVault.dStable();
        if (dStable == address(0)) revert ZeroAddress();
    }

    // --- Governance entry points (delegate-called) ---

    function setReinvestIncentive(uint256 newIncentiveBps) external {
        if (newIncentiveBps > MAX_REINVEST_INCENTIVE_BPS) {
            revert InvalidReinvestIncentive(newIncentiveBps, MAX_REINVEST_INCENTIVE_BPS);
        }
        reinvestIncentiveBps = newIncentiveBps;
        emit ReinvestIncentiveSet(newIncentiveBps);
    }

    function setWithdrawalFee(uint256 newFeeBps) external {
        if (newFeeBps > MAX_WITHDRAWAL_FEE_BPS) {
            revert InvalidWithdrawalFee(newFeeBps, MAX_WITHDRAWAL_FEE_BPS);
        }
        uint256 previous = _withdrawalFeeBps;
        if (previous == newFeeBps) {
            return;
        }
        _withdrawalFeeBps = newFeeBps;
        emit WithdrawalFeeSet(previous, newFeeBps);
    }

    function setDepositCap(uint256 newCap) external {
        uint256 managedAssets = _totalManagedAssets();
        if (newCap != 0 && newCap < managedAssets) {
            revert InvalidDepositCap(newCap, managedAssets);
        }
        uint256 previous = depositCap;
        depositCap = newCap;
        emit DepositCapUpdated(previous, newCap);
    }

    function recordShortfall(uint256 delta) external {
        if (delta == 0) {
            return;
        }
        uint256 managedAssets = _totalManagedAssets();
        uint256 newShortfall = settlementShortfall + delta;
        if (newShortfall > managedAssets) {
            revert SettlementShortfallTooHigh(newShortfall, managedAssets);
        }
        uint256 previous = settlementShortfall;
        settlementShortfall = newShortfall;
        emit SettlementShortfallUpdated(previous, newShortfall);
    }

    function clearShortfall(uint256 amount) external {
        if (amount == 0) {
            return;
        }
        uint256 previous = settlementShortfall;
        if (amount >= previous) {
            settlementShortfall = 0;
        } else {
            settlementShortfall = previous - amount;
        }
        emit SettlementShortfallUpdated(previous, settlementShortfall);
    }

    function addAdapter(address strategyShare, address adapterAddress) external {
        _addAdapter(strategyShare, adapterAddress);
    }

    function removeAdapter(address strategyShare) external {
        if (!_removeAdapter(strategyShare)) revert AdapterNotFound(strategyShare);
    }

    function setDefaultDepositStrategyShare(address strategyShare) external {
        if (_strategyShareToAdapter[strategyShare] == address(0)) revert AdapterNotFound(strategyShare);
        if (vaultExists[strategyShare]) {
            VaultConfig memory config = _getVaultConfig(strategyShare);
            if (!_isVaultStatusEligible(config.status, OperationType.DEPOSIT)) {
                revert VaultNotActive(strategyShare);
            }
        }
        defaultDepositStrategyShare = strategyShare;
        emit DefaultDepositStrategyShareSet(strategyShare);
    }

    function clearDefaultDepositStrategyShare() external {
        _clearDefaultDepositStrategyShare();
    }

    function setDustTolerance(uint256 newDustTolerance) external {
        dustTolerance = newDustTolerance;
        emit DustToleranceSet(newDustTolerance);
    }

    function sweepSurplus(uint256 maxAmount) external {
        uint256 balance = IERC20(dStable).balanceOf(address(this));
        if (balance == 0) revert ZeroInputDStableValue(dStable, 0);

        uint256 amountToSweep = (maxAmount == 0 || maxAmount > balance) ? balance : maxAmount;
        address adapterAddress = _strategyShareToAdapter[defaultDepositStrategyShare];
        if (adapterAddress == address(0)) revert AdapterNotFound(defaultDepositStrategyShare);

        IDStableConversionAdapterV2 adapter = IDStableConversionAdapterV2(adapterAddress);
        address strategyShare = adapter.strategyShare();

        VaultConfig memory config = _getVaultConfig(strategyShare);
        if (!_isVaultStatusEligible(config.status, OperationType.DEPOSIT)) {
            revert VaultNotActive(strategyShare);
        }

        IERC20(dStable).forceApprove(adapterAddress, amountToSweep);
        (address mintedShare, ) = adapter.depositIntoStrategy(amountToSweep);
        if (mintedShare != strategyShare) revert AdapterAssetMismatch(adapterAddress, strategyShare, mintedShare);
        IERC20(dStable).forceApprove(adapterAddress, 0);

        emit SurplusSwept(amountToSweep, mintedShare);
    }

    function setVaultConfigs(VaultConfig[] calldata configs) external {
        uint256 totalTargetBps = 0;
        uint256 configCount = configs.length;
        for (uint256 i; i < configCount; ) {
            totalTargetBps += configs[i].targetBps;
            unchecked {
                ++i;
            }
        }
        if (totalTargetBps != BasisPointConstants.ONE_HUNDRED_PERCENT_BPS) {
            revert TotalAllocationInvalid(totalTargetBps);
        }

        _clearVaultConfigs();
        for (uint256 i; i < configCount; ) {
            _addVaultConfig(configs[i]);
            unchecked {
                ++i;
            }
        }
    }

    function addVaultConfig(VaultConfig calldata config) external {
        _addVaultConfig(config);
    }

    function addVaultConfig(
        address vault,
        address adapter,
        uint256 targetBps,
        VaultStatus status
    ) external {
        _addVaultConfig(VaultConfig({ strategyVault: vault, adapter: adapter, targetBps: targetBps, status: status }));
    }

    function updateVaultConfig(VaultConfig calldata config) external {
        _updateVaultConfig(config);
    }

    function updateVaultConfig(
        address vault,
        address adapter,
        uint256 targetBps,
        VaultStatus status
    ) external {
        _updateVaultConfig(
            VaultConfig({ strategyVault: vault, adapter: adapter, targetBps: targetBps, status: status })
        );
    }

    function setVaultStatus(address vault, VaultStatus status) external {
        if (!vaultExists[vault]) revert VaultNotFound(vault);
        uint256 index = vaultToIndex[vault];
        VaultConfig storage config = vaultConfigs[index];
        if (config.status == status) {
            return;
        }
        config.status = status;
        emit VaultConfigUpdated(config.strategyVault, config.adapter, config.targetBps, status);
    }

    function removeVault(address vault) external {
        if (!vaultExists[vault]) revert VaultNotFound(vault);
        _removeVault(vault);
    }

    function removeVaultConfig(address vault) external {
        if (!vaultExists[vault]) revert VaultNotFound(vault);
        _removeVault(vault);
    }

    function suspendVaultForRemoval(address vault) external {
        _suspendVaultForRemoval(vault);
    }

    function emergencyPauseVault(address vault) external {
        if (!vaultExists[vault]) revert VaultNotFound(vault);
        uint256 index = vaultToIndex[vault];
        vaultConfigs[index].status = VaultStatus.Suspended;
        emit VaultConfigUpdated(
            vault,
            vaultConfigs[index].adapter,
            vaultConfigs[index].targetBps,
            VaultStatus.Suspended
        );
    }

    function setMaxVaultCount(uint256 newMax) external {
        if (newMax == 0 || newMax < vaultConfigs.length) revert InvalidMaxVaultCount(newMax);
        uint256 previous = maxVaultCount;
        if (newMax == previous) {
            return;
        }
        maxVaultCount = newMax;
        emit MaxVaultCountUpdated(previous, newMax);
    }

    // --- Internal helpers (copied from router) ---

    function _addAdapter(address strategyShare, address adapterAddress) internal {
        if (adapterAddress == address(0) || strategyShare == address(0)) revert ZeroAddress();
        address adapterStrategyShare = IDStableConversionAdapterV2(adapterAddress).strategyShare();
        if (adapterStrategyShare != strategyShare)
            revert AdapterAssetMismatch(adapterAddress, strategyShare, adapterStrategyShare);
        if (
            _strategyShareToAdapter[strategyShare] != address(0) &&
            _strategyShareToAdapter[strategyShare] != adapterAddress
        ) {
            revert VaultAssetManagedByDifferentAdapter(strategyShare, _strategyShareToAdapter[strategyShare]);
        }
        _strategyShareToAdapter[strategyShare] = adapterAddress;

        if (vaultExists[strategyShare]) {
            vaultConfigs[vaultToIndex[strategyShare]].adapter = adapterAddress;
        }

        try collateralVault.addSupportedStrategyShare(strategyShare) {} catch {}

        emit AdapterSet(strategyShare, adapterAddress);
    }

    function _removeAdapter(address strategyShare) internal returns (bool removed) {
        address adapterAddress = _strategyShareToAdapter[strategyShare];
        if (adapterAddress == address(0)) {
            return false;
        }

        if (vaultExists[strategyShare]) {
            VaultConfig storage config = vaultConfigs[vaultToIndex[strategyShare]];
            if (config.status != VaultStatus.Suspended) {
                revert VaultMustBeSuspended(strategyShare);
            }
            if (config.targetBps != 0) {
                revert VaultTargetNotZero(strategyShare, config.targetBps);
            }
        }

        collateralVault.removeSupportedStrategyShare(strategyShare);

        if (defaultDepositStrategyShare == strategyShare) {
            _clearDefaultDepositStrategyShare();
        }

        delete _strategyShareToAdapter[strategyShare];

        if (vaultExists[strategyShare]) {
            vaultConfigs[vaultToIndex[strategyShare]].adapter = address(0);
        }

        emit AdapterRemoved(strategyShare, adapterAddress);
        return true;
    }

    function _clearDefaultDepositStrategyShare() internal {
        if (defaultDepositStrategyShare == address(0)) {
            return;
        }
        defaultDepositStrategyShare = address(0);
        emit DefaultDepositStrategyShareSet(address(0));
    }

    function _suspendVaultForRemoval(address vault) internal {
        if (!vaultExists[vault]) revert VaultNotFound(vault);
        uint256 index = vaultToIndex[vault];
        VaultConfig storage config = vaultConfigs[index];

        bool mutated;
        if (config.status != VaultStatus.Suspended) {
            config.status = VaultStatus.Suspended;
            mutated = true;
        }

        if (config.targetBps != 0) {
            config.targetBps = 0;
            mutated = true;
        }

        if (defaultDepositStrategyShare == vault) {
            _clearDefaultDepositStrategyShare();
        }

        if (mutated) {
            emit VaultConfigUpdated(vault, config.adapter, config.targetBps, VaultStatus.Suspended);
        }
    }

    function _addVaultConfig(VaultConfig memory config) internal {
        if (config.strategyVault == address(0) || config.adapter == address(0)) revert ZeroAddress();
        if (vaultExists[config.strategyVault]) revert VaultAlreadyExists(config.strategyVault);
        if (vaultConfigs.length >= maxVaultCount) revert InvalidVaultConfig();

        uint256 index = vaultConfigs.length;
        vaultConfigs.push(config);
        vaultToIndex[config.strategyVault] = index;
        vaultExists[config.strategyVault] = true;

        _syncAdapter(config.strategyVault, config.adapter);

        emit VaultConfigAdded(config.strategyVault, config.adapter, config.targetBps, config.status);
    }

    function _updateVaultConfig(VaultConfig memory config) internal {
        if (!vaultExists[config.strategyVault]) revert VaultNotFound(config.strategyVault);

        uint256 index = vaultToIndex[config.strategyVault];
        vaultConfigs[index] = config;

        _syncAdapter(config.strategyVault, config.adapter);

        emit VaultConfigUpdated(config.strategyVault, config.adapter, config.targetBps, config.status);
    }

    function _removeVault(address vault) internal {
        uint256 indexToRemove = vaultToIndex[vault];
        uint256 lastIndex = vaultConfigs.length - 1;

        _suspendVaultForRemoval(vault);

        if (_strategyShareToAdapter[vault] != address(0)) {
            _removeAdapter(vault);
        }

        if (indexToRemove != lastIndex) {
            VaultConfig memory lastConfig = vaultConfigs[lastIndex];
            vaultConfigs[indexToRemove] = lastConfig;
            vaultToIndex[lastConfig.strategyVault] = indexToRemove;
        }

        vaultConfigs.pop();
        delete vaultToIndex[vault];
        delete vaultExists[vault];

        emit VaultConfigRemoved(vault);
    }

    function _clearVaultConfigs() internal {
        uint256 configCount = vaultConfigs.length;
        for (uint256 i; i < configCount; ) {
            address vault = vaultConfigs[i].strategyVault;
            _suspendVaultForRemoval(vault);
            _removeAdapter(vault);
            delete vaultToIndex[vault];
            delete vaultExists[vault];
            unchecked {
                ++i;
            }
        }
        delete vaultConfigs;
    }

    function _syncAdapter(address strategyShare, address adapterAddress) internal {
        address currentAdapter = _strategyShareToAdapter[strategyShare];
        if (adapterAddress == address(0)) {
            if (currentAdapter != address(0)) {
                _removeAdapter(strategyShare);
            }
            return;
        }

        if (currentAdapter != address(0)) {
            address adapterStrategyShare = IDStableConversionAdapterV2(adapterAddress).strategyShare();
            if (adapterStrategyShare != strategyShare) {
                revert AdapterAssetMismatch(adapterAddress, strategyShare, adapterStrategyShare);
            }

            _strategyShareToAdapter[strategyShare] = adapterAddress;
            if (vaultExists[strategyShare]) {
                vaultConfigs[vaultToIndex[strategyShare]].adapter = adapterAddress;
            }
            try collateralVault.addSupportedStrategyShare(strategyShare) {} catch {}
            emit AdapterSet(strategyShare, adapterAddress);
            return;
        }

        _addAdapter(strategyShare, adapterAddress);
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

    function _totalManagedAssets() internal view returns (uint256) {
        uint256 vaultValue = collateralVault.totalValueInDStable();
        uint256 idle = IERC20(dStable).balanceOf(address(this));
        return vaultValue + idle;
    }
}
