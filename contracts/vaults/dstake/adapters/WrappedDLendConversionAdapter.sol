// SPDX-License-Identifier: MIT
pragma solidity ^0.8.20;

import { IERC20 } from "@openzeppelin/contracts/token/ERC20/IERC20.sol";
import { SafeERC20 } from "@openzeppelin/contracts/token/ERC20/utils/SafeERC20.sol";
import { IDStableConversionAdapterV2 } from "../interfaces/IDStableConversionAdapterV2.sol";
import { IStaticATokenLM } from "../../atoken_wrapper/interfaces/IStaticATokenLM.sol"; // Interface for StaticATokenLM
import { IERC4626 } from "@openzeppelin/contracts/interfaces/IERC4626.sol";

/**
 * @title WrappedDLendConversionAdapter
 * @notice Adapter for converting between a dSTABLE asset (like dUSD) and a specific wrapped dLEND aToken
 *         (like wddUSD, implemented via StaticATokenLM). The wrapped dLEND token address must be provided at deployment.
 * @dev Implements the IDStableConversionAdapterV2 interface.
 *      Interacts with a specific StaticATokenLM contract provided at deployment.
 */
contract WrappedDLendConversionAdapter is IDStableConversionAdapterV2 {
    using SafeERC20 for IERC20;

    // --- Errors ---
    error ZeroAddress();
    error InvalidAmount();
    error StaticATokenUnderlyingMismatch(address expected, address actual);
    error IncorrectStrategyShare(address expected, address actual);

    // --- State ---
    address public immutable dStable; // The underlying dSTABLE asset (e.g., dUSD)
    IStaticATokenLM public immutable wrappedDLendToken; // The wrapped dLEND aToken (StaticATokenLM instance, e.g., wddUSD)
    address public immutable collateralVault; // The DStakeCollateralVaultV2 to deposit wrappedDLendToken into

    // --- Constructor ---
    /**
     * @param _dStable The address of the dSTABLE asset (e.g., dUSD)
     * @param _wrappedDLendToken The address of the wrapped dLEND token (StaticATokenLM, e.g., wddUSD)
     * @param _collateralVault The address of the DStakeCollateralVaultV2
     */
    constructor(address _dStable, address _wrappedDLendToken, address _collateralVault) {
        if (_dStable == address(0) || _wrappedDLendToken == address(0) || _collateralVault == address(0)) {
            revert ZeroAddress();
        }
        dStable = _dStable;
        wrappedDLendToken = IStaticATokenLM(_wrappedDLendToken);
        collateralVault = _collateralVault;

        // Sanity check: Ensure the StaticATokenLM wrapper uses the correct underlying by casting to IERC4626
        if (IERC4626(_wrappedDLendToken).asset() != _dStable) {
            revert StaticATokenUnderlyingMismatch(_dStable, IERC4626(_wrappedDLendToken).asset());
        }
    }

    // --- IDStableConversionAdapterV2 Implementation ---

    /**
     * @inheritdoc IDStableConversionAdapterV2
     * @dev Converts dStable -> wrappedDLendToken by depositing into StaticATokenLM.
     *      The StaticATokenLM contract MUST be pre-approved to spend dStable held by this adapter.
     *      The StaticATokenLM contract mints the wrappedDLendToken directly to the collateralVault.
     */
    function depositIntoStrategy(
        uint256 dStableAmount
    ) external override returns (address _strategyShare, uint256 strategyShareAmount) {
        if (dStableAmount == 0) {
            revert InvalidAmount();
        }

        // 1. Pull dStable from caller (Router)
        IERC20(dStable).safeTransferFrom(msg.sender, address(this), dStableAmount);

        // 2. Approve the StaticATokenLM wrapper to pull the dStable
        IERC20(dStable).forceApprove(address(wrappedDLendToken), dStableAmount);

        // 3. Deposit dStable into the StaticATokenLM wrapper, minting wrappedDLendToken to collateralVault
        strategyShareAmount = IERC4626(address(wrappedDLendToken)).deposit(dStableAmount, collateralVault);

        // 4. Reset approval to adhere to allowance hygiene expectations
        IERC20(dStable).forceApprove(address(wrappedDLendToken), 0);

        return (address(wrappedDLendToken), strategyShareAmount);
    }

    /**
     * @inheritdoc IDStableConversionAdapterV2
     * @dev Converts wrappedDLendToken -> dStable by withdrawing from StaticATokenLM.
     *      The StaticATokenLM contract sends the dStable directly to msg.sender.
     */
    function withdrawFromStrategy(uint256 strategyShareAmount) external override returns (uint256 dStableAmount) {
        if (strategyShareAmount == 0) {
            revert InvalidAmount();
        }

        // 1. Pull wrappedDLendToken (shares) from caller (Router)
        IERC20(address(wrappedDLendToken)).safeTransferFrom(msg.sender, address(this), strategyShareAmount);

        // 2. Withdraw from StaticATokenLM, sending dStable to msg.sender
        dStableAmount = IERC4626(address(wrappedDLendToken)).redeem(strategyShareAmount, msg.sender, address(this));

        if (dStableAmount == 0) {
            revert InvalidAmount();
        }

        return dStableAmount;
    }

    /**
     * @inheritdoc IDStableConversionAdapterV2
     * @dev Uses StaticATokenLM's previewRedeem function to get the underlying value (dStable).
     */
    function strategyShareValueInDStable(
        address _strategyShare,
        uint256 strategyShareAmount
    ) external view override returns (uint256 dStableValue) {
        if (_strategyShare != address(wrappedDLendToken)) {
            revert IncorrectStrategyShare(address(wrappedDLendToken), _strategyShare);
        }
        // previewRedeem takes shares (strategyShareAmount) and returns assets (dStableValue)
        return IERC4626(address(wrappedDLendToken)).previewRedeem(strategyShareAmount);
    }

    /**
     * @inheritdoc IDStableConversionAdapterV2
     */
    function strategyShare() external view override returns (address) {
        return address(wrappedDLendToken);
    }

    /**
     * @inheritdoc IDStableConversionAdapterV2
     * @dev Preview the result of converting a given dSTABLE amount to wrappedDLendToken.
     * @param dStableAmount Amount of dSTABLE to convert
     * @return _strategyShare Address of the strategy share (wrapped dLend token)
     * @return strategyShareAmount Amount of strategy share that would be received
     */
    function previewDepositIntoStrategy(
        uint256 dStableAmount
    ) public view override returns (address _strategyShare, uint256 strategyShareAmount) {
        _strategyShare = address(wrappedDLendToken);
        strategyShareAmount = IERC4626(address(wrappedDLendToken)).previewDeposit(dStableAmount);
    }

    /**
     * @inheritdoc IDStableConversionAdapterV2
     * @dev Preview the result of converting a given wrappedDLendToken amount to dSTABLE.
     * @param strategyShareAmount Amount of strategy share to convert
     * @return dStableAmount Amount of dSTABLE that would be received
     */
    function previewWithdrawFromStrategy(
        uint256 strategyShareAmount
    ) public view override returns (uint256 dStableAmount) {
        dStableAmount = IERC4626(address(wrappedDLendToken)).previewRedeem(strategyShareAmount);
    }
}
