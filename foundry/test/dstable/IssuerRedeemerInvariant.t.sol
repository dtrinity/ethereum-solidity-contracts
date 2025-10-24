// SPDX-License-Identifier: MIT
pragma solidity ^0.8.20;

import "forge-std/Test.sol";

import { IssuerV2 } from "dstable/IssuerV2.sol";
import { RedeemerV2 } from "dstable/RedeemerV2.sol";
import { AmoManager } from "dstable/AmoManager.sol";
import { CollateralHolderVault } from "dstable/CollateralHolderVault.sol";
import { MockAmoVault } from "testing/dstake/MockAmoVault.sol";
import { TestMintableERC20 } from "../utils/TestMintableERC20.sol";
import { MockPriceOracle } from "../utils/MockPriceOracle.sol";

contract IssuerRedeemerInvariant is Test {
    uint256 internal constant BASE_UNIT = 1e8;

    MockPriceOracle internal oracle;
    TestMintableERC20 internal dstable;
    TestMintableERC20 internal usdc;
    CollateralHolderVault internal collateralVault;
    AmoManager internal amoManager;
    IssuerV2 internal issuer;
    RedeemerV2 internal redeemer;
    MockAmoVault internal amoVault;

    address internal user;

    function setUp() public virtual {
        user = address(0xBEEF);

        oracle = new MockPriceOracle(address(0), BASE_UNIT);
        dstable = new TestMintableERC20("dStable", "dSTB", 18);
        usdc = new TestMintableERC20("USD Coin", "USDC", 6);

        oracle.setPrice(address(dstable), BASE_UNIT);
        oracle.setPrice(address(usdc), BASE_UNIT);

        collateralVault = new CollateralHolderVault(oracle);
        amoManager = new AmoManager(address(dstable), address(collateralVault), oracle);
        issuer = new IssuerV2(address(collateralVault), address(dstable), oracle, address(amoManager));
        redeemer = new RedeemerV2(address(collateralVault), address(dstable), oracle, address(this), 0);
        amoVault = new MockAmoVault(address(dstable), address(amoManager), address(this), address(this), address(this), oracle);

        // Grant mint permissions to protocol contracts
        dstable.setMinter(address(this), true);
        dstable.setMinter(address(issuer), true);

        // Wire collateral permissions
        collateralVault.allowCollateral(address(usdc));
        collateralVault.grantRole(collateralVault.COLLATERAL_WITHDRAWER_ROLE(), address(redeemer));
        collateralVault.grantRole(collateralVault.COLLATERAL_WITHDRAWER_ROLE(), address(amoManager));

        amoVault.allowCollateral(address(usdc));
        amoManager.enableAmoVault(address(amoVault));

        targetContract(address(this));
        bytes4[] memory selectors = new bytes4[](3);
        selectors[0] = this.issueWithCollateral.selector;
        selectors[1] = this.redeemForCollateral.selector;
        selectors[2] = this.adjustAmoPosition.selector;
        targetSelector(FuzzSelector({ addr: address(this), selectors: selectors }));
    }

    // -------------------------------------------------------------------------
    // Action generators
    // -------------------------------------------------------------------------

    function issueWithCollateral(uint256 rawAmount) public {
        uint256 amount = bound(rawAmount, 1, 1e24);
        usdc.mint(user, amount);

        vm.startPrank(user);
        if (usdc.allowance(user, address(issuer)) < amount) {
            usdc.approve(address(issuer), type(uint256).max);
        }
        issuer.issue(amount, address(usdc), 0);
        vm.stopPrank();
    }

    function redeemForCollateral(uint256 rawAmount) public {
        vm.startPrank(user);
        uint256 balance = dstable.balanceOf(user);
        if (balance == 0) {
            vm.stopPrank();
            return;
        }

        uint256 amount = bound(rawAmount, 1, balance);
        if (dstable.allowance(user, address(redeemer)) < amount) {
            dstable.approve(address(redeemer), type(uint256).max);
        }
        redeemer.redeem(amount, address(usdc), 0);
        vm.stopPrank();
    }

    function adjustAmoPosition(int256 rawDelta) public {
        if (rawDelta == 0) {
            return;
        }

        if (rawDelta > 0) {
            uint256 amount = bound(uint256(rawDelta), 1, 1e24);
            issuer.increaseAmoSupply(amount);
            amoManager.allocateAmo(address(amoVault), amount);
        } else {
            uint256 allocation = amoManager.amoVaultAllocation(address(amoVault));
            uint256 amount = bound(uint256(-rawDelta), 0, allocation);
            if (amount == 0) {
                return;
            }
            amoManager.deallocateAmo(address(amoVault), amount);
            amoManager.decreaseAmoSupply(amount);
        }
    }

    // -------------------------------------------------------------------------
    // Invariant checks
    // -------------------------------------------------------------------------

    function invariantCirculatingSupplyCollateralParity() public view {
        uint256 circulating = issuer.circulatingDstable();
        uint256 collateral = issuer.collateralInDstable();
        assertLe(circulating, collateral, "Circulating supply must remain collateralised");
    }

    function invariantAmoDebtMatchesAccounting() public view {
        uint256 recorded = amoManager.totalAllocated();
        address[] memory vaults = amoManager.amoVaults();
        uint256 observed = 0;
        for (uint256 i = 0; i < vaults.length; i++) {
            observed += amoManager.amoVaultAllocation(vaults[i]);
        }
        assertEq(recorded, observed, "AMO recorded allocation must equal per-vault sum");
    }
}
