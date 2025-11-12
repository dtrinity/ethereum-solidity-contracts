// SPDX-License-Identifier: MIT
pragma solidity ^0.8.20;

import { IERC20 } from "@openzeppelin/contracts/token/ERC20/IERC20.sol";
import { SafeERC20 } from "@openzeppelin/contracts/token/ERC20/utils/SafeERC20.sol";
import { IDStakeCollateralVaultV2 } from "./interfaces/IDStakeCollateralVaultV2.sol";
import { IDStableConversionAdapterV2 } from "./interfaces/IDStableConversionAdapterV2.sol";
import { BasisPointConstants } from "../../common/BasisPointConstants.sol";
import { AccessControl } from "@openzeppelin/contracts/access/AccessControl.sol";
import { EnumerableSet } from "@openzeppelin/contracts/utils/structs/EnumerableSet.sol";
import { ReentrancyGuard } from "@openzeppelin/contracts/utils/ReentrancyGuard.sol";

// ---------------------------------------------------------------------------
// Internal interface to query the router's public mapping without importing the
// full router contract (avoids circular dependencies).
// ---------------------------------------------------------------------------
interface IAdapterProvider {
    function strategyShareToAdapter(address) external view returns (address);
}

/**
 * @title DStakeCollateralVaultV2
 * @notice Holds various yield-bearing/convertible ERC20 tokens (`strategy shares`) managed by dSTAKE.
 * @dev Calculates the total value of these assets in terms of the underlying dStable asset
 *      using registered adapters. This contract is non-upgradeable but replaceable via
 *      DStakeTokenV2 governance.
 *      Uses AccessControl for role-based access control.
 */
contract DStakeCollateralVaultV2 is IDStakeCollateralVaultV2, AccessControl, ReentrancyGuard {
    using SafeERC20 for IERC20;
    using EnumerableSet for EnumerableSet.AddressSet;

    // --- Roles ---
    bytes32 public constant ROUTER_ROLE = keccak256("ROUTER_ROLE");

    // --- Errors ---
    error ZeroAddress();
    error StrategyShareNotSupported(address strategyShare);
    error StrategyShareAlreadySupported(address strategyShare);
    error NonZeroBalance(address asset);
    error CannotRescueRestrictedToken(address token);
    error ETHTransferFailed(address receiver, uint256 amount);
    error AdapterValuationUnavailable(address strategyShare);
    error RemainingBalanceAboveAbsoluteDust(address strategyShare, uint256 value, uint256 maxValue);
    error RemainingBalanceAboveRelativeDust(address strategyShare, uint256 value, uint256 maxValue);

    // --- Events ---
    event TokenRescued(address indexed token, address indexed receiver, uint256 amount);
    event ETHRescued(address indexed receiver, uint256 amount);

    // --- State ---
    address public immutable dStakeToken; // The ERC4626 DStakeToken this vault serves
    address public immutable dStable; // The underlying dStable asset address

    address public router; // The DStakeRouter allowed to interact

    EnumerableSet.AddressSet private _supportedStrategyShares; // Set of supported strategy shares

    uint256 public constant ABSOLUTE_DUST_THRESHOLD = 1e6; // 1 dStable unit assuming 6 decimals
    uint256 public constant RELATIVE_DUST_THRESHOLD_BPS = 10 * BasisPointConstants.ONE_BPS; // 0.1%

    // --- Constructor ---
    constructor(address _dStakeVaultShare, address _dStableAsset) {
        if (_dStakeVaultShare == address(0) || _dStableAsset == address(0)) {
            revert ZeroAddress();
        }
        dStakeToken = _dStakeVaultShare;
        dStable = _dStableAsset;

        // Set up the DEFAULT_ADMIN_ROLE initially to the contract deployer
        _grantRole(DEFAULT_ADMIN_ROLE, msg.sender);
    }

    // --- External Views (IDStakeCollateralVaultV2 Interface) ---

    /**
     * @inheritdoc IDStakeCollateralVaultV2
     */
    function totalValueInDStable() external view override returns (uint256) {
        return _totalValueInDStable();
    }

    // --- External Functions (Router Interactions) ---

    /**
     * @notice Transfers `amount` of `strategyShare` from this vault to `recipient`.
     * @dev Only callable by the registered router (ROUTER_ROLE).
     * @param strategyShare The strategy share to transfer
     * @param amount Amount of tokens to transfer
     * @param recipient Address to receive the tokens
     */
    function transferStrategyShares(
        address strategyShare,
        uint256 amount,
        address recipient
    ) external onlyRole(ROUTER_ROLE) {
        if (!_isSupported(strategyShare)) revert StrategyShareNotSupported(strategyShare);
        IERC20(strategyShare).safeTransfer(recipient, amount);
    }

    /**
     * @notice Legacy alias maintained for backwards compatibility with existing integration tests.
     */
    function sendAsset(address strategyShare, uint256 amount, address recipient) external onlyRole(ROUTER_ROLE) {
        if (!_isSupported(strategyShare)) revert StrategyShareNotSupported(strategyShare);
        IERC20(strategyShare).safeTransfer(recipient, amount);
    }

    /**
     * @notice Adds a new supported strategy share. Can only be invoked by the router.
     * @dev Only callable by the registered router (ROUTER_ROLE).
     * @param strategyShare Address of the strategy share to add
     */
    function addSupportedStrategyShare(address strategyShare) external onlyRole(ROUTER_ROLE) {
        if (strategyShare == address(0)) revert ZeroAddress();
        if (_isSupported(strategyShare)) revert StrategyShareAlreadySupported(strategyShare);

        _supportedStrategyShares.add(strategyShare);
        emit StrategyShareSupported(strategyShare);
    }

    /**
     * @notice Removes a supported strategy share. Can only be invoked by the router.
     * @dev Only callable by the registered router (ROUTER_ROLE).
     * @param strategyShare Address of the strategy share to remove
     */
    function removeSupportedStrategyShare(address strategyShare) external onlyRole(ROUTER_ROLE) {
        if (!_isSupported(strategyShare)) revert StrategyShareNotSupported(strategyShare);

        uint256 balance = IERC20(strategyShare).balanceOf(address(this));
        if (balance > 0) {
            uint256 remainingValue = _strategyShareValueInDStable(strategyShare, balance);
            if (remainingValue > ABSOLUTE_DUST_THRESHOLD) {
                revert RemainingBalanceAboveAbsoluteDust(strategyShare, remainingValue, ABSOLUTE_DUST_THRESHOLD);
            }

            uint256 totalValue = _totalValueInDStable();
            uint256 maxRelativeDust = (totalValue * RELATIVE_DUST_THRESHOLD_BPS) /
                BasisPointConstants.ONE_HUNDRED_PERCENT_BPS;

            if (remainingValue > maxRelativeDust) {
                revert RemainingBalanceAboveRelativeDust(strategyShare, remainingValue, maxRelativeDust);
            }
        }

        _supportedStrategyShares.remove(strategyShare);
        emit StrategyShareRemoved(strategyShare);
    }

    // --- Governance Functions ---

    /**
     * @notice Sets the router address. Grants ROUTER_ROLE to new router and
     *         revokes it from the previous router.
     * @dev Only callable by DEFAULT_ADMIN_ROLE.
     * @param _newRouter Address of the new router
     */
    function setRouter(address _newRouter) external onlyRole(DEFAULT_ADMIN_ROLE) {
        if (_newRouter == address(0)) revert ZeroAddress();

        // Revoke role from old router
        if (router != address(0)) {
            _revokeRole(ROUTER_ROLE, router);
        }

        _grantRole(ROUTER_ROLE, _newRouter);
        router = _newRouter;
        emit RouterSet(_newRouter);
    }

    // --- Internal Utilities ---

    function _isSupported(address strategyShare) private view returns (bool) {
        return _supportedStrategyShares.contains(strategyShare);
    }

    // --- External Views ---

    /**
     * @notice Returns the strategy share at `index` from the internal supported set.
     */
    function supportedStrategyShares(uint256 index) external view override returns (address) {
        return _supportedStrategyShares.at(index);
    }

    /**
     * @notice Returns the entire list of supported strategy shares. Useful for UIs & off-chain tooling.
     */
    function getSupportedStrategyShares() external view returns (address[] memory) {
        return _supportedStrategyShares.values();
    }

    function _strategyShareValueInDStable(address strategyShare, uint256 balance) private view returns (uint256) {
        if (balance == 0) {
            return 0;
        }

        address adapterAddress = IAdapterProvider(router).strategyShareToAdapter(strategyShare);
        if (adapterAddress == address(0)) {
            revert AdapterValuationUnavailable(strategyShare);
        }

        return IDStableConversionAdapterV2(adapterAddress).strategyShareValueInDStable(strategyShare, balance);
    }

    function _totalValueInDStable() private view returns (uint256 dStableValue) {
        uint256 len = _supportedStrategyShares.length();
        for (uint256 i = 0; i < len; i++) {
            address strategyShare = _supportedStrategyShares.at(i);
            uint256 balance = IERC20(strategyShare).balanceOf(address(this));
            if (balance == 0) continue;

            dStableValue += _strategyShareValueInDStable(strategyShare, balance);
        }
    }

    // --- Recovery Functions ---

    /**
     * @notice Rescues tokens accidentally sent to the contract
     * @dev Cannot rescue supported strategy shares or the dStable token
     * @param token Address of the token to rescue
     * @param receiver Address to receive the rescued tokens
     * @param amount Amount of tokens to rescue
     */
    function rescueToken(
        address token,
        address receiver,
        uint256 amount
    ) external onlyRole(DEFAULT_ADMIN_ROLE) nonReentrant {
        if (receiver == address(0)) revert ZeroAddress();

        // Check if token is a supported asset
        if (_isSupported(token)) {
            revert CannotRescueRestrictedToken(token);
        }

        // Check if token is the dStable token
        if (token == dStable) {
            revert CannotRescueRestrictedToken(token);
        }

        // Rescue the token
        IERC20(token).safeTransfer(receiver, amount);
        emit TokenRescued(token, receiver, amount);
    }

    /**
     * @notice Rescues ETH accidentally sent to the contract
     * @param receiver Address to receive the rescued ETH
     * @param amount Amount of ETH to rescue
     */
    function rescueETH(address receiver, uint256 amount) external onlyRole(DEFAULT_ADMIN_ROLE) nonReentrant {
        if (receiver == address(0)) revert ZeroAddress();

        (bool success, ) = receiver.call{ value: amount }("");
        if (!success) revert ETHTransferFailed(receiver, amount);

        emit ETHRescued(receiver, amount);
    }

    /**
     * @notice Allows the contract to receive ETH
     */
    receive() external payable {}
}
