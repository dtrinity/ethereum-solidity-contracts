// SPDX-License-Identifier: MIT
pragma solidity ^0.8.20;

import { IERC20 } from "@openzeppelin/contracts/token/ERC20/IERC20.sol";
import { SafeERC20 } from "@openzeppelin/contracts/token/ERC20/utils/SafeERC20.sol";
import { AccessControl } from "@openzeppelin/contracts/access/AccessControl.sol";
import { ReentrancyGuard } from "@openzeppelin/contracts/utils/ReentrancyGuard.sol";
import { Pausable } from "@openzeppelin/contracts/utils/Pausable.sol";
import { IERC4626 } from "@openzeppelin/contracts/interfaces/IERC4626.sol";
import { Math } from "@openzeppelin/contracts/utils/math/Math.sol";

import { IDStakeRouterV2 } from "./interfaces/IDStakeRouterV2.sol";
import { IDStableConversionAdapterV2 } from "./interfaces/IDStableConversionAdapterV2.sol";
import { IDStakeCollateralVaultV2 } from "./interfaces/IDStakeCollateralVaultV2.sol";
import { DeterministicVaultSelector } from "./libraries/DeterministicVaultSelector.sol";
import { AllocationCalculator } from "./libraries/AllocationCalculator.sol";
import { BasisPointConstants } from "../../common/BasisPointConstants.sol";
import { WithdrawalFeeMath } from "../../common/WithdrawalFeeMath.sol";

interface IDStakeTokenV2Minimal {
    function asset() external view returns (address);

    function balanceOf(address account) external view returns (uint256);

    function totalAssets() external view returns (uint256);

    function previewDeposit(uint256 assets) external view returns (uint256);

    function previewMint(uint256 shares) external view returns (uint256);

    function previewWithdraw(uint256 assets) external view returns (uint256);

    function previewRedeem(uint256 shares) external view returns (uint256);

    function mintForRouter(address initiator, address receiver, uint256 assets, uint256 shares) external;

    function burnFromRouter(
        address initiator,
        address receiver,
        address owner,
        uint256 netAssets,
        uint256 shares
    ) external;
}

/**
 * @title DStakeRouterV2
 * @notice Provides deterministic routing for dSTAKE, pairing single-vault ERC4626 flows with solver-managed multi-vault operations.
 * @dev Extends the original single-dLEND router with allocation-aware selection and solver support for explicit multi-vault paths.
 */
contract DStakeRouterV2 is IDStakeRouterV2, AccessControl, ReentrancyGuard, Pausable {
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
    error ShareWithdrawalConversionFailed();
    error SolverShareDepositShortfall(address vault, uint256 expectedShares, uint256 actualShares);
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

    // --- Roles ---
    bytes32 public constant DSTAKE_TOKEN_ROLE = keccak256("DSTAKE_TOKEN_ROLE");
    bytes32 public constant STRATEGY_REBALANCER_ROLE = keccak256("STRATEGY_REBALANCER_ROLE");
    bytes32 public constant ADAPTER_MANAGER_ROLE = keccak256("ADAPTER_MANAGER_ROLE");
    bytes32 public constant CONFIG_MANAGER_ROLE = keccak256("CONFIG_MANAGER_ROLE");
    bytes32 public constant VAULT_MANAGER_ROLE = keccak256("VAULT_MANAGER_ROLE");
    bytes32 public constant PAUSER_ROLE = keccak256("PAUSER_ROLE");

    // --- State ---
    address public immutable dStakeToken;
    IDStakeCollateralVaultV2 public immutable collateralVault;
    address public immutable dStable;

    uint256 public dustTolerance = 1;
    uint256 public maxVaultCount = 10;
    uint256 public depositCap; // 0 == unlimited
    uint256 public settlementShortfall;
    uint256 public reinvestIncentiveBps;
    uint256 private _withdrawalFeeBps;

    uint256 public constant MAX_REINVEST_INCENTIVE_BPS = BasisPointConstants.ONE_PERCENT_BPS * 20;
    uint256 public constant MAX_WITHDRAWAL_FEE_BPS = BasisPointConstants.ONE_PERCENT_BPS;

    mapping(address => address) private _strategyShareToAdapter;
    address public defaultDepositStrategyShare;

    function _token() internal view returns (IDStakeTokenV2Minimal) {
        return IDStakeTokenV2Minimal(dStakeToken);
    }

    struct ExchangeLocals {
        address fromAdapterAddress;
        address toAdapterAddress;
        IDStableConversionAdapterV2 fromAdapter;
        IDStableConversionAdapterV2 toAdapter;
        uint256 dStableValueIn;
        uint256 calculatedToStrategyShareAmount;
    }

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

    // --- Events ---
    event RouterDepositRouted(
        address indexed initiator,
        address indexed receiver,
        address indexed strategyVault,
        uint256 assets,
        uint256 shares
    );
    event RouterWithdrawSettled(
        address indexed initiator,
        address indexed receiver,
        address indexed strategyVault,
        uint256 grossAssets,
        uint256 netAssets,
        uint256 fee
    );
    event StrategySharesExchanged(
        address indexed fromStrategyShare,
        address indexed toStrategyShare,
        uint256 fromShareAmount,
        uint256 toShareAmount,
        uint256 dStableAmountEquivalent,
        address indexed exchanger
    );
    event AdapterSet(address indexed strategyShare, address adapterAddress);
    event AdapterRemoved(address indexed strategyShare, address adapterAddress);
    event DefaultDepositStrategyShareSet(address indexed strategyShare);
    event DustToleranceSet(uint256 newDustTolerance);
    event SurplusSwept(uint256 amount, address vaultAsset);
    event StrategyDepositRouted(address[] selectedVaults, uint256[] depositAmounts, uint256 totalDStableAmount);
    event StrategyWithdrawalRouted(address[] selectedVaults, uint256[] withdrawalAmounts, uint256 totalDStableAmount);
    event RouterSolverDeposit(
        address indexed caller,
        address indexed receiver,
        uint256 totalAssets,
        uint256 sharesMinted
    );
    event RouterSolverWithdraw(
        address indexed caller,
        address indexed receiver,
        uint256 grossAssets,
        uint256 netAssets,
        uint256 fee,
        uint256 sharesBurned
    );
    event RouterFeesReinvested(uint256 amountReinvested, uint256 incentivePaid, address indexed caller);
    event SettlementShortfallUpdated(uint256 previousShortfall, uint256 newShortfall);
    event DepositCapUpdated(uint256 previousCap, uint256 newCap);
    event ReinvestIncentiveSet(uint256 newIncentiveBps);
    event WithdrawalFeeSet(uint256 previousFeeBps, uint256 newFeeBps);
    event VaultConfigAdded(address indexed vault, address indexed adapter, uint256 targetBps, VaultStatus status);
    event VaultConfigUpdated(address indexed vault, address indexed adapter, uint256 targetBps, VaultStatus status);
    event VaultConfigRemoved(address indexed vault);
    event StrategiesRebalanced(
        address indexed fromVault,
        address indexed toVault,
        uint256 amount,
        address indexed initiator
    );
    event MaxVaultCountUpdated(uint256 oldCount, uint256 newCount);

    constructor(address _dStakeToken, address _collateralVault) {
        if (_dStakeToken == address(0) || _collateralVault == address(0)) {
            revert ZeroAddress();
        }

        dStakeToken = _dStakeToken;
        collateralVault = IDStakeCollateralVaultV2(_collateralVault);
        dStable = collateralVault.dStable();
        if (dStable == address(0)) {
            revert ZeroAddress();
        }

        _grantRole(DEFAULT_ADMIN_ROLE, msg.sender);
        _grantRole(ADAPTER_MANAGER_ROLE, msg.sender);
        _grantRole(CONFIG_MANAGER_ROLE, msg.sender);
        _grantRole(VAULT_MANAGER_ROLE, msg.sender);
        _grantRole(PAUSER_ROLE, msg.sender);
        _grantRole(DSTAKE_TOKEN_ROLE, _dStakeToken);
    }

    // --- Core Router Functions ---

    function strategyShareToAdapter(address strategyShare) external view returns (address) {
        return _strategyShareToAdapter[strategyShare];
    }

    function paused() public view override(IDStakeRouterV2, Pausable) returns (bool) {
        return Pausable.paused();
    }

    function totalManagedAssets() public view override returns (uint256) {
        uint256 vaultValue = collateralVault.totalValueInDStable();
        uint256 idle = IERC20(dStable).balanceOf(address(this));
        return vaultValue + idle;
    }

    function currentShortfall() public view override returns (uint256) {
        return settlementShortfall;
    }

    function withdrawalFeeBps() public view override returns (uint256) {
        return _withdrawalFeeBps;
    }

    function maxWithdrawalFeeBps() public pure override returns (uint256) {
        return MAX_WITHDRAWAL_FEE_BPS;
    }

    function maxDeposit(address) public view override returns (uint256) {
        if (paused()) {
            return 0;
        }
        if (!_hasActiveVaultFor(OperationType.DEPOSIT)) {
            return 0;
        }

        address targetVault = _selectAutoDepositVault();
        uint256 vaultLimit = _vaultDepositLimit(targetVault);
        if (vaultLimit == 0) {
            return 0;
        }

        if (depositCap == 0) {
            return vaultLimit;
        }

        uint256 managed = totalManagedAssets();
        if (depositCap <= managed) {
            return 0;
        }

        uint256 capRemaining = depositCap - managed;
        return capRemaining < vaultLimit ? capRemaining : vaultLimit;
    }

    function maxMint(address) public view override returns (uint256) {
        uint256 assetLimit = maxDeposit(address(0));
        if (assetLimit == 0) {
            return 0;
        }
        return _token().previewDeposit(assetLimit);
    }

    function maxWithdraw(address owner) public view override returns (uint256) {
        if (paused()) {
            return 0;
        }
        if (!_hasActiveVaultFor(OperationType.WITHDRAWAL)) {
            return 0;
        }

        uint256 ownerShares = _token().balanceOf(owner);
        if (ownerShares == 0) {
            return 0;
        }

        uint256 netAssets = _token().previewRedeem(ownerShares);
        if (netAssets == 0) {
            return 0;
        }

        uint256 routerCapacityGross = _maxSingleVaultWithdraw();
        if (routerCapacityGross == 0) {
            return 0;
        }

        uint256 routerNetCapacity = _getNetAmount(routerCapacityGross);
        return routerNetCapacity < netAssets ? routerNetCapacity : netAssets;
    }

    function maxRedeem(address owner) public view override returns (uint256) {
        uint256 maxNetAssets = maxWithdraw(owner);
        if (maxNetAssets == 0) {
            return 0;
        }
        return _token().previewWithdraw(maxNetAssets);
    }

    function _hasActiveVaultFor(OperationType op) internal view returns (bool) {
        (address[] memory activeVaults, , ) = _getActiveVaultsAndAllocations(op);
        return activeVaults.length > 0;
    }

    function _calculateFee(uint256 grossAmount) internal view returns (uint256) {
        return WithdrawalFeeMath.calculateWithdrawalFee(grossAmount, _withdrawalFeeBps);
    }

    function _enforceDepositCap(uint256 additionalAssets) internal view {
        if (depositCap == 0) {
            return;
        }
        uint256 managed = totalManagedAssets();
        if (managed + additionalAssets > depositCap) {
            revert DepositCapExceeded(depositCap, managed, additionalAssets);
        }
    }

    function _getNetAmount(uint256 grossAmount) internal view returns (uint256) {
        return WithdrawalFeeMath.netAfterFee(grossAmount, _withdrawalFeeBps);
    }

    function _getGrossAmountForNet(uint256 netAmount) internal view returns (uint256) {
        return WithdrawalFeeMath.grossFromNet(netAmount, _withdrawalFeeBps);
    }

    function _requireConfigOrToken(address account) internal view {
        if (account != dStakeToken && !hasRole(CONFIG_MANAGER_ROLE, account)) {
            revert UnauthorizedConfigCaller();
        }
    }

    function _clearDefaultDepositStrategyShare() internal {
        if (defaultDepositStrategyShare == address(0)) {
            return;
        }
        defaultDepositStrategyShare = address(0);
        emit DefaultDepositStrategyShareSet(address(0));
    }

    function _selectAutoDepositVault() internal view returns (address targetVault) {
        (
            address[] memory activeVaults,
            uint256[] memory currentAllocations,
            uint256[] memory targetAllocations
        ) = _getActiveVaultsAndAllocations(OperationType.DEPOSIT);

        if (activeVaults.length == 0) revert InsufficientActiveVaults();

        (address[] memory sortedVaults, ) = DeterministicVaultSelector.selectTopUnderallocated(
            activeVaults,
            currentAllocations,
            targetAllocations,
            1
        );

        return sortedVaults[0];
    }

    function _vaultDepositLimit(address vault) internal view returns (uint256) {
        if (vault == address(0)) {
            return 0;
        }
        if (_strategyShareToAdapter[vault] == address(0)) {
            return 0;
        }

        try IERC4626(vault).maxDeposit(address(collateralVault)) returns (uint256 limit) {
            return limit;
        } catch {
            return type(uint256).max;
        }
    }

    function _depositToAutoVault(uint256 assets) internal returns (address targetVault) {
        targetVault = _selectAutoDepositVault();
        _depositToVaultAtomically(targetVault, assets);

        address[] memory vaultArray = new address[](1);
        uint256[] memory amountArray = new uint256[](1);
        vaultArray[0] = targetVault;
        amountArray[0] = assets;
        emit StrategyDepositRouted(vaultArray, amountArray, assets);
    }

    function _selectVaultForWithdrawal(uint256 grossAssets) internal view returns (address targetVault) {
        (
            address[] memory activeVaults,
            uint256[] memory currentAllocations,
            uint256[] memory targetAllocations
        ) = _getActiveVaultsAndAllocations(OperationType.WITHDRAWAL);

        if (activeVaults.length == 0) revert InsufficientActiveVaults();

        (address[] memory sortedVaults, ) = DeterministicVaultSelector.selectTopOverallocated(
            activeVaults,
            currentAllocations,
            targetAllocations,
            activeVaults.length
        );

        for (uint256 i = 0; i < sortedVaults.length; i++) {
            if (_vaultCanSatisfyWithdrawal(sortedVaults[i], grossAssets)) {
                return sortedVaults[i];
            }
        }

        revert NoLiquidityAvailable();
    }

    function handleDeposit(
        address initiator,
        uint256 assets,
        uint256 shares,
        address receiver
    ) external override onlyRole(DSTAKE_TOKEN_ROLE) nonReentrant whenNotPaused {
        if (receiver == address(0)) revert ReceiverZero();
        if (assets == 0) revert InvalidAmount();

        _enforceDepositCap(assets);

        IERC20(dStable).safeTransferFrom(msg.sender, address(this), assets);
        address targetVault = _depositToAutoVault(assets);
        emit RouterDepositRouted(initiator, receiver, targetVault, assets, shares);
    }

    function handleWithdraw(
        address initiator,
        address receiver,
        address /*owner*/,
        uint256 grossAssets,
        uint256 expectedNetAssets
    )
        external
        override
        onlyRole(DSTAKE_TOKEN_ROLE)
        nonReentrant
        whenNotPaused
        returns (uint256 netAssets, uint256 fee)
    {
        if (receiver == address(0)) revert ReceiverZero();
        if (grossAssets == 0) {
            return (0, 0);
        }

        address targetVault = _selectVaultForWithdrawal(grossAssets);
        uint256 grossWithdrawn = _withdrawFromVaultAtomically(targetVault, grossAssets);

        fee = _calculateFee(grossWithdrawn);
        netAssets = grossWithdrawn - fee;
        if (netAssets < expectedNetAssets) {
            revert WithdrawalShortfall(expectedNetAssets, netAssets);
        }

        IERC20(dStable).safeTransfer(receiver, netAssets);

        address[] memory vaultArray = new address[](1);
        uint256[] memory amountArray = new uint256[](1);
        vaultArray[0] = targetVault;
        amountArray[0] = grossWithdrawn;

        emit StrategyWithdrawalRouted(vaultArray, amountArray, grossWithdrawn);
        emit RouterWithdrawSettled(initiator, receiver, targetVault, grossWithdrawn, netAssets, fee);
        return (netAssets, fee);
    }

    // --- Solver Mode Entrypoints ---

    function solverDepositAssets(
        address[] calldata vaults,
        uint256[] calldata assets,
        uint256 minShares,
        address receiver
    ) external override nonReentrant whenNotPaused returns (uint256 sharesMinted) {
        if (receiver == address(0)) revert ReceiverZero();
        if (vaults.length == 0) revert EmptyArrays();
        if (vaults.length != assets.length) revert ArrayLengthMismatch();

        uint256 totalAssets = 0;
        for (uint256 i = 0; i < assets.length; i++) {
            totalAssets += assets[i];
        }

        if (totalAssets == 0) revert InvalidAmount();

        _enforceDepositCap(totalAssets);

        sharesMinted = _token().previewDeposit(totalAssets);
        if (sharesMinted < minShares) {
            revert SharesBelowMinimum(sharesMinted, minShares);
        }

        IERC20(dStable).safeTransferFrom(msg.sender, address(this), totalAssets);

        for (uint256 i = 0; i < vaults.length; i++) {
            if (assets[i] > 0) {
                _depositToVaultAtomically(vaults[i], assets[i]);
            }
        }

        _token().mintForRouter(msg.sender, receiver, totalAssets, sharesMinted);

        emit StrategyDepositRouted(vaults, assets, totalAssets);
        emit RouterSolverDeposit(msg.sender, receiver, totalAssets, sharesMinted);
        return sharesMinted;
    }

    function solverDepositShares(
        address[] calldata vaults,
        uint256[] calldata shares,
        uint256 minShares,
        address receiver
    ) external override nonReentrant whenNotPaused returns (uint256 sharesMinted) {
        if (receiver == address(0)) revert ReceiverZero();
        if (vaults.length == 0) revert EmptyArrays();
        if (vaults.length != shares.length) revert ArrayLengthMismatch();

        uint256[] memory assetAmounts = new uint256[](vaults.length);
        uint256 totalAssets = 0;

        for (uint256 i = 0; i < vaults.length; i++) {
            if (shares[i] > 0) {
                VaultConfig memory config = _getVaultConfig(vaults[i]);
                if (config.status != VaultStatus.Active) revert VaultNotActive(vaults[i]);

                uint256 assetsNeeded = IERC4626(vaults[i]).previewMint(shares[i]);
                assetAmounts[i] = assetsNeeded;
                totalAssets += assetsNeeded;
            }
        }

        if (totalAssets == 0) revert InvalidAmount();

        _enforceDepositCap(totalAssets);

        sharesMinted = _token().previewDeposit(totalAssets);
        if (sharesMinted < minShares) {
            revert SharesBelowMinimum(sharesMinted, minShares);
        }

        IERC20(dStable).safeTransferFrom(msg.sender, address(this), totalAssets);

        for (uint256 i = 0; i < vaults.length; i++) {
            if (shares[i] > 0) {
                uint256 mintedShares = _depositToVaultAtomically(vaults[i], assetAmounts[i]);
                if (mintedShares < shares[i]) {
                    revert SolverShareDepositShortfall(vaults[i], shares[i], mintedShares);
                }
            }
        }

        _token().mintForRouter(msg.sender, receiver, totalAssets, sharesMinted);

        emit StrategyDepositRouted(vaults, assetAmounts, totalAssets);
        emit RouterSolverDeposit(msg.sender, receiver, totalAssets, sharesMinted);
        return sharesMinted;
    }

    function solverWithdrawAssets(
        address[] calldata vaults,
        uint256[] calldata assets,
        uint256 maxShares,
        address receiver,
        address owner
    ) external override nonReentrant whenNotPaused returns (uint256 netAssets, uint256 fee, uint256 sharesBurned) {
        if (receiver == address(0)) revert ReceiverZero();
        if (vaults.length == 0) revert EmptyArrays();
        if (vaults.length != assets.length) revert ArrayLengthMismatch();

        uint256 totalNetAssets = 0;
        uint256 totalGrossAssets = 0;
        uint256[] memory grossRequests = new uint256[](assets.length);

        for (uint256 i = 0; i < assets.length; i++) {
            uint256 requestedNet = assets[i];
            totalNetAssets += requestedNet;
            if (requestedNet > 0) {
                uint256 requestedGross = _getGrossAmountForNet(requestedNet);
                grossRequests[i] = requestedGross;
                totalGrossAssets += requestedGross;
            }
        }

        if (totalNetAssets == 0) revert InvalidAmount();

        uint256 aggregatedGross = _getGrossAmountForNet(totalNetAssets);
        if (aggregatedGross > totalGrossAssets) {
            uint256 shortfall = aggregatedGross - totalGrossAssets;
            for (uint256 i = assets.length; i > 0; i--) {
                uint256 idx = i - 1;
                if (grossRequests[idx] > 0) {
                    grossRequests[idx] += shortfall;
                    break;
                }
            }
            totalGrossAssets = aggregatedGross;
        }

        sharesBurned = _token().previewWithdraw(totalNetAssets);
        if (sharesBurned > maxShares) {
            revert SharesExceedMaxRedeem(sharesBurned, maxShares);
        }

        uint256 grossWithdrawn = _executeGrossWithdrawals(vaults, grossRequests);

        fee = _calculateFee(grossWithdrawn);
        netAssets = grossWithdrawn - fee;

        if (netAssets < totalNetAssets) {
            revert WithdrawalShortfall(totalNetAssets, netAssets);
        }
        if (netAssets > totalNetAssets) {
            uint256 roundingSurplus = netAssets - totalNetAssets;
            fee += roundingSurplus;
            netAssets = totalNetAssets;
        }

        _token().burnFromRouter(msg.sender, receiver, owner, netAssets, sharesBurned);

        IERC20(dStable).safeTransfer(receiver, netAssets);

        emit StrategyWithdrawalRouted(vaults, grossRequests, grossWithdrawn);
        emit RouterSolverWithdraw(msg.sender, receiver, grossWithdrawn, netAssets, fee, sharesBurned);
        return (netAssets, fee, sharesBurned);
    }

    function solverWithdrawShares(
        address[] calldata vaults,
        uint256[] calldata strategyShares,
        uint256 maxShares,
        address receiver,
        address owner
    ) external override nonReentrant whenNotPaused returns (uint256 netAssets, uint256 fee, uint256 sharesBurned) {
        if (receiver == address(0)) revert ReceiverZero();
        if (vaults.length == 0) revert EmptyArrays();
        if (vaults.length != strategyShares.length) revert ArrayLengthMismatch();

        uint256[] memory grossAssetAmounts = new uint256[](vaults.length);
        uint256 totalGrossAssets = 0;

        for (uint256 i = 0; i < vaults.length; i++) {
            uint256 shareAmount = strategyShares[i];
            if (shareAmount > 0) {
                uint256 assetAmount = IERC4626(vaults[i]).previewRedeem(shareAmount);
                grossAssetAmounts[i] = assetAmount;
                totalGrossAssets += assetAmount;
            }
        }

        if (totalGrossAssets == 0) revert InvalidAmount();

        uint256 totalNetAssets = _getNetAmount(totalGrossAssets);

        sharesBurned = _token().previewWithdraw(totalNetAssets);
        if (sharesBurned > maxShares) {
            revert SharesExceedMaxRedeem(sharesBurned, maxShares);
        }

        uint256 grossWithdrawn = _executeWithdrawShares(vaults, strategyShares);

        fee = _calculateFee(grossWithdrawn);
        netAssets = grossWithdrawn - fee;

        if (netAssets < totalNetAssets) {
            revert WithdrawalShortfall(totalNetAssets, netAssets);
        }
        if (netAssets > totalNetAssets) {
            uint256 roundingSurplus = netAssets - totalNetAssets;
            fee += roundingSurplus;
            netAssets = totalNetAssets;
        }

        _token().burnFromRouter(msg.sender, receiver, owner, netAssets, sharesBurned);

        IERC20(dStable).safeTransfer(receiver, netAssets);

        emit StrategyWithdrawalRouted(vaults, grossAssetAmounts, grossWithdrawn);
        emit RouterSolverWithdraw(msg.sender, receiver, grossWithdrawn, netAssets, fee, sharesBurned);
        return (netAssets, fee, sharesBurned);
    }

    function reinvestFees()
        external
        override
        nonReentrant
        whenNotPaused
        returns (uint256 amountReinvested, uint256 incentivePaid)
    {
        uint256 balance = IERC20(dStable).balanceOf(address(this));
        if (balance == 0) {
            return (0, 0);
        }

        uint256 incentive = Math.mulDiv(balance, reinvestIncentiveBps, BasisPointConstants.ONE_HUNDRED_PERCENT_BPS);
        if (incentive > 0) {
            IERC20(dStable).safeTransfer(msg.sender, incentive);
        }

        amountReinvested = balance - incentive;
        if (amountReinvested == 0) {
            emit RouterFeesReinvested(0, incentive, msg.sender);
            return (0, incentive);
        }

        _depositToAutoVault(amountReinvested);
        emit RouterFeesReinvested(amountReinvested, incentive, msg.sender);
        incentivePaid = incentive;
        return (amountReinvested, incentivePaid);
    }

    function setReinvestIncentive(uint256 newIncentiveBps) external {
        _requireConfigOrToken(_msgSender());
        if (newIncentiveBps > MAX_REINVEST_INCENTIVE_BPS) {
            revert InvalidReinvestIncentive(newIncentiveBps, MAX_REINVEST_INCENTIVE_BPS);
        }
        reinvestIncentiveBps = newIncentiveBps;
        emit ReinvestIncentiveSet(newIncentiveBps);
    }

    function setWithdrawalFee(uint256 newFeeBps) external override {
        _requireConfigOrToken(_msgSender());
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
        _requireConfigOrToken(_msgSender());
        if (newCap != 0 && newCap < totalManagedAssets()) {
            revert InvalidDepositCap(newCap, totalManagedAssets());
        }
        uint256 previous = depositCap;
        depositCap = newCap;
        emit DepositCapUpdated(previous, newCap);
    }

    function recordShortfall(uint256 delta) external {
        _requireConfigOrToken(_msgSender());
        if (delta == 0) {
            return;
        }
        uint256 newShortfall = settlementShortfall + delta;
        if (newShortfall > totalManagedAssets()) {
            revert SettlementShortfallTooHigh(newShortfall, totalManagedAssets());
        }
        uint256 previous = settlementShortfall;
        settlementShortfall = newShortfall;
        emit SettlementShortfallUpdated(previous, newShortfall);
    }

    function clearShortfall(uint256 amount) external {
        _requireConfigOrToken(_msgSender());
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

    // --- Rebalance/Exchange Functions ---

    function rebalanceStrategiesByShares(
        address fromStrategyShare,
        address toStrategyShare,
        uint256 fromShareAmount,
        uint256 minToShareAmount
    ) external onlyRole(STRATEGY_REBALANCER_ROLE) nonReentrant {
        _rebalanceStrategiesByShares(fromStrategyShare, toStrategyShare, fromShareAmount, minToShareAmount);
    }

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

    function rebalanceStrategiesBySharesViaExternalLiquidity(
        address fromStrategyShare,
        address toStrategyShare,
        uint256 fromShareAmount,
        uint256 minToShareAmount
    ) external onlyRole(STRATEGY_REBALANCER_ROLE) nonReentrant {
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

        // Validate actual conversion result by measuring the share shortfall in dStable units and comparing to tolerance
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
    ) external onlyRole(STRATEGY_REBALANCER_ROLE) nonReentrant {
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

    // --- Adapter Management ---

    function addAdapter(address strategyShare, address adapterAddress) external onlyRole(ADAPTER_MANAGER_ROLE) {
        _addAdapter(strategyShare, adapterAddress);
    }

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

    function removeAdapter(address strategyShare) external onlyRole(ADAPTER_MANAGER_ROLE) {
        if (!_removeAdapter(strategyShare)) revert AdapterNotFound(strategyShare);
    }

    function _syncAdapter(address strategyShare, address adapterAddress) internal {
        address currentAdapter = _strategyShareToAdapter[strategyShare];
        if (currentAdapter == adapterAddress) {
            return;
        }

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

    function setDefaultDepositStrategyShare(address strategyShare) external onlyRole(CONFIG_MANAGER_ROLE) {
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

    function clearDefaultDepositStrategyShare() external onlyRole(CONFIG_MANAGER_ROLE) {
        _clearDefaultDepositStrategyShare();
    }

    function setDustTolerance(uint256 _dustTolerance) external onlyRole(CONFIG_MANAGER_ROLE) {
        dustTolerance = _dustTolerance;
        emit DustToleranceSet(_dustTolerance);
    }

    function sweepSurplus(uint256 maxAmount) external onlyRole(DEFAULT_ADMIN_ROLE) nonReentrant {
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

        // Prevent residual allowances for the adapter regardless of token behaviour.
        IERC20(dStable).forceApprove(adapterAddress, 0);

        emit SurplusSwept(amountToSweep, mintedShare);
    }

    // --- Vault Configuration ---

    /**
     * @notice Replaces all vault configs and enforces total target allocations sum to 100%.
     * @dev This is the ONLY mutator that enforces the allocation-sum invariant on-chain.
     *      Reverts with `TotalAllocationInvalid(total)` if the sum of all provided `targetBps`
     *      is not exactly `BasisPointConstants.ONE_HUNDRED_PERCENT_BPS` (1,000,000 bps).
     *      Use this after operational changes (add/remove/pause) to restore precise targets.
     */
    function setVaultConfigs(VaultConfig[] calldata configs) external onlyRole(VAULT_MANAGER_ROLE) {
        uint256 totalTargetBps = 0;
        for (uint256 i = 0; i < configs.length; i++) {
            totalTargetBps += configs[i].targetBps;
        }
        if (totalTargetBps != BasisPointConstants.ONE_HUNDRED_PERCENT_BPS) {
            revert TotalAllocationInvalid(totalTargetBps);
        }

        _clearVaultConfigs();
        for (uint256 i = 0; i < configs.length; i++) {
            _addVaultConfig(configs[i]);
        }
    }

    /**
     * @notice Adds a vault configuration without enforcing total target-sum normalization.
     * @dev Does NOT validate that the sum of all targets equals 100%. This is intentional to
     *      allow emergency/operational changes. When totals differ from 100% across the active set:
     *      - Deposits/withdrawals still function; routing uses `targetBps` as-is (no normalization).
     *      - Behavior may become biased or perpetually chasing targets. Prefer calling
     *        `setVaultConfigs` afterward to restore a strict 100% total.
     */
    function addVaultConfig(VaultConfig calldata config) external onlyRole(VAULT_MANAGER_ROLE) {
        _addVaultConfig(config);
    }

    /**
     * @notice Adds a vault configuration without enforcing total target-sum normalization.
     * @dev See notes on the overload above. Intended for operational flexibility.
     */
    function addVaultConfig(
        address vault,
        address adapter,
        uint256 targetBps,
        VaultStatus status
    ) external onlyRole(VAULT_MANAGER_ROLE) {
        _addVaultConfig(VaultConfig({ strategyVault: vault, adapter: adapter, targetBps: targetBps, status: status }));
    }

    /**
     * @notice Updates a vault configuration without enforcing total target-sum normalization.
     * @dev Does NOT enforce that the new overall total equals 100%. Safe to use during
     *      emergencies (e.g., temporarily setting a vault inactive). Consider following
     *      up with `setVaultConfigs` to re-establish an exact 100% layout.
     */
    function updateVaultConfig(VaultConfig calldata config) external onlyRole(VAULT_MANAGER_ROLE) {
        _updateVaultConfig(config);
    }

    /**
     * @notice Updates a vault configuration without enforcing total target-sum normalization.
     * @dev See notes on the overload above. Targets are used as-is by the router.
     */
    function updateVaultConfig(
        address vault,
        address adapter,
        uint256 targetBps,
        VaultStatus status
    ) external onlyRole(VAULT_MANAGER_ROLE) {
        _updateVaultConfig(
            VaultConfig({ strategyVault: vault, adapter: adapter, targetBps: targetBps, status: status })
        );
    }

    /**
     * @notice Updates only the status of a vault configuration.
     * @dev Convenience helper for governance to quickly quarantine or reactivate vaults without
     *      needing to resupply adapter/target details.
     * @param vault Address of the vault to update.
     * @param status New status to set.
     */
    function setVaultStatus(address vault, VaultStatus status) external onlyRole(VAULT_MANAGER_ROLE) {
        if (!vaultExists[vault]) revert VaultNotFound(vault);
        uint256 index = vaultToIndex[vault];
        VaultConfig storage config = vaultConfigs[index];
        if (config.status == status) {
            return;
        }

        config.status = status;

        emit VaultConfigUpdated(config.strategyVault, config.adapter, config.targetBps, status);
    }

    /**
     * @notice Removes a vault configuration without rebalancing or normalizing targets.
     * @dev Does NOT enforce that the remaining targets sum to 100%. Routing continues to
     *      use the remaining `targetBps` values verbatim. For precise allocation behavior,
     *      call `setVaultConfigs` after removals to rebalance back to 100%.
     */
    function removeVault(address vault) external onlyRole(VAULT_MANAGER_ROLE) {
        if (!vaultExists[vault]) revert VaultNotFound(vault);
        _removeVault(vault);
    }

    /**
     * @notice Alias for removing a vault configuration (no allocation-sum enforcement).
     * @dev Identical behavior to `removeVault`. Totals may deviate from 100% after removal.
     *      This is acceptable for emergency operations. Prefer re-normalizing with
     *      `setVaultConfigs` when feasible.
     */
    function removeVaultConfig(address vault) external onlyRole(VAULT_MANAGER_ROLE) {
        if (!vaultExists[vault]) revert VaultNotFound(vault);
        _removeVault(vault);
    }

    function suspendVaultForRemoval(address vault) external onlyRole(VAULT_MANAGER_ROLE) {
        _suspendVaultForRemoval(vault);
    }

    /**
     * @notice Marks a vault inactive without altering its stored `targetBps`.
     * @dev This does NOT change totals or perform normalization. The inactive vault is
     *      excluded from routing decisions, and the active-set targets are used as-is.
     *      After emergencies, call `setVaultConfigs` if you require active targets to
     *      sum to exactly 100% again.
     */
    function emergencyPauseVault(address vault) external onlyRole(PAUSER_ROLE) {
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

    function setMaxVaultCount(uint256 _maxVaultCount) external onlyRole(CONFIG_MANAGER_ROLE) {
        if (_maxVaultCount == 0 || _maxVaultCount < vaultConfigs.length) {
            revert InvalidMaxVaultCount(_maxVaultCount);
        }

        uint256 oldValue = maxVaultCount;
        maxVaultCount = _maxVaultCount;
        emit MaxVaultCountUpdated(oldValue, _maxVaultCount);
    }

    function pause() external onlyRole(PAUSER_ROLE) {
        _pause();
    }

    function unpause() external onlyRole(PAUSER_ROLE) {
        _unpause();
    }

    // --- View Functions ---

    function getCurrentAllocations()
        external
        view
        returns (
            address[] memory vaults,
            uint256[] memory currentAllocations,
            uint256[] memory targetAllocations,
            uint256 totalBalance
        )
    {
        return _getAllVaultsAndAllocations();
    }

    function getVaultConfig(address vault) external view returns (VaultConfig memory config) {
        if (!vaultExists[vault]) revert VaultNotFound(vault);
        return vaultConfigs[vaultToIndex[vault]];
    }

    function getVaultCount() external view returns (uint256) {
        return vaultConfigs.length;
    }

    function isVaultHealthyForDeposits(address vault) external view returns (bool healthy) {
        return _isVaultHealthyForDeposits(vault);
    }

    function isVaultHealthyForWithdrawals(address vault) external view returns (bool healthy) {
        return _isVaultHealthyForWithdrawals(vault);
    }

    /**
     * @notice Returns strategy vaults that are active and healthy for deposits.
     * @dev Uses deposit health checks; does not guarantee suitability for withdrawals.
     *      Prefer explicitness over the old generic name to avoid ambiguity.
     */
    function getActiveVaultsForDeposits() external view returns (address[] memory activeVaults) {
        (activeVaults, , ) = _getActiveVaultsAndAllocations(OperationType.DEPOSIT);
    }

    /**
     * @notice Returns strategy vaults that are active and healthy for withdrawals.
     * @dev Uses withdrawal health checks; does not guarantee suitability for deposits.
     */
    function getActiveVaultsForWithdrawals() external view returns (address[] memory activeVaults) {
        (activeVaults, , ) = _getActiveVaultsAndAllocations(OperationType.WITHDRAWAL);
    }

    function getVaultConfigByIndex(uint256 index) external view returns (VaultConfig memory config) {
        if (index >= vaultConfigs.length) revert IndexOutOfBounds();
        return vaultConfigs[index];
    }

    function getMaxSingleVaultWithdraw() external view returns (uint256) {
        return _maxSingleVaultWithdraw();
    }

    function _maxSingleVaultWithdraw() internal view returns (uint256 maxAssets) {
        (address[] memory activeVaults, , ) = _getActiveVaultsAndAllocations(OperationType.WITHDRAWAL);

        for (uint256 i = 0; i < activeVaults.length; i++) {
            uint256 vaultBalance = _getVaultBalance(activeVaults[i]);
            if (vaultBalance > maxAssets) {
                maxAssets = vaultBalance;
            }
        }
    }

    // --- Internal Helpers ---

    function _depositToVaultAtomically(address vault, uint256 dStableAmount) internal returns (uint256 actualShares) {
        VaultConfig memory config = _getVaultConfig(vault);
        if (!_isVaultStatusEligible(config.status, OperationType.DEPOSIT)) {
            revert VaultNotActive(vault);
        }

        address adapterAddress = _strategyShareToAdapter[vault];
        if (adapterAddress == address(0)) revert AdapterNotFound(vault);
        IDStableConversionAdapterV2 adapter = IDStableConversionAdapterV2(adapterAddress);

        (address vaultExpected, uint256 expectedShares) = adapter.previewDepositIntoStrategy(dStableAmount);
        if (vaultExpected != vault) revert AdapterAssetMismatch(adapterAddress, vault, vaultExpected);

        uint256 beforeBal = IERC20(vault).balanceOf(address(collateralVault));

        IERC20(dStable).forceApprove(adapterAddress, dStableAmount);
        (address actualVault, uint256 reportedShares) = adapter.depositIntoStrategy(dStableAmount);
        if (actualVault != vault) {
            revert AdapterAssetMismatch(adapterAddress, vault, actualVault);
        }

        uint256 afterBal = IERC20(vault).balanceOf(address(collateralVault));
        actualShares = afterBal - beforeBal;

        if (actualShares < expectedShares) {
            revert SlippageCheckFailed(vault, actualShares, expectedShares);
        }

        if (actualShares != reportedShares) {
            revert AdapterSharesMismatch(actualShares, reportedShares);
        }

        IERC20(dStable).forceApprove(adapterAddress, 0);
        return actualShares;
    }

    function _vaultCanSatisfyWithdrawal(address vault, uint256 dStableAmount) internal view returns (bool) {
        if (dStableAmount == 0) {
            return true;
        }

        try IERC4626(vault).previewWithdraw(dStableAmount) returns (uint256 strategyShareAmount) {
            if (strategyShareAmount == 0) {
                return false;
            }

            uint256 availableShares = IERC20(vault).balanceOf(address(collateralVault));
            return strategyShareAmount <= availableShares;
        } catch {
            return false;
        }
    }

    function _withdrawFromVaultAtomically(
        address vault,
        uint256 dStableAmount
    ) internal returns (uint256 receivedDStable) {
        VaultConfig memory config = _getVaultConfig(vault);
        if (!_isVaultStatusEligible(config.status, OperationType.WITHDRAWAL)) {
            revert VaultNotActive(vault);
        }

        address adapter = _strategyShareToAdapter[vault];
        if (adapter == address(0)) revert AdapterNotFound(vault);
        IDStableConversionAdapterV2 conversionAdapter = IDStableConversionAdapterV2(adapter);

        // Determine how many strategy shares correspond to the requested dStable amount
        uint256 strategyShareAmount = IERC4626(vault).previewWithdraw(dStableAmount);
        if (strategyShareAmount == 0) revert ZeroPreviewWithdrawAmount(vault);

        uint256 availableShares = IERC20(vault).balanceOf(address(collateralVault));
        if (strategyShareAmount > availableShares) {
            // Don't silently truncate - revert if insufficient shares
            revert NoLiquidityAvailable();
        }

        collateralVault.transferStrategyShares(vault, strategyShareAmount, address(this));
        IERC20(vault).forceApprove(adapter, strategyShareAmount);

        receivedDStable = conversionAdapter.withdrawFromStrategy(strategyShareAmount);
        if (receivedDStable < dStableAmount) {
            revert SlippageCheckFailed(vault, receivedDStable, dStableAmount);
        }

        IERC20(vault).forceApprove(adapter, 0);
        return receivedDStable;
    }

    function _withdrawSharesFromVaultAtomically(
        address vault,
        uint256 shares
    ) internal returns (uint256 receivedDStable) {
        VaultConfig memory config = _getVaultConfig(vault);

        if (!_isVaultStatusEligible(config.status, OperationType.WITHDRAWAL)) {
            revert VaultNotActive(vault);
        }

        address adapter = _strategyShareToAdapter[vault];
        if (adapter == address(0)) revert AdapterNotFound(vault);
        IDStableConversionAdapterV2 conversionAdapter = IDStableConversionAdapterV2(adapter);

        uint256 availableShares = IERC20(vault).balanceOf(address(collateralVault));
        if (shares > availableShares) revert NoLiquidityAvailable();

        collateralVault.transferStrategyShares(vault, shares, address(this));
        IERC20(vault).forceApprove(adapter, shares);

        try conversionAdapter.withdrawFromStrategy(shares) returns (uint256 redeemed) {
            receivedDStable = redeemed;
            IERC20(vault).forceApprove(adapter, 0);
        } catch {
            // No cleanup needed before revert; state will roll back
            revert ShareWithdrawalConversionFailed();
        }

        return receivedDStable;
    }

    function _executeGrossWithdrawals(
        address[] calldata vaults,
        uint256[] memory grossRequests
    ) internal returns (uint256 totalWithdrawn) {
        for (uint256 i = 0; i < vaults.length; i++) {
            uint256 grossRequest = grossRequests[i];
            if (grossRequest > 0) {
                totalWithdrawn += _withdrawFromVaultAtomically(vaults[i], grossRequest);
            }
        }
    }

    function _executeWithdrawShares(
        address[] calldata vaults,
        uint256[] calldata shareAmounts
    ) internal returns (uint256 totalWithdrawn) {
        for (uint256 i = 0; i < vaults.length; i++) {
            uint256 shareAmount = shareAmounts[i];
            if (shareAmount > 0) {
                totalWithdrawn += _withdrawSharesFromVaultAtomically(vaults[i], shareAmount);
            }
        }
    }

    function _getActiveVaultsAndAllocations(
        OperationType operationType
    )
        internal
        view
        returns (address[] memory activeVaults, uint256[] memory currentAllocations, uint256[] memory targetAllocations)
    {
        uint256 activeCount = 0;
        for (uint256 i = 0; i < vaultConfigs.length; i++) {
            VaultConfig memory config = vaultConfigs[i];
            if (!_isVaultEligibleForOperation(config, operationType)) continue;
            if (!_isVaultHealthyForOperation(config.strategyVault, operationType)) continue;
            activeCount++;
        }

        if (activeCount == 0) return (new address[](0), new uint256[](0), new uint256[](0));

        activeVaults = new address[](activeCount);
        uint256[] memory balances = new uint256[](activeCount);
        targetAllocations = new uint256[](activeCount);

        uint256 activeIndex = 0;
        for (uint256 i = 0; i < vaultConfigs.length; i++) {
            VaultConfig memory config = vaultConfigs[i];
            if (!_isVaultEligibleForOperation(config, operationType)) continue;
            if (!_isVaultHealthyForOperation(config.strategyVault, operationType)) continue;

            activeVaults[activeIndex] = config.strategyVault;
            balances[activeIndex] = _getVaultBalance(config.strategyVault);
            targetAllocations[activeIndex] = config.targetBps;
            activeIndex++;
        }

        (currentAllocations, ) = AllocationCalculator.calculateCurrentAllocations(balances);
        return (activeVaults, currentAllocations, targetAllocations);
    }

    function _isVaultEligibleForOperation(
        VaultConfig memory config,
        OperationType operationType
    ) internal pure returns (bool) {
        if (!_isVaultStatusEligible(config.status, operationType)) {
            return false;
        }

        if (config.adapter == address(0)) {
            return false;
        }

        if (operationType == OperationType.DEPOSIT && config.targetBps == 0) {
            return false;
        }

        return true;
    }

    function _isVaultStatusEligible(VaultStatus status, OperationType operationType) internal pure returns (bool) {
        if (operationType == OperationType.DEPOSIT) {
            return status == VaultStatus.Active;
        }

        return status == VaultStatus.Active || status == VaultStatus.Impaired;
    }

    function _getAllVaultsAndAllocations()
        internal
        view
        returns (
            address[] memory vaults,
            uint256[] memory currentAllocations,
            uint256[] memory targetAllocations,
            uint256 totalBalance
        )
    {
        uint256 vaultCount = vaultConfigs.length;
        vaults = new address[](vaultCount);
        uint256[] memory balances = new uint256[](vaultCount);
        targetAllocations = new uint256[](vaultCount);

        for (uint256 i = 0; i < vaultCount; i++) {
            VaultConfig memory config = vaultConfigs[i];
            vaults[i] = config.strategyVault;
            balances[i] = _getVaultBalance(config.strategyVault);
            targetAllocations[i] = config.targetBps;
        }

        (currentAllocations, totalBalance) = AllocationCalculator.calculateCurrentAllocations(balances);
    }

    function _getVaultBalance(address vault) internal view returns (uint256 balance) {
        return _getVaultBalanceWithAdapter(vault, address(0));
    }

    function _getVaultBalanceWithAdapter(address vault, address adapter) internal view returns (uint256 balance) {
        try IERC20(vault).balanceOf(address(collateralVault)) returns (uint256 shares) {
            if (shares == 0) return 0;

            if (adapter == address(0)) {
                adapter = _strategyShareToAdapter[vault];
            }
            if (adapter == address(0)) return 0;

            try IDStableConversionAdapterV2(adapter).strategyShareValueInDStable(vault, shares) returns (
                uint256 value
            ) {
                return value;
            } catch {
                return 0;
            }
        } catch {
            return 0;
        }
    }

    function _getVaultConfig(address vault) internal view returns (VaultConfig memory config) {
        if (!vaultExists[vault]) revert VaultNotFound(vault);
        return vaultConfigs[vaultToIndex[vault]];
    }

    function _isVaultHealthyForOperation(
        address vault,
        OperationType operationType
    ) internal view returns (bool healthy) {
        if (operationType == OperationType.DEPOSIT) {
            return _isVaultHealthyForDeposits(vault);
        } else {
            return _isVaultHealthyForWithdrawals(vault);
        }
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

    function _totalSystemLiquidity(address[] memory activeVaults) internal view returns (uint256 totalLiquidity) {
        for (uint256 i = 0; i < activeVaults.length; i++) {
            uint256 vaultShares = IERC20(activeVaults[i]).balanceOf(address(collateralVault));
            if (vaultShares == 0) continue;
            try IERC4626(activeVaults[i]).previewRedeem(vaultShares) returns (uint256 assets) {
                totalLiquidity += assets;
            } catch {}
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
        for (uint256 i = 0; i < vaultConfigs.length; i++) {
            address vault = vaultConfigs[i].strategyVault;
            _suspendVaultForRemoval(vault);
            _removeAdapter(vault);
            delete vaultToIndex[vault];
            delete vaultExists[vault];
        }
        delete vaultConfigs;
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

        // Drop support in the collateral vault even if the position still holds dust so it stops affecting TVL.
        // Important in cases where the strategyShare is paused or otherwise non-transferrable
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
}
