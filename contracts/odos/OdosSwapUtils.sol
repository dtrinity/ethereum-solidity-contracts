// SPDX-License-Identifier: GNU AGPLv3
pragma solidity ^0.8.20;

import "./interface/IOdosRouterV2.sol";
import { IERC20 } from "@openzeppelin/contracts/token/ERC20/IERC20.sol";
import { SafeERC20 } from "@openzeppelin/contracts/token/ERC20/utils/SafeERC20.sol";

/**
 * @title OdosSwapUtils
 * @notice Library for handling Odos swaps in liquidator contracts
 */
library OdosSwapUtils {
    using SafeERC20 for IERC20;

    /// @notice Custom error for failed swap with no revert reason
    error SwapFailed();
    /// @notice Custom error when actual output amount is less than expected
    error InsufficientOutput(uint256 expected, uint256 actual);
    /// @notice Custom error when attempting same-token swap
    error SameTokenSwapNotSupported();

    /**
     * @notice Performs a swap operation using Odos router with swap data
     * @param router Odos router contract
     * @param inputToken Input token address
     * @param outputToken Output token address
     * @param maxIn Maximum input amount
     * @param exactOut Exact output amount expected
     * @param swapData Encoded swap path data
     * @return actualAmountReceived The actual amount of output tokens received
     */
    function executeSwapOperation(
        IOdosRouterV2 router,
        address inputToken,
        address outputToken,
        uint256 maxIn,
        uint256 exactOut,
        bytes memory swapData
    ) internal returns (uint256 actualAmountReceived) {
        uint256 outputBalanceBefore = IERC20(outputToken).balanceOf(address(this));

        // Use SafeERC20.forceApprove for external DEX router integration
        SafeERC20.forceApprove(IERC20(inputToken), address(router), maxIn);

        (bool success, bytes memory result) = address(router).call(swapData);
        if (!success) {
            if (result.length > 0) {
                assembly {
                    let resultLength := mload(result)
                    revert(add(32, result), resultLength)
                }
            }
            revert SwapFailed();
        }

        // Note: Odos router returns actualAmountSpent, but we calculate and return actualAmountReceived
        // The amount spent information is discarded as callers need the output amount

        uint256 outputBalanceAfter = IERC20(outputToken).balanceOf(address(this));

        // Prevent same-token swap exploitation
        // After fixing Issue #1, same-token swaps would allow stealing contract balance
        // by claiming large exactOut amounts without actually performing a swap
        if (inputToken == outputToken) {
            revert SameTokenSwapNotSupported();
        }

        if (outputBalanceAfter >= outputBalanceBefore) {
            actualAmountReceived = outputBalanceAfter - outputBalanceBefore;
        } else {
            revert InsufficientOutput(exactOut, 0);
        }

        if (actualAmountReceived < exactOut) {
            revert InsufficientOutput(exactOut, actualAmountReceived);
        }

        // Reset approval to 0 after swap
        IERC20(inputToken).approve(address(router), 0);

        return actualAmountReceived;
    }
}
