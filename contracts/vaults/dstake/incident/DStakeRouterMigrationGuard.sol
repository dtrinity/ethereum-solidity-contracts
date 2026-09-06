// SPDX-License-Identifier: MIT
pragma solidity ^0.8.20;

import { IERC20 } from "@openzeppelin/contracts/token/ERC20/IERC20.sol";
import { IAccessControl } from "@openzeppelin/contracts/access/IAccessControl.sol";
import { DStakeRouterV2 } from "../DStakeRouterV2.sol";
import { DStakeRouterV2Storage } from "../DStakeRouterV2Storage.sol";

interface IMigrationToken {
    function router() external view returns (address);
    function collateralVault() external view returns (address);
    function totalAssets() external view returns (uint256);
    function totalSupply() external view returns (uint256);
    function asset() external view returns (address);
}

interface IMigrationCollateral {
    function dStakeToken() external view returns (address);
    function dStable() external view returns (address);
    function router() external view returns (address);
    function getSupportedStrategyShares() external view returns (address[] memory);
}

/**
 * @notice Transaction-boundary assertions for an ATOMIC timelock executeBatch.
 * @dev Grants NO authority and moves NO assets. Place begin() first and finish()
 *      last in the SAME executeBatch. Any failure rolls back the entire batch.
 *      Never schedule these calls as independently executable operations.
 *      Deliberately blocks nonzero legacy cash/shortfall; this is a zero-movement
 *      router replacement, not a mechanism for forgiving losses or stranding cash.
 */
contract DStakeRouterMigrationGuard {
    error MigrationCheckFailed(bytes32 check);
    error TimelockOnly();

    address public immutable timelock;
    address public immutable token;
    address public immutable collateral;
    address public immutable retiredDeployer;
    DStakeRouterV2 public immutable oldRouter;
    DStakeRouterV2 public immutable newRouter;
    bytes32 public immutable replacementCodeHash;

    uint8 public phase; // 0 unused, 1 begin executed, 2 migration verified
    uint256 private startingAssets;
    uint256 private startingSupply;
    address[] private shares;
    uint256[] private balances;

    bytes32 private constant ADMIN = bytes32(0);
    bytes32 private constant AUTHORIZED = keccak256("AUTHORIZED_CALLER_ROLE");
    bytes32 private constant ROUTER_ROLE = keccak256("ROUTER_ROLE");

    event MigrationVerified(
        address indexed previousRouter,
        address indexed replacementRouter,
        uint256 assets,
        uint256 supply
    );

    constructor(address timelock_, address token_, address collateral_, address old_, address new_, address deployer_) {
        require(timelock_ != address(0) && token_ != address(0) && collateral_ != address(0), "zero anchor");
        require(old_ != new_ && old_.code.length != 0 && new_.code.length != 0, "invalid routers");
        require(deployer_ != address(0) && deployer_ != timelock_, "invalid deployer");
        timelock = timelock_;
        token = token_;
        collateral = collateral_;
        oldRouter = DStakeRouterV2(old_);
        newRouter = DStakeRouterV2(new_);
        retiredDeployer = deployer_;
        replacementCodeHash = new_.codehash;
    }

    modifier onlyTimelock() {
        if (msg.sender != timelock) revert TimelockOnly();
        _;
    }

    function begin() external onlyTimelock {
        _check(phase == 0, "phase");
        _check(oldRouter.paused() && newRouter.paused(), "both-paused");
        _check(IMigrationToken(token).router() == address(oldRouter), "old-token-pointer");
        _check(IMigrationCollateral(collateral).router() == address(oldRouter), "old-vault-pointer");
        _check(IMigrationToken(token).collateralVault() == collateral, "token-vault");
        _check(address(newRouter).codehash == replacementCodeHash, "replacement-code");
        _check(newRouter.BACKING_GUARD_VERSION() == 2, "guard-version");
        _check(
            newRouter.dStakeToken() == token && address(newRouter.collateralVault()) == collateral,
            "new-immutables"
        );
        _check(oldRouter.currentShortfall() == 0 && newRouter.currentShortfall() == 0, "shortfall-not-zero");
        address asset = IMigrationToken(token).asset();
        _check(IMigrationCollateral(collateral).dStakeToken() == token, "vault-token");
        _check(IMigrationCollateral(collateral).dStable() == asset, "vault-asset");
        _check(IERC20(asset).balanceOf(address(oldRouter)) == 0, "legacy-cash-not-zero");
        _check(IERC20(asset).allowance(token, address(oldRouter)) == 0, "legacy-allowance");
        _check(IERC20(asset).balanceOf(address(newRouter)) == 0, "new-cash-not-zero");
        _check(newRouter.withdrawalFeeBps() == oldRouter.withdrawalFeeBps(), "fee");
        _check(newRouter.depositCap() == oldRouter.depositCap(), "deposit-cap");
        _check(newRouter.reinvestIncentiveBps() == oldRouter.reinvestIncentiveBps(), "incentive");
        _check(newRouter.dustTolerance() == oldRouter.dustTolerance(), "dust");
        _check(newRouter.maxVaultCount() == oldRouter.maxVaultCount(), "max-vaults");
        _check(newRouter.defaultDepositStrategyShare() == address(0), "default-must-be-clear");

        startingAssets = IMigrationToken(token).totalAssets();
        startingSupply = IMigrationToken(token).totalSupply();
        shares = IMigrationCollateral(collateral).getSupportedStrategyShares();
        _check(shares.length == newRouter.getVaultCount(), "complete-inventory");
        for (uint256 i; i < shares.length; ++i) {
            address share = shares[i];
            balances.push(IERC20(share).balanceOf(collateral));
            address adapter = oldRouter.strategyShareToAdapter(share);
            _check(adapter != address(0) && adapter == newRouter.strategyShareToAdapter(share), "adapter-map");
            DStakeRouterV2Storage.VaultConfig memory config = newRouter.getVaultConfig(share);
            DStakeRouterV2Storage.VaultConfig memory previous = oldRouter.getVaultConfig(share);
            _check(config.adapter == adapter && config.targetBps == previous.targetBps, "vault-config");
            _check(config.status == DStakeRouterV2Storage.VaultStatus.Suspended, "vault-not-suspended");
        }
        phase = 1;
    }

    function finish() external onlyTimelock {
        _check(phase == 1, "phase");
        _check(oldRouter.paused() && newRouter.paused(), "both-paused");
        _check(IMigrationToken(token).router() == address(newRouter), "new-token-pointer");
        _check(IMigrationCollateral(collateral).router() == address(newRouter), "new-vault-pointer");
        _check(IMigrationToken(token).totalSupply() == startingSupply, "supply-changed");
        _check(IMigrationToken(token).totalAssets() == startingAssets, "backing-changed");
        _check(!IAccessControl(collateral).hasRole(ROUTER_ROLE, address(oldRouter)), "old-custody-role");
        _check(IAccessControl(collateral).hasRole(ROUTER_ROLE, address(newRouter)), "new-custody-role");
        for (uint256 i; i < shares.length; ++i) {
            _check(IERC20(shares[i]).balanceOf(collateral) == balances[i], "strategy-balance-changed");
            address adapter = newRouter.strategyShareToAdapter(shares[i]);
            _check(!IAccessControl(adapter).hasRole(AUTHORIZED, address(oldRouter)), "old-adapter-caller");
            _check(IAccessControl(adapter).hasRole(AUTHORIZED, address(newRouter)), "new-adapter-caller");
        }
        bytes32[7] memory roles = [
            ADMIN,
            keccak256("ADAPTER_MANAGER_ROLE"),
            keccak256("CONFIG_MANAGER_ROLE"),
            keccak256("VAULT_MANAGER_ROLE"),
            keccak256("PAUSER_ROLE"),
            keccak256("STRATEGY_REBALANCER_ROLE"),
            keccak256("DSTAKE_TOKEN_ROLE")
        ];
        for (uint256 i; i < roles.length; ++i) {
            _check(!newRouter.hasRole(roles[i], retiredDeployer), "deployer-authority");
            if (i != roles.length - 1) _check(newRouter.hasRole(roles[i], timelock), "timelock-authority");
        }
        _check(newRouter.hasRole(keccak256("DSTAKE_TOKEN_ROLE"), token), "token-role");
        phase = 2;
        emit MigrationVerified(address(oldRouter), address(newRouter), startingAssets, startingSupply);
    }

    function _check(bool condition, bytes32 label) private pure {
        if (!condition) revert MigrationCheckFailed(label);
    }
}
