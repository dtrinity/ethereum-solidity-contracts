// SPDX-License-Identifier: MIT
pragma solidity ^0.8.20;

import { BasisPointConstants } from "./BasisPointConstants.sol";
import { Math } from "@openzeppelin/contracts/utils/math/Math.sol";

library WithdrawalFeeMath {
    uint256 internal constant _SCALE = BasisPointConstants.ONE_HUNDRED_PERCENT_BPS;

    // Calculates the fee portion of `grossAmount` using precise basis-point math.
    function calculateWithdrawalFee(uint256 grossAmount, uint256 feeBps) internal pure returns (uint256) {
        if (grossAmount == 0 || feeBps == 0) {
            return 0;
        }
        if (feeBps >= _SCALE) {
            return grossAmount;
        }
        return Math.mulDiv(grossAmount, feeBps, _SCALE);
    }

    // Returns the user-facing amount once the fee has been kept inside the vault.
    // Clamp the result at zero so call sites never underflow when the fee equals or exceeds the gross amount.
    function netAfterFee(uint256 grossAmount, uint256 feeBps) internal pure returns (uint256) {
        if (grossAmount == 0) {
            return 0;
        }
        if (feeBps == 0) {
            return grossAmount;
        }
        if (feeBps >= _SCALE) {
            return 0;
        }

        uint256 fee = calculateWithdrawalFee(grossAmount, feeBps);
        if (fee >= grossAmount) {
            return 0;
        }
        return grossAmount - fee;
    }

    // Computes the gross value that must be withdrawn in order to deliver `netAmount` to the user.
    // We round up so the caller never under-delivers, then tighten by a single wei to avoid overpaying
    // whenever the ceil step overshoots by one.
    function grossFromNet(uint256 netAmount, uint256 feeBps) internal pure returns (uint256) {
        if (netAmount == 0 || feeBps == 0) {
            return netAmount;
        }
        if (feeBps >= _SCALE) {
            return 0;
        }

        uint256 grossAmount = Math.mulDiv(netAmount, _SCALE, _SCALE - feeBps, Math.Rounding.Ceil);

        if (grossAmount > 0) {
            // Redo the math with one wei less; if the net is still sufficient we return the tighter value.
            uint256 alternativeNet = netAfterFee(grossAmount - 1, feeBps);
            if (alternativeNet >= netAmount) {
                grossAmount -= 1;
            }
        }

        return grossAmount;
    }
}
