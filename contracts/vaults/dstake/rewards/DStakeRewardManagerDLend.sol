// SPDX-License-Identifier: MIT
pragma solidity ^0.8.20;

import { DStakeRewardManagerBase } from "./DStakeRewardManagerBase.sol";
import { IStaticATokenLM } from "../../atoken_wrapper/interfaces/IStaticATokenLM.sol";
import { IERC20 } from "@openzeppelin/contracts/token/ERC20/IERC20.sol";
import { SafeERC20 } from "@openzeppelin/contracts/token/ERC20/utils/SafeERC20.sol";

interface IStaticATokenRewardsController {
    function REWARDS_CONTROLLER() external view returns (address);
}

/**
 * @title DStakeRewardManagerDLend
 * @notice Manages claiming of dLEND rewards earned by a specific StaticATokenLM wrapper
 *         (associated with a DStakeCollateralVault) and compounds dStable (provided by a caller)
 *         into the DStakeCollateralVault.
 * @dev Implements the intentionally permissionless dSTAKE reward auction.
 *      The caller of `compoundRewards` provides dStable (the exchangeAsset). This contract
 *      then claims the collateral vault's holder-level rewards from `targetStaticATokenWrapper`.
 *      The net rewards (after treasury fee) are sent to the receiver specified by the caller.
 *      Before claims, the provided dStable is converted to the DStakeCollateralVault's
 *      default deposit asset and deposited into the vault.
 */
contract DStakeRewardManagerDLend is DStakeRewardManagerBase {
    using SafeERC20 for IERC20;

    // --- State ---
    address public dLendRewardsController; // Must match the wrapper's actual controller
    address public immutable targetStaticATokenWrapper; // The StaticATokenLM instance earning rewards
    address public immutable dLendAssetToClaimFor; // The actual aToken in dLEND held by the wrapper

    // --- Events ---
    event DLendRewardsControllerUpdated(address oldController, address newController);
    event EmergencyWithdraw(address indexed token, uint256 amount, address indexed recipient);

    // --- Errors ---
    error InvalidRouter();
    error WrapperConfigurationMismatch();
    error InvalidAdapter(address adapter);
    error AdapterReturnedUnexpectedAsset(address expected, address actual);
    error DefaultDepositAssetNotSet();
    error AdapterNotSetForDefaultAsset();
    // Errors also used/defined in RewardClaimable but declared here for clarity if inherited versions are not picked up
    error ZeroAddress();

    // --- Constructor ---
    constructor(
        address _dStakeCollateralVault,
        address _dStakeRouter,
        address _dLendRewardsController,
        address _targetStaticATokenWrapper,
        address _dLendAssetToClaimFor,
        address _treasury,
        uint256 _maxTreasuryFeeBps,
        uint256 _initialTreasuryFeeBps,
        uint256 _initialExchangeThreshold
    )
        DStakeRewardManagerBase(
            _dStakeCollateralVault,
            _dStakeRouter,
            _treasury,
            _maxTreasuryFeeBps,
            _initialTreasuryFeeBps,
            _initialExchangeThreshold
        )
    {
        if (
            _dStakeCollateralVault == address(0) ||
            _dStakeRouter == address(0) ||
            _dLendRewardsController == address(0) ||
            _targetStaticATokenWrapper == address(0) ||
            _dLendAssetToClaimFor == address(0)
        ) {
            revert ZeroAddress();
        }
        if (exchangeAsset == address(0)) {
            revert InvalidRouter(); // dStable from collateral vault was zero, or vault address was wrong
        }

        if (
            IStaticATokenRewardsController(_targetStaticATokenWrapper).REWARDS_CONTROLLER() !=
            _dLendRewardsController ||
            address(IStaticATokenLM(_targetStaticATokenWrapper).aToken()) != _dLendAssetToClaimFor
        ) revert WrapperConfigurationMismatch();
        dLendRewardsController = _dLendRewardsController;
        targetStaticATokenWrapper = _targetStaticATokenWrapper;
        dLendAssetToClaimFor = _dLendAssetToClaimFor;

        // Grant roles to deployer
        _grantRole(DEFAULT_ADMIN_ROLE, msg.sender);
        _grantRole(REWARDS_MANAGER_ROLE, msg.sender);
    }

    /**
     * @dev Claims ONLY the collateral vault's holder-level entitlement through the
     *      wrapper, including tokens previously collected by any public caller.
     *      Never call the upstream controller with the wrapper as the reward user:
     *      doing so bypasses other shareholders' indices and claim bookkeeping.
     *      EmissionManager.setClaimer(collateralVault, this) is the required grant.
     */
    function _claimRewards(
        address[] calldata tokens,
        address receiver
    ) internal override returns (uint256[] memory amounts) {
        amounts = new uint256[](tokens.length);
        for (uint256 i; i < tokens.length; ++i) amounts[i] = IERC20(tokens[i]).balanceOf(receiver);
        IStaticATokenLM(targetStaticATokenWrapper).claimRewardsOnBehalf(dStakeCollateralVault, receiver, tokens);
        for (uint256 i; i < tokens.length; ++i) amounts[i] = IERC20(tokens[i]).balanceOf(receiver) - amounts[i];
    }

    // --- Admin Functions ---

    /**
     * @notice Sets the address of the dLEND RewardsController contract.
     * @dev Only callable by DEFAULT_ADMIN_ROLE.
     * @param _newDLendRewardsController The address of the new rewards controller.
     */
    function setDLendRewardsController(address _newDLendRewardsController) external onlyRole(DEFAULT_ADMIN_ROLE) {
        if (_newDLendRewardsController == address(0)) {
            revert ZeroAddress();
        }
        address oldController = address(dLendRewardsController);
        if (
            IStaticATokenRewardsController(targetStaticATokenWrapper).REWARDS_CONTROLLER() != _newDLendRewardsController
        ) {
            revert WrapperConfigurationMismatch();
        }
        dLendRewardsController = _newDLendRewardsController;
        emit DLendRewardsControllerUpdated(oldController, _newDLendRewardsController);
    }

    /**
     * @notice Emergency hook to sweep stranded tokens to the treasury
     * @param token Address of the ERC20 token to recover
     * @param amount Amount of tokens to transfer
     */
    function emergencyWithdraw(address token, uint256 amount) external onlyRole(DEFAULT_ADMIN_ROLE) nonReentrant {
        if (treasury == address(0) || token == address(0)) {
            revert ZeroAddress();
        }

        IERC20(token).safeTransfer(treasury, amount);
        emit EmergencyWithdraw(token, amount, treasury);
    }
}
