// SPDX-License-Identifier: UNLICENSED
pragma solidity ^0.8.20;

import "forge-std/Test.sol";

/// @notice Placeholder invariant harness for dstake router share accounting.
/// TODO: Swap mock plumbing for real router, staking token, adapters, and vault fixtures.
contract RouterShareAccountingInvariant is Test {
    // -------------------------------------------------------------------------
    // Setup scaffolding
    // -------------------------------------------------------------------------

    /// @notice Actor placeholders mirroring system participants.
    address internal router;
    address internal stakingToken;
    address internal treasury;

    /// @notice Aggregate placeholder that pretends to track router NAV and share supply.
    struct MockRouterState {
        uint256 totalUnderlying;
        uint256 routerShareSupply;
        uint256 stakingTokenSupply;
        uint256 accruedShortfall;
        uint256 pendingFees;
    }

    MockRouterState internal state;

    function setUp() public virtual {
        // TODO: Wire in Foundry deployment fixture for router, staking token, and adapters.
        router = address(0xAAAA);
        stakingToken = address(0xBBBB);
        treasury = address(0xCCCC);

        state = MockRouterState({
            totalUnderlying: 0,
            routerShareSupply: 0,
            stakingTokenSupply: 0,
            accruedShortfall: 0,
            pendingFees: 0
        });
    }

    // -------------------------------------------------------------------------
    // Action generators
    // -------------------------------------------------------------------------

    function boundAndDeposit(uint256 rawAmount) internal {
        // TODO: Replace with router.deposit through adapter registry.
        uint256 amount = bound(rawAmount, 0, 1e24);
        state.totalUnderlying += amount;
        state.routerShareSupply += amount;
        state.stakingTokenSupply += amount;

        emit log_named_uint("router.deposit", amount);
    }

    function boundAndWithdraw(uint256 rawShares) internal {
        // TODO: Call router.withdraw with share conversion using live NAV.
        uint256 shares = bound(rawShares, 0, state.routerShareSupply);
        state.routerShareSupply -= shares;
        state.stakingTokenSupply -= shares;
        if (shares > state.totalUnderlying) {
            state.totalUnderlying = 0;
        } else {
            state.totalUnderlying -= shares;
        }

        emit log_named_uint("router.withdraw", shares);
    }

    function applyRebalance(int256 delta) internal {
        // TODO: Route through adapter rebalance hooks and NAV reconciliation.
        if (delta >= 0) {
            state.totalUnderlying += uint256(delta);
        } else {
            uint256 decrease = uint256(-delta);
            if (decrease >= state.totalUnderlying) {
                state.totalUnderlying = 0;
            } else {
                state.totalUnderlying -= decrease;
            }
        }

        emit log_named_int("router.rebalance", delta);
    }

    function tweakShortfall(int256 delta) internal {
        // TODO: Model shortfall accounting using vault deficits and recovery flows.
        if (delta >= 0) {
            state.accruedShortfall += uint256(delta);
        } else {
            uint256 decrease = uint256(-delta);
            if (decrease >= state.accruedShortfall) {
                state.accruedShortfall = 0;
            } else {
                state.accruedShortfall -= decrease;
            }
        }

        emit log_named_int("router.shortfall", delta);
    }

    function reinvestFees(uint256 rawFees) internal {
        // TODO: Pipe through router fee accumulator and treasury reserves.
        uint256 fees = bound(rawFees, 0, 1e23);
        state.pendingFees += fees;
        state.totalUnderlying += fees;
        state.routerShareSupply += fees;
        state.stakingTokenSupply += fees;

        emit log_named_uint("router.reinvestFees", fees);
    }

    // -------------------------------------------------------------------------
    // Invariant checks
    // -------------------------------------------------------------------------

    function invariantRouterSupplyTracksNav() public {
        uint256 nav = getNav();
        uint256 routerSupply = getRouterShareSupply();
        // TODO: Integrate precise share price calc with epsilon tolerance.
        assertEq(routerSupply, nav, "placeholder: router shares must match NAV");
    }

    function invariantTokenSupplyMatchesRouter() public {
        uint256 routerSupply = getRouterShareSupply();
        uint256 tokenSupply = getStakingTokenSupply();
        // TODO: Compare using real staking token totalSupply minus protocol holdings.
        assertEq(tokenSupply, routerSupply, "placeholder: staking token supply mismatch");
    }

    // -------------------------------------------------------------------------
    // Helpers
    // -------------------------------------------------------------------------

    function getNav() internal view returns (uint256) {
        // TODO: Sum adapter positions minus shortfall with oracle pricing.
        if (state.totalUnderlying > state.accruedShortfall) {
            return state.totalUnderlying - state.accruedShortfall;
        }
        return 0;
    }

    function getRouterShareSupply() internal view returns (uint256) {
        // TODO: Pull total supply from router share accounting helper.
        return state.routerShareSupply;
    }

    function getStakingTokenSupply() internal view returns (uint256) {
        // TODO: Query staking token total supply with fee reflections accounted.
        return state.stakingTokenSupply;
    }
}
