// SPDX-License-Identifier: MIT
pragma solidity ^0.8.20;

import { AccessControl } from "@openzeppelin/contracts/access/AccessControl.sol";
import { Pausable } from "@openzeppelin/contracts/utils/Pausable.sol";
import { ReentrancyGuard } from "@openzeppelin/contracts/utils/ReentrancyGuard.sol";

import { BasisPointConstants } from "../../common/BasisPointConstants.sol";
import { IDStakeCollateralVaultV2 } from "./interfaces/IDStakeCollateralVaultV2.sol";

/**
 * @title DStakeRouterV2Storage
 * @notice Shared storage layout for {@link DStakeRouterV2} and its delegatecall modules.
 * @dev Inherit this contract to guarantee storage slot alignment across the router and modules.
 */
abstract contract DStakeRouterV2Storage is AccessControl, ReentrancyGuard, Pausable {
    // --- Errors ---
    error ZeroAddress();

    // --- Immutable addresses ---
    address internal immutable _dStakeToken;
    IDStakeCollateralVaultV2 internal immutable _collateralVault;
    address internal immutable _dStable;

    // --- Mutable configuration ---
    uint256 public dustTolerance;
    uint256 public maxVaultCount;
    uint256 public depositCap;
    uint256 public settlementShortfall;
    uint256 public reinvestIncentiveBps;
    uint256 internal _withdrawalFeeBps;

    // --- Adapter routing ---
    mapping(address => address) internal _strategyShareToAdapter;
    address internal _defaultDepositStrategyShare;

    // --- Vault configuration ---
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

    // --- Module wiring ---
    address public governanceModule;
    address public rebalanceModule;

    // --- Constants ---
    uint256 public constant MAX_REINVEST_INCENTIVE_BPS = BasisPointConstants.ONE_PERCENT_BPS * 20;
    uint256 public constant MAX_WITHDRAWAL_FEE_BPS = BasisPointConstants.ONE_PERCENT_BPS;
    bytes32 internal constant STORAGE_FINGERPRINT = keccak256("dtrinity.dstake.router.v2.storage:1");

    constructor(address dStakeToken_, address collateralVault_) {
        if (dStakeToken_ == address(0) || collateralVault_ == address(0)) {
            revert ZeroAddress();
        }

        _dStakeToken = dStakeToken_;
        _collateralVault = IDStakeCollateralVaultV2(collateralVault_);
        address dStableAddress = _collateralVault.dStable();
        if (dStableAddress == address(0)) {
            revert ZeroAddress();
        }
        _dStable = dStableAddress;

        // Defaults mirror the original router constructor.
        dustTolerance = 1;
        maxVaultCount = 10;
    }
}
