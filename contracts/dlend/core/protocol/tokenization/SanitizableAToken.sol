// SPDX-License-Identifier: BUSL-1.1
pragma solidity ^0.8.20;

import { IERC20 } from "../../dependencies/openzeppelin/contracts/IERC20.sol";
import { GPv2SafeERC20 } from "../../dependencies/gnosis/contracts/GPv2SafeERC20.sol";
import { IPool } from "../../interfaces/IPool.sol";
import { Errors } from "../libraries/helpers/Errors.sol";
import { ReserveConfiguration } from "../libraries/configuration/ReserveConfiguration.sol";
import { DataTypes } from "../libraries/types/DataTypes.sol";
import { AToken } from "./AToken.sol";

/**
 * @title SanitizableAToken
 * @notice One-off quarantine implementation for a compromised reserve that is being permanently delisted.
 * @dev This implementation is intentionally meant for targeted reserve wind-downs, not for general market use.
 *      Operators should upgrade only the quarantined reserve's aToken proxy to this implementation, burn the
 *      complete holder set after minting any accrued treasury fees, rescue remaining underlying to the recovery
 *      wallet, and then drop the reserve.
 */
contract SanitizableAToken is AToken {
    using GPv2SafeERC20 for IERC20;
    using ReserveConfiguration for DataTypes.ReserveConfigurationMap;

    uint256 public constant SANITIZABLE_ATOKEN_REVISION = 0x2;

    constructor(IPool pool) AToken(pool) {}

    /// @inheritdoc AToken
    function getRevision() internal pure virtual override returns (uint256) {
        return SANITIZABLE_ATOKEN_REVISION;
    }

    /**
     * @notice Burns the entire visible balance of each listed holder and reverts unless the reserve supply becomes zero.
     * @dev Preconditions are intentionally strict so the admin-only burn surface is only usable on a quarantined,
     *      non-borrowable, non-flash-loanable reserve with zero debt and zero unminted treasury accrual.
     *      Use `Pool.mintToTreasury([asset])` first so any remaining `accruedToTreasury` is materialized into the
     *      treasury holder balance and included in the holder set for this call.
     * @param holders Exhaustive list of all addresses with a non-zero aToken balance, including treasury if applicable.
     * @return totalBurned Visible-token amount burned across all holders.
     */
    function forceBurnAllAndVerifyZero(
        address[] calldata holders
    ) external onlyPoolAdmin returns (uint256 totalBurned) {
        _requireReserveQuarantined();
        _requireZeroAccruedToTreasury();

        uint256 index = POOL.getReserveNormalizedIncome(_underlyingAsset);

        for (uint256 i = 0; i < holders.length; i++) {
            address holder = holders[i];
            if (holder == address(0)) {
                continue;
            }

            uint256 balance = balanceOf(holder);
            if (balance == 0) {
                continue;
            }

            _burnScaled(holder, address(this), balance, index);
            totalBurned += balance;
        }

        require(totalSupply() == 0, "SANITIZE_INCOMPLETE_HOLDER_SET");
    }

    /**
     * @notice Rescues all remaining underlying held by the aToken contract after all claimable rights have been removed.
     * @dev This is blocked unless the reserve is quarantined, the aToken total supply is zero, and there is no residual
     *      `accruedToTreasury` left in Pool reserve state.
     * @param to Recipient of the rescued underlying.
     * @return rescued Amount of underlying transferred.
     */
    function rescueAllUnderlying(address to) external onlyPoolAdmin returns (uint256 rescued) {
        _requireReserveQuarantined();
        _requireZeroAccruedToTreasury();
        require(totalSupply() == 0, Errors.UNDERLYING_CLAIMABLE_RIGHTS_NOT_ZERO);

        IERC20 underlying = IERC20(_underlyingAsset);
        rescued = underlying.balanceOf(address(this));
        if (rescued != 0) {
            underlying.safeTransfer(to, rescued);
        }
    }

    function _requireReserveQuarantined() internal view {
        DataTypes.ReserveConfigurationMap memory config = POOL.getConfiguration(_underlyingAsset);

        require(config.getPaused(), "SANITIZE_REQUIRES_PAUSED");
        require(config.getFrozen(), "SANITIZE_REQUIRES_FROZEN");
        require(!config.getBorrowingEnabled(), "SANITIZE_REQUIRES_BORROWING_DISABLED");
        require(!config.getStableRateBorrowingEnabled(), "SANITIZE_REQUIRES_STABLE_BORROWING_DISABLED");
        require(!config.getFlashLoanEnabled(), "SANITIZE_REQUIRES_FLASHLOANS_DISABLED");

        DataTypes.ReserveData memory reserve = POOL.getReserveData(_underlyingAsset);
        require(IERC20(reserve.stableDebtTokenAddress).totalSupply() == 0, Errors.STABLE_DEBT_NOT_ZERO);
        require(IERC20(reserve.variableDebtTokenAddress).totalSupply() == 0, Errors.VARIABLE_DEBT_SUPPLY_NOT_ZERO);
    }

    function _requireZeroAccruedToTreasury() internal view {
        require(POOL.getReserveData(_underlyingAsset).accruedToTreasury == 0, "SANITIZE_REQUIRES_ZERO_ACCRUAL");
    }
}
