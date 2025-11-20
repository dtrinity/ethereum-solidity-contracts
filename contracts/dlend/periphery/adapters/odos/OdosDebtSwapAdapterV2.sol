// SPDX-License-Identifier: AGPL-3.0
/* ———————————————————————————————————————————————————————————————————————————————— *
 *    _____     ______   ______     __     __   __     __     ______   __  __       *
 *   /\  __-.  /\__  _\ /\  == \   /\ \   /\ "-.\ \   /\ \   /\__  _\ /\ \_\ \      *
 *   \ \ \/\ \ \/_/\ \/ \ \  __<   \ \ \  \ \ \-.  \  \ \ \  \/_/\ \/ \ \____ \     *
 *    \ \____-    \ \_\  \ \_\ \_\  \ \_\  \ \_\\"\_\  \ \_\    \ \_\  \/\_____\    *
 *     \/____/     \/_/   \/_/ /_/   \/_/   \/_/ \/_/   \/_/     \/_/   \/_____/    *
 *                                                                                  *
 * ————————————————————————————————— dtrinity.org ————————————————————————————————— *
 *                                                                                  *
 *                                         ▲                                        *
 *                                        ▲ ▲                                       *
 *                                                                                  *
 * ———————————————————————————————————————————————————————————————————————————————— *
 * dTRINITY Protocol: https://github.com/dtrinity                                   *
 * ———————————————————————————————————————————————————————————————————————————————— */

pragma solidity ^0.8.20;

import { IERC20Detailed } from "contracts/dlend/core/dependencies/openzeppelin/contracts/IERC20Detailed.sol";
import { IERC20WithPermit } from "contracts/dlend/core/interfaces/IERC20WithPermit.sol";
import { ICreditDelegationToken } from "contracts/dlend/core/interfaces/ICreditDelegationToken.sol";
import { BaseOdosBuyAdapterV2 } from "./BaseOdosBuyAdapterV2.sol";
import { IOdosDebtSwapAdapterV2 } from "./interfaces/IOdosDebtSwapAdapterV2.sol";
import { ReentrancyGuard } from "../../dependencies/openzeppelin/ReentrancyGuard.sol";
import { IOdosRouterV2 } from "contracts/odos/interface/IOdosRouterV2.sol";
import { IAaveFlashLoanReceiver } from "../curve/interfaces/IAaveFlashLoanReceiver.sol";
import { SafeERC20 } from "contracts/dlend/core/dependencies/openzeppelin/contracts/SafeERC20.sol";
import { IPoolAddressesProvider } from "contracts/dlend/core/interfaces/IPoolAddressesProvider.sol";
import { DataTypes } from "contracts/dlend/core/protocol/libraries/types/DataTypes.sol";

/**
 * @title OdosDebtSwapAdapterV2
 * @notice Odos Adapter to perform a swap of debt to another debt with PT token support
 * @dev Supports regular tokens and PT tokens through composed Pendle + Odos swaps
 */
contract OdosDebtSwapAdapterV2 is
    BaseOdosBuyAdapterV2,
    ReentrancyGuard,
    IAaveFlashLoanReceiver,
    IOdosDebtSwapAdapterV2
{
    using SafeERC20 for IERC20WithPermit;
    using SafeERC20 for IERC20Detailed;

    /// @notice Emitted when excess debt tokens from PT swaps are returned to user
    /// @param token The debt token that had excess
    /// @param amount The amount of excess returned
    /// @param user The user who received the excess
    event ExcessDebtTokensReturned(address indexed token, uint256 amount, address indexed user);

    // unique identifier to track usage via flashloan events - different from V1
    uint16 public constant REFERRER = 5937; // Incremented from V1 to distinguish V2 usage

    constructor(
        IPoolAddressesProvider addressesProvider,
        address pool,
        IOdosRouterV2 _swapRouter,
        address _pendleRouter,
        address owner
    ) BaseOdosBuyAdapterV2(addressesProvider, pool, _swapRouter, _pendleRouter) {
        transferOwnership(owner);
        // set initial approval for all reserves
        address[] memory reserves = POOL.getReservesList();
        for (uint256 i = 0; i < reserves.length; i++) {
            IERC20WithPermit(reserves[i]).safeApprove(address(POOL), type(uint256).max);
        }
    }

    /**
     * @dev Implementation of the reserve data getter from the base adapter
     * @param asset The address of the asset
     * @return The address of the vToken, sToken and aToken
     */
    function _getReserveData(address asset) internal view override returns (address, address, address) {
        DataTypes.ReserveData memory reserveData = POOL.getReserveData(asset);
        return (reserveData.variableDebtTokenAddress, reserveData.stableDebtTokenAddress, reserveData.aTokenAddress);
    }

    /**
     * @dev Implementation of the supply function from the base adapter
     * @param asset The address of the asset to be supplied
     * @param amount The amount of the asset to be supplied
     * @param to The address receiving the aTokens
     * @param referralCode The referral code to pass to Aave
     */
    function _supply(address asset, uint256 amount, address to, uint16 referralCode) internal override {
        POOL.supply(asset, amount, to, referralCode);
    }

    /**
     * @notice Sets the oracle price deviation tolerance (governance only)
     * @dev Cannot exceed MAX_ORACLE_PRICE_TOLERANCE_BPS (5%)
     * @param newToleranceBps New tolerance in basis points (e.g., 300 = 3%)
     */
    function setOraclePriceTolerance(uint256 newToleranceBps) external onlyOwner {
        _setOraclePriceTolerance(newToleranceBps);
    }

    /**
     * @dev Swaps one type of debt to another with PT token support
     * @param debtSwapParams the enhanced parameters describing the swap
     * @param creditDelegationPermit optional permit for credit delegation
     * @param collateralATokenPermit optional permit for collateral aToken
     */
    function swapDebt(
        DebtSwapParamsV2 memory debtSwapParams,
        CreditDelegationInput memory creditDelegationPermit,
        PermitInput memory collateralATokenPermit
    ) external nonReentrant whenNotPaused {
        uint256 excessBefore = IERC20Detailed(debtSwapParams.newDebtAsset).balanceOf(address(this));

        // Handle credit delegation front-running by checking allowance and using try-catch
        // delegate credit
        if (creditDelegationPermit.deadline != 0) {
            // Check current borrow allowance before attempting delegation
            uint256 currentAllowance = ICreditDelegationToken(creditDelegationPermit.debtToken).borrowAllowance(
                msg.sender,
                address(this)
            );

            // Determine the minimum required allowance (flash loan amount)
            uint256 requiredAllowance = debtSwapParams.maxNewDebtAmount;

            // Only call delegationWithSig if allowance is insufficient
            if (currentAllowance < requiredAllowance) {
                // Wrap delegationWithSig in try-catch to handle front-running gracefully
                try
                    ICreditDelegationToken(creditDelegationPermit.debtToken).delegationWithSig(
                        msg.sender,
                        address(this),
                        creditDelegationPermit.value,
                        creditDelegationPermit.deadline,
                        creditDelegationPermit.v,
                        creditDelegationPermit.r,
                        creditDelegationPermit.s
                    )
                {
                    // Delegation succeeded
                } catch {
                    // Delegation failed (likely front-run). Re-check allowance.
                    // If front-runner's delegation succeeded, allowance should now be sufficient
                    currentAllowance = ICreditDelegationToken(creditDelegationPermit.debtToken).borrowAllowance(
                        msg.sender,
                        address(this)
                    );
                    if (currentAllowance < requiredAllowance) {
                        // Allowance still insufficient after delegation failure
                        revert("Credit delegation failed and allowance insufficient");
                    }
                    // Otherwise, front-runner's delegation succeeded, proceed with flash loan
                }
            }
            // If currentAllowance >= requiredAllowance, skip delegation and proceed
        }

        // Default to the entire debt if an amount greater than it is passed.
        (address vToken, address sToken, ) = _getReserveData(debtSwapParams.debtAsset);
        uint256 maxDebtRepayAmount = debtSwapParams.debtRateMode == 2
            ? IERC20WithPermit(vToken).balanceOf(msg.sender)
            : IERC20WithPermit(sToken).balanceOf(msg.sender);

        if (debtSwapParams.debtRepayAmount > maxDebtRepayAmount) {
            debtSwapParams.debtRepayAmount = maxDebtRepayAmount;
        }

        FlashParamsV2 memory flashParams = FlashParamsV2({
            debtAsset: debtSwapParams.debtAsset,
            debtRepayAmount: debtSwapParams.debtRepayAmount,
            debtRateMode: debtSwapParams.debtRateMode,
            nestedFlashloanDebtAsset: address(0),
            nestedFlashloanDebtAmount: 0,
            user: msg.sender,
            swapData: debtSwapParams.swapData,
            allBalanceOffset: debtSwapParams.allBalanceOffset
        });

        // If we need extra collateral, execute the flashloan with the collateral asset instead of the debt asset.
        if (debtSwapParams.extraCollateralAsset != address(0)) {
            // Permit collateral aToken if needed.
            if (collateralATokenPermit.deadline != 0) {
                collateralATokenPermit.aToken.permit(
                    msg.sender,
                    address(this),
                    collateralATokenPermit.value,
                    collateralATokenPermit.deadline,
                    collateralATokenPermit.v,
                    collateralATokenPermit.r,
                    collateralATokenPermit.s
                );
            }
            flashParams.nestedFlashloanDebtAsset = debtSwapParams.newDebtAsset;
            flashParams.nestedFlashloanDebtAmount = debtSwapParams.maxNewDebtAmount;
            // Execute the flashloan with the extra collateral asset.
            _flash(flashParams, debtSwapParams.extraCollateralAsset, debtSwapParams.extraCollateralAmount);
        } else {
            // Execute the flashloan with the debt asset.
            _flash(flashParams, debtSwapParams.newDebtAsset, debtSwapParams.maxNewDebtAmount);
        }

        // use excess to repay parts of flash debt
        uint256 excessAfter = IERC20Detailed(debtSwapParams.newDebtAsset).balanceOf(address(this));
        // with wrapped flashloans there is the chance of 1 wei inaccuracy on transfer & withdrawal
        // this might lead to a slight excess decrease
        uint256 excess = excessAfter > excessBefore ? excessAfter - excessBefore : 0;
        if (excess > 0) {
            _conditionalRenewAllowance(debtSwapParams.newDebtAsset, excess);
            POOL.repay(debtSwapParams.newDebtAsset, excess, 2, msg.sender);
        }
    }

    function _flash(FlashParamsV2 memory flashParams, address asset, uint256 amount) internal virtual {
        bytes memory params = abi.encode(flashParams);
        address[] memory assets = new address[](1);
        assets[0] = asset;
        uint256[] memory amounts = new uint256[](1);
        amounts[0] = amount;
        uint256[] memory modes = new uint256[](1);
        modes[0] = 0; // no debt, 0 = no debt, 1 = stable, 2 = variable
        // execute flash loan
        POOL.flashLoan(address(this), assets, amounts, modes, address(this), params, REFERRER);
    }

    function _nestedFlash(address asset, uint256 amount, FlashParamsV2 memory params) internal {
        bytes memory innerParams = abi.encode(params);
        address[] memory assets = new address[](1);
        assets[0] = asset;
        uint256[] memory amounts = new uint256[](1);
        amounts[0] = amount;
        uint256[] memory modes = new uint256[](1);
        modes[0] = 0; // no debt, 0 = no debt, 1 = stable, 2 = variable
        // execute flash loan
        POOL.flashLoan(address(this), assets, amounts, modes, address(this), innerParams, REFERRER);
    }

    function executeOperation(
        address[] memory assets,
        uint256[] memory amounts,
        uint256[] memory premiums,
        address initiator,
        bytes memory params
    ) external override returns (bool) {
        require(msg.sender == address(POOL), "Callback only from POOL");
        require(initiator == address(this), "Initiator only this contract");

        uint256 collateralAmount = amounts[0];
        address collateralAsset = assets[0];
        uint256 amountToReturn = collateralAmount + premiums[0];

        FlashParamsV2 memory flashParams = abi.decode(params, (FlashParamsV2));

        // nested flashloan when using extra collateral
        if (flashParams.nestedFlashloanDebtAsset != address(0)) {
            (, , address aToken) = _getReserveData(collateralAsset);
            FlashParamsV2 memory innerFlashParams = FlashParamsV2({
                debtAsset: flashParams.debtAsset,
                debtRepayAmount: flashParams.debtRepayAmount,
                debtRateMode: flashParams.debtRateMode,
                nestedFlashloanDebtAsset: address(0),
                nestedFlashloanDebtAmount: 0,
                user: flashParams.user,
                swapData: flashParams.swapData,
                allBalanceOffset: flashParams.allBalanceOffset
            });
            _nestedFlash(flashParams.nestedFlashloanDebtAsset, flashParams.nestedFlashloanDebtAmount, innerFlashParams);

            // cover flashloan premium when the initial collateral borrow was principal-only
            uint256 collateralBalance = IERC20WithPermit(collateralAsset).balanceOf(address(this));
            if (collateralBalance < amountToReturn) {
                uint256 shortfall = amountToReturn - collateralBalance;
                IERC20WithPermit(aToken).safeTransferFrom(flashParams.user, address(this), shortfall);
                POOL.withdraw(collateralAsset, shortfall, address(this));
                collateralBalance = IERC20WithPermit(collateralAsset).balanceOf(address(this));
            }

            // revert if returned amount is not enough to repay the flashloan
            require(collateralBalance >= amountToReturn, "Insufficient amount to repay flashloan");

            uint256 surplusCollateral = collateralBalance - amountToReturn;
            if (surplusCollateral > 0) {
                IERC20WithPermit(collateralAsset).safeTransfer(flashParams.user, surplusCollateral);
            }

            _conditionalRenewAllowance(collateralAsset, amountToReturn);
            return true;
        }

        // Executing the original flashloan with PT-aware swap logic
        {
            // Use adaptive buy which handles both regular and PT token swaps intelligently
            _executeAdaptiveBuy(
                IERC20Detailed(collateralAsset),
                IERC20Detailed(flashParams.debtAsset),
                collateralAmount,
                flashParams.debtRepayAmount,
                flashParams.swapData
            );

            // Measure actual debt tokens received from swap
            // PT swaps may produce more output than the exact amount requested
            uint256 actualDebtTokensReceived = IERC20Detailed(flashParams.debtAsset).balanceOf(address(this));

            // Use ALL received debt tokens for repayment (up to what's owed)
            // This ensures no excess debt tokens are trapped on the adapter
            uint256 amountToRepay = actualDebtTokensReceived;

            // Repay old debt with actual amount received
            _conditionalRenewAllowance(flashParams.debtAsset, amountToRepay);
            uint256 actualRepaid = POOL.repay(
                flashParams.debtAsset,
                amountToRepay,
                flashParams.debtRateMode,
                flashParams.user
            );

            // Handle any excess that couldn't be repaid (edge case: user debt < swap output)
            // Return excess to user rather than leaving it trapped on adapter
            uint256 excessDebtTokens = actualDebtTokensReceived > actualRepaid
                ? actualDebtTokensReceived - actualRepaid
                : 0;
            if (excessDebtTokens > 0) {
                IERC20Detailed(flashParams.debtAsset).safeTransfer(flashParams.user, excessDebtTokens);
                emit ExcessDebtTokensReturned(flashParams.debtAsset, excessDebtTokens, flashParams.user);
            }

            // Borrow new debt to repay flashloan
            POOL.borrow(
                collateralAsset,
                amountToReturn,
                2, // variable rate mode
                REFERRER,
                flashParams.user
            );

            // revert if returned amount is not enough to repay the flashloan
            require(
                IERC20WithPermit(collateralAsset).balanceOf(address(this)) >= amountToReturn,
                "Insufficient amount to repay flashloan"
            );

            _conditionalRenewAllowance(collateralAsset, amountToReturn);
            return true;
        }
    }
}
