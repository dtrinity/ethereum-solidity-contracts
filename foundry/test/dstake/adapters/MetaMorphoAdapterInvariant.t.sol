// SPDX-License-Identifier: MIT
pragma solidity ^0.8.20;

import "forge-std/Test.sol";
import { MetaMorphoConversionAdapter } from "contracts/vaults/dstake/adapters/MetaMorphoConversionAdapter.sol";
import { MockMetaMorphoVault } from "./MockMetaMorphoVault.sol";
import { TestMintableERC20 } from "../../utils/TestMintableERC20.sol";
import { BasisPointConstants } from "contracts/common/BasisPointConstants.sol";
import { IERC20 } from "@openzeppelin/contracts/token/ERC20/IERC20.sol";

contract MetaMorphoAdapterInvariant is Test {
    TestMintableERC20 internal dStable;
    MockMetaMorphoVault internal mockVault;
    MetaMorphoConversionAdapter internal adapter;
    address internal collateralVault;
    address internal router;
    address internal admin;

    // Ghost variables for invariants
    uint256 internal ghost_depositAmount;
    uint256 internal ghost_expectedShares;
    uint256 internal ghost_actualShares;
    
    uint256 internal constant INITIAL_BALANCE = 1_000_000 * 1e18;

    function setUp() public {
        admin = address(this);
        router = address(0x1);
        collateralVault = address(0x2);

        dStable = new TestMintableERC20("dStable", "dSTB", 18);
        mockVault = new MockMetaMorphoVault(IERC20(address(dStable)));
        
        adapter = new MetaMorphoConversionAdapter(
            address(dStable),
            address(mockVault),
            collateralVault,
            admin
        );

        // Setup authorized caller (usually the router)
        adapter.setAuthorizedCaller(router, true);

        // Initial funding
        dStable.mint(router, INITIAL_BALANCE);
        
        // Fund vault to avoid 0 totalAssets
        dStable.mint(address(mockVault), 1000 * 1e18);
        mockVault.mintDirect(address(this), 1000 * 1e18);
        
        // Approve adapter to spend router's tokens (simulating router behavior)
        vm.startPrank(router);
        dStable.approve(address(adapter), type(uint256).max);
        vm.stopPrank();
        
        // Also approve adapter to spend vault shares (for withdrawals)
        vm.startPrank(router);
        IERC20(address(mockVault)).approve(address(adapter), type(uint256).max);
        vm.stopPrank();

        // Target the test contract for fuzzing actions
        targetContract(address(this));
        
        bytes4[] memory selectors = new bytes4[](3);
        selectors[0] = this.action_deposit.selector;
        selectors[1] = this.action_withdraw.selector;
        selectors[2] = this.action_changeExchangeRate.selector;
        targetSelector(FuzzSelector({ addr: address(this), selectors: selectors }));
    }

    // -------------------------------------------------------------------------
    // Actions
    // -------------------------------------------------------------------------

    function action_deposit(uint256 amount) public {
        // Bound to realistic amounts, avoiding dust that might revert (min shares = 1)
        amount = bound(amount, 1e6, INITIAL_BALANCE);
        
        // Refill router if needed
        if (dStable.balanceOf(router) < amount) {
            dStable.mint(router, amount);
        }

        // Capture state before
        uint256 sharesBefore = mockVault.balanceOf(collateralVault);
        
        vm.prank(router);
        try adapter.depositIntoStrategy(amount) returns (address, uint256 shares) {
            uint256 sharesAfter = mockVault.balanceOf(collateralVault);
            ghost_actualShares = sharesAfter - sharesBefore;
            ghost_depositAmount = amount;
        } catch {
            // Expected reverts: slippage, dust, etc.
        }
    }

    function action_withdraw(uint256 shares) public {
        uint256 currentShares = mockVault.balanceOf(collateralVault);
        if (currentShares == 0) return;
        
        shares = bound(shares, 1, currentShares);
        
        // Simulate router pulling shares from collateral vault to itself before calling adapter
        vm.prank(collateralVault);
        mockVault.transfer(router, shares);

        vm.prank(router);
        try adapter.withdrawFromStrategy(shares) {
            // Success
        } catch {
            // Expected reverts: return shares to CV
            vm.prank(router);
            mockVault.transfer(collateralVault, shares);
        }
    }

    function action_changeExchangeRate(uint256 newAssets, uint256 mintShares) public {
        // Simulate price changes
        uint256 currentAssets = mockVault.totalAssets();
        uint256 targetAssets = bound(newAssets, currentAssets / 2, (currentAssets * 3) / 2);
        if (targetAssets == 0) targetAssets = 1000;
        
        mockVault.setTotalAssets(targetAssets);

        // Dilute shares
        uint256 sharesToMint = bound(mintShares, 0, 1_000_000 * 1e18);
        if (sharesToMint > 0) {
            mockVault.mintDirect(address(0xBEEF), sharesToMint);
        }
    }

    // -------------------------------------------------------------------------
    // Invariants
    // -------------------------------------------------------------------------

    function invariant_adapterHasNoDust() public view {
        assertEq(dStable.balanceOf(address(adapter)), 0, "Adapter holds dStable dust");
        assertEq(mockVault.balanceOf(address(adapter)), 0, "Adapter holds share dust");
    }

    function invariant_slippageRespected() public view {
        // Placeholder for now as we verify slippage via preview consistency
    }
    
    /// @notice Invariant: Preview Deposit <= Actual Deposit (Shares)
    function invariant_previewConservative_Deposit() public {
        uint256 amount = 1 ether; 
        
        (address strat, uint256 predictedShares) = adapter.previewDepositIntoStrategy(amount);
        
        uint256 snapshotId = vm.snapshotState();
        
        dStable.mint(router, amount);
        vm.startPrank(router);
        try adapter.depositIntoStrategy(amount) returns (address, uint256 actualShares) {
            assertGe(actualShares, predictedShares, "Actual shares < Predicted shares (Slippage Violation)");
        } catch {
            // ignore
        }
        vm.stopPrank();
        
        vm.revertToState(snapshotId);
    }

    /// @notice Invariant: Preview Withdraw <= Actual Withdraw (Assets)
    function invariant_previewConservative_Withdraw() public {
        uint256 shares = 1 ether;
        
        // SETUP: Ensure router has shares BEFORE we calculate preview.
        // If we mint shares to router *after* preview, we dilute the pool and change the rate, invalidating preview.
        mockVault.mintDirect(router, shares);
        
        // Ensure vault is valid
        uint256 assets = mockVault.convertToAssets(shares);
        if (assets == 0) return;

        // NOW get preview
        uint256 predictedAssets = adapter.previewWithdrawFromStrategy(shares);
        
        uint256 snapshotId = vm.snapshotState();

        vm.startPrank(router);
        try adapter.withdrawFromStrategy(shares) returns (uint256 actualAssets) {
            assertGe(actualAssets, predictedAssets, "Actual assets < Predicted assets (Slippage Violation)");
        } catch {
            // ignore
        }
        vm.stopPrank();

        vm.revertToState(snapshotId);
    }
    
    /// @notice Invariant: Slippage parameter is respected
    function invariant_adminSlippageCap() public {
        vm.prank(admin);
        vm.expectRevert(abi.encodeWithSelector(MetaMorphoConversionAdapter.SlippageTooHigh.selector, 1000001, 1000000));
        adapter.setMaxSlippage(1000001); // > 100%
    }

}
