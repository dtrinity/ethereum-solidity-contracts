// SPDX-License-Identifier: UNLICENSED
pragma solidity ^0.8.20;

import "forge-std/Test.sol";

/// @notice Placeholder invariant harness for issuer/redeemer/AMO interactions.
/// TODO: Replace mock state plumbing with live deployments, fixtures, and cheatcodes.
contract IssuerRedeemerInvariant is Test {
    // -------------------------------------------------------------------------
    // Setup scaffolding
    // -------------------------------------------------------------------------

    /// @notice Actor placeholders that will be substituted with real system roles.
    address internal issuer;
    address internal redeemer;
    address internal amoManager;

    /// @notice Minimal aggregate snapshot used until live contracts are wired in.
    struct MockSystemState {
        uint256 circulatingSupply;
        uint256 totalCollateralValue;
        uint256 accountedAmoDebt;
    }

    MockSystemState internal state;

    function setUp() public virtual {
        // TODO: Swap for DSTable deployment fixture (issuer, redeemer, AMO manager, tokens).
        issuer = address(0x1111);
        redeemer = address(0x2222);
        amoManager = address(0x3333);

        state = MockSystemState({
            circulatingSupply: 0,
            totalCollateralValue: 0,
            accountedAmoDebt: 0
        });
    }

    // -------------------------------------------------------------------------
    // Action generators
    // -------------------------------------------------------------------------

    function boundAndIssue(uint256 rawAmount) internal {
        // TODO: Drive issuance through Issuer contract once fixtures exist.
        uint256 amount = bound(rawAmount, 0, 1e24);
        state.circulatingSupply += amount;
        state.totalCollateralValue += amount;

        emit log_named_uint("issuer(issue)", amount);
    }

    function boundAndRedeem(uint256 rawAmount) internal {
        // TODO: Drive redemption through Redeemer contract with fee handling.
        uint256 amount = bound(rawAmount, 0, state.circulatingSupply);
        state.circulatingSupply -= amount;
        state.totalCollateralValue -= amount;

        emit log_named_uint("redeemer(redeem)", amount);
    }

    function adjustAmo(int256 delta) internal {
        // TODO: Wire into AMO manager position adjustments and oracle-driven bounds.
        if (delta >= 0) {
            state.accountedAmoDebt += uint256(delta);
        } else {
            uint256 decrease = uint256(-delta);
            if (decrease > state.accountedAmoDebt) {
                state.accountedAmoDebt = 0;
            } else {
                state.accountedAmoDebt -= decrease;
            }
        }

        emit log_named_int("amoManager.adjust", delta);
    }

    // -------------------------------------------------------------------------
    // Invariant checks
    // -------------------------------------------------------------------------

    function invariantCirculatingSupplyCollateralParity() public {
        uint256 supply = getCirculatingSupply();
        uint256 collateral = getCollateralValue();
        // TODO: Compare with tolerance once oracle deviations and reserve buffers are modelled.
        assertEq(supply, collateral, "placeholder: supply/collateral parity");
    }

    function invariantAmoDebtMatchesAccounting() public {
        uint256 observedDebt = getAmoDebt();
        uint256 recordedDebt = state.accountedAmoDebt;
        // TODO: Allow epsilon drift if AMO vaults accrue fees or PnL.
        assertEq(observedDebt, recordedDebt, "placeholder: AMO debt parity");
    }

    // -------------------------------------------------------------------------
    // Helpers
    // -------------------------------------------------------------------------

    function getCirculatingSupply() internal view returns (uint256) {
        // TODO: Pull supply from stable token minus AMO-owned balances.
        return state.circulatingSupply;
    }

    function getCollateralValue() internal view returns (uint256) {
        // TODO: Aggregate oracle-priced collateral balances.
        return state.totalCollateralValue;
    }

    function getAmoDebt() internal view returns (uint256) {
        // TODO: Query AMO manager debt accounting over all vaults.
        return state.accountedAmoDebt;
    }
}
