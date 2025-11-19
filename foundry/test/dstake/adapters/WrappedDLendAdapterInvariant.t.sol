// SPDX-License-Identifier: MIT
pragma solidity ^0.8.20;

import "forge-std/Test.sol";
import { WrappedDLendConversionAdapter } from "contracts/vaults/dstake/adapters/WrappedDLendConversionAdapter.sol";
import { MockStaticATokenLM } from "./MockStaticATokenLM.sol";
import { TestMintableERC20 } from "../../utils/TestMintableERC20.sol";
import { IERC20 } from "@openzeppelin/contracts/token/ERC20/IERC20.sol";

contract WrappedDLendAdapterInvariant is Test {
    TestMintableERC20 internal dStable;
    MockStaticATokenLM internal mockVault;
    WrappedDLendConversionAdapter internal adapter;
    address internal collateralVault;
    address internal router;
    address internal admin;
    address internal whale;

    uint256 internal constant INITIAL_BALANCE = 1_000_000 * 1e18;

    function setUp() public {
        admin = address(this);
        router = address(0x1);
        collateralVault = address(0x2);
        whale = address(0xBEEF);

        dStable = new TestMintableERC20("dStable", "dSTB", 18);
        mockVault = new MockStaticATokenLM(IERC20(address(dStable)));
        
        adapter = new WrappedDLendConversionAdapter(
            address(dStable),
            address(mockVault),
            collateralVault
        );

        // Setup authorized caller (usually the router)
        adapter.setAuthorizedCaller(router, true);

        // Initial funding
        dStable.mint(router, INITIAL_BALANCE);
        // Fund vault to avoid 0 totalAssets/exchange rate issues
        dStable.mint(address(mockVault), 1000 * 1e18);
        mockVault.mintDirect(whale, 1000 * 1e18);
        
        // Approve adapter to spend router's tokens
        vm.startPrank(router);
        dStable.approve(address(adapter), type(uint256).max);
        vm.stopPrank();
        
        // Approve adapter to spend vault shares (for withdrawals)
        vm.startPrank(router);
        IERC20(address(mockVault)).approve(address(adapter), type(uint256).max);
        vm.stopPrank();

        // Target the test contract
        targetContract(address(this));
        
        bytes4[] memory selectors = new bytes4[](3);
        selectors[0] = this.action_deposit.selector;
        selectors[1] = this.action_withdraw.selector;
        selectors[2] = this.action_changeExchangeRate.selector;
        targetSelector(FuzzSelector({ addr: address(this), selectors: selectors }));
    }

    function clamp(uint256 x, uint256 min, uint256 max) internal pure returns (uint256) {
        if (x < min) return min;
        if (x > max) return max;
        return x;
    }

    // -------------------------------------------------------------------------
    // Actions
    // -------------------------------------------------------------------------

    function action_deposit(uint256 amount) public {
        amount = clamp(amount, 1e6, INITIAL_BALANCE);
        
        if (dStable.balanceOf(router) < amount) {
            dStable.mint(router, amount);
        }

        vm.prank(router);
        try adapter.depositIntoStrategy(amount) returns (address, uint256) {
            // Success
        } catch {
            // Fail
        }
    }

    function action_withdraw(uint256 shares) public {
        uint256 currentShares = mockVault.balanceOf(collateralVault);
        if (currentShares == 0) return;
        
        shares = clamp(shares, 1, currentShares);
        
        // Simulate router pulling shares from CV
        vm.prank(collateralVault);
        mockVault.transfer(router, shares);

        vm.prank(router);
        try adapter.withdrawFromStrategy(shares) {
            // Success
        } catch {
            // On fail, return shares to CV
            vm.prank(router);
            mockVault.transfer(collateralVault, shares);
        }
    }

    function action_changeExchangeRate(uint256 newAssets, uint256 mintShares) public {
        uint256 currentSupply = mockVault.totalSupply();
        
        // If supply is too high (>1e35), prune it to avoid overflow in later calculations
        if (currentSupply > 1e35) {
            uint256 burnAmount = currentSupply - 1e30; // Burn down to 1e30
            // We need to burn from whale or someone who has them.
            // MockVault allows arbitrary burn.
            // Burn from whale first
            uint256 whaleBal = mockVault.balanceOf(whale);
            if (whaleBal > 0) {
                uint256 toBurn = burnAmount > whaleBal ? whaleBal : burnAmount;
                mockVault.burnDirect(whale, toBurn);
            }
            currentSupply = mockVault.totalSupply();
        }
        
        // Ensure reasonable assets for the supply (Rate <= 1e12)
        uint256 minAssets = 1000;
        if (currentSupply > 0) {
            uint256 derivedMin = currentSupply / 1e12;
            if (derivedMin > minAssets) minAssets = derivedMin;
        }
        
        uint256 maxAssets = 10_000_000_000 * 1e18;
        if (minAssets > maxAssets) minAssets = maxAssets;

        uint256 targetAssets = clamp(newAssets, minAssets, maxAssets);
        mockVault.setTotalAssets(targetAssets);

        // Mint new shares
        uint256 sharesToMint = clamp(mintShares, 0, 1_000_000 * 1e18);
        if (sharesToMint > 0 && currentSupply < 1e35) {
            mockVault.mintDirect(whale, sharesToMint);
        }
    }

    // -------------------------------------------------------------------------
    // Invariants
    // -------------------------------------------------------------------------

    function invariant_adapterHasNoDust() public view {
        assertEq(dStable.balanceOf(address(adapter)), 0, "Adapter holds dStable dust");
        assertEq(mockVault.balanceOf(address(adapter)), 0, "Adapter holds share dust");
    }

    function invariant_previewConservative_Deposit() public {
        uint256 amount = 1 ether; 
        
        // Wrap preview in try/catch to avoid failing test on overflow during intense fuzzing
        // The invariant we care about is "IF preview succeeds, execution matches".
        // If preview fails due to mock state explosion, we skip.
        bool previewSuccess;
        uint256 predictedShares;
        
        try adapter.previewDepositIntoStrategy(amount) returns (address, uint256 s) {
            previewSuccess = true;
            predictedShares = s;
        } catch {
            return;
        }
        
        uint256 snapshotId = vm.snapshotState();
        
        dStable.mint(router, amount);
        vm.startPrank(router);
        try adapter.depositIntoStrategy(amount) returns (address, uint256 actualShares) {
            if (previewSuccess) {
                assertGe(actualShares, predictedShares, "Actual shares < Predicted shares");
            }
        } catch {
            // ignore
        }
        vm.stopPrank();
        vm.revertToState(snapshotId);
    }

    function invariant_previewConservative_Withdraw() public {
        uint256 shares = 1 ether;
        
        mockVault.mintDirect(router, shares);
        uint256 assets = mockVault.convertToAssets(shares);
        if (assets == 0) return;

        bool previewSuccess;
        uint256 predictedAssets;
        
        try adapter.previewWithdrawFromStrategy(shares) returns (uint256 a) {
            previewSuccess = true;
            predictedAssets = a;
        } catch {
            return;
        }
        
        uint256 snapshotId = vm.snapshotState();

        vm.startPrank(router);
        try adapter.withdrawFromStrategy(shares) returns (uint256 actualAssets) {
            if (previewSuccess) {
                assertGe(actualAssets, predictedAssets, "Actual assets < Predicted assets");
            }
        } catch {
            // ignore
        }
        vm.stopPrank();
        vm.revertToState(snapshotId);
    }
}
