// SPDX-License-Identifier: MIT
pragma solidity ^0.8.20;

import "forge-std/Test.sol";

import { IssuerV2 } from "dstable/IssuerV2.sol";
import { RedeemerV2 } from "dstable/RedeemerV2.sol";
import { CollateralHolderVault } from "dstable/CollateralHolderVault.sol";
import { AmoManagerV2 } from "dstable/AmoManagerV2.sol";
import { AmoDebtToken } from "dstable/AmoDebtToken.sol";
import { MockAmoVault } from "testing/dstake/MockAmoVault.sol";
import { BasisPointConstants } from "contracts/common/BasisPointConstants.sol";
import { TestMintableERC20 } from "../utils/TestMintableERC20.sol";
import { MockPriceOracle } from "../utils/MockPriceOracle.sol";

contract AmoManagerV2Invariant is Test {
    uint256 internal constant BASE_UNIT = 1e8;
    uint256 internal constant MAX_AMO_MINT = 10_000_000 * 1e18;
    uint256 internal constant MAX_ISSUE_COLLATERAL = 1_000_000 * 1e6;
    uint256 internal constant MAX_ORACLE_SHOCK_BPS = 2_000; // ±20%

    MockPriceOracle internal oracle;
    TestMintableERC20 internal dstable;
    TestMintableERC20 internal usdc;
    CollateralHolderVault internal collateralVault;
    AmoDebtToken internal debtToken;
    AmoManagerV2 internal amoManager;
    IssuerV2 internal issuer;
    RedeemerV2 internal redeemer;
    MockAmoVault[2] internal amoVaults;

    mapping(address => uint256) internal trackedDebtUnits;
    mapping(address => uint256) internal trackedDstable;
    uint256 internal totalTrackedDebt;

    address internal user;
    bool internal increaseRolePaused;

    function setUp() public {
        oracle = new MockPriceOracle(address(0), BASE_UNIT);
        dstable = new TestMintableERC20("dStable", "dSTB", 18);
        oracle.setPrice(address(dstable), BASE_UNIT);

        usdc = new TestMintableERC20("USD Coin", "USDC", 6);
        oracle.setPrice(address(usdc), BASE_UNIT);

        collateralVault = new CollateralHolderVault(oracle);
        debtToken = new AmoDebtToken("dStable AMO Receipt", "amo-dSTB");

        oracle.setPrice(address(debtToken), BASE_UNIT);

        amoManager = new AmoManagerV2(oracle, debtToken, dstable, address(collateralVault));

        issuer = new IssuerV2(address(collateralVault), address(dstable), oracle, address(amoManager));
        redeemer = new RedeemerV2(address(collateralVault), address(dstable), oracle, address(this), 0);

        for (uint256 i = 0; i < amoVaults.length; i++) {
            amoVaults[i] = new MockAmoVault(
                address(dstable),
                address(amoManager),
                address(this),
                address(this),
                address(this),
                oracle
            );
            amoVaults[i].allowCollateral(address(usdc));
        }

        dstable.setMinter(address(this), true);
        dstable.setMinter(address(issuer), true);
        dstable.setMinter(address(amoManager), true);

        debtToken.setAllowlisted(address(collateralVault), true);
        debtToken.setAllowlisted(address(amoManager), true);
        debtToken.grantRole(debtToken.AMO_MANAGER_ROLE(), address(amoManager));

        collateralVault.allowCollateral(address(usdc));
        collateralVault.grantRole(collateralVault.COLLATERAL_WITHDRAWER_ROLE(), address(redeemer));
        collateralVault.grantRole(collateralVault.COLLATERAL_WITHDRAWER_ROLE(), address(amoManager));
        collateralVault.grantRole(collateralVault.COLLATERAL_STRATEGY_ROLE(), address(amoManager));

        for (uint256 i = 0; i < amoVaults.length; i++) {
            amoManager.setAmoWalletAllowed(address(amoVaults[i]), true);
            collateralVault.grantRole(collateralVault.COLLATERAL_WITHDRAWER_ROLE(), address(amoVaults[i]));
            vm.prank(address(amoVaults[i]));
            dstable.approve(address(amoManager), type(uint256).max);
        }

        amoManager.grantRole(amoManager.AMO_INCREASE_ROLE(), address(this));
        amoManager.grantRole(amoManager.AMO_DECREASE_ROLE(), address(this));

        uint256 initialCollateral = 50_000_000 * 1e6;
        usdc.mint(address(this), initialCollateral);
        usdc.approve(address(collateralVault), initialCollateral);
        collateralVault.deposit(initialCollateral, address(usdc));

        user = address(0xBEEF);
        vm.label(user, "user");
        vm.label(address(collateralVault), "collateralVault");
        vm.label(address(amoManager), "amoManagerV2");
        vm.label(address(debtToken), "amoDebtToken");

        targetContract(address(this));
        bytes4[] memory selectors = new bytes4[](9);
        selectors[0] = this.increaseAmoSupply.selector;
        selectors[1] = this.decreaseAmoSupply.selector;
        selectors[2] = this.churnAllocation.selector;
        selectors[3] = this.toggleGuardianPause.selector;
        selectors[4] = this.setPegDeviation.selector;
        selectors[5] = this.shockOracle.selector;
        selectors[6] = this.issueWithCollateral.selector;
        selectors[7] = this.redeemForCollateral.selector;
        selectors[8] = this.injectFakeVaultValue.selector;
        targetSelector(FuzzSelector({ addr: address(this), selectors: selectors }));
    }

    // -------------------------------------------------------------------------
    // Action generators
    // -------------------------------------------------------------------------

    function increaseAmoSupply(uint256 vaultIndex, uint256 rawAmount) public {
        MockAmoVault vault = _vaultByIndex(vaultIndex);
        uint256 amount = bound(rawAmount, 1, MAX_AMO_MINT);
        (bool breached, address asset, uint256 price, uint256 guard) = _pegGuardStatus();

        if (increaseRolePaused) {
            vm.expectRevert();
            amoManager.increaseAmoSupply(amount, address(vault));
            return;
        }

        if (breached) {
            uint256 baseUnit = amoManager.baseCurrencyUnit();
            vm.expectRevert(
                abi.encodeWithSelector(
                    AmoManagerV2.PegDeviationExceeded.selector,
                    asset,
                    price,
                    baseUnit,
                    guard
                )
            );
            amoManager.increaseAmoSupply(amount, address(vault));
            return;
        }

        amoManager.increaseAmoSupply(amount, address(vault));
        uint256 debtUnits = amoManager.baseToDebtUnits(amoManager.dstableAmountToBaseValue(amount));
        trackedDebtUnits[address(vault)] += debtUnits;
        trackedDstable[address(vault)] += amount;
        totalTrackedDebt += debtUnits;
    }

    function decreaseAmoSupply(uint256 vaultIndex, uint256 rawAmount) public {
        MockAmoVault vault = _vaultByIndex(vaultIndex);
        uint256 balance = dstable.balanceOf(address(vault));
        if (balance == 0) {
            return;
        }

        uint256 amount = bound(rawAmount, 1, balance);
        uint256 tracked = trackedDstable[address(vault)];
        if (tracked == 0) {
            return;
        }
        if (amount > tracked) {
            amount = tracked;
        }
        (bool breached, address asset, uint256 price, uint256 guard) = _pegGuardStatus();

        if (breached) {
            uint256 baseUnit = amoManager.baseCurrencyUnit();
            vm.expectRevert(
                abi.encodeWithSelector(
                    AmoManagerV2.PegDeviationExceeded.selector,
                    asset,
                    price,
                    baseUnit,
                    guard
                )
            );
            amoManager.decreaseAmoSupply(amount, address(vault));
            return;
        }

        amoManager.decreaseAmoSupply(amount, address(vault));
        uint256 debtUnits = amoManager.baseToDebtUnits(amoManager.dstableAmountToBaseValue(amount));
        if (debtUnits > trackedDebtUnits[address(vault)]) {
            debtUnits = trackedDebtUnits[address(vault)];
        }
        trackedDebtUnits[address(vault)] -= debtUnits;
        totalTrackedDebt -= debtUnits;
        trackedDstable[address(vault)] -= amount;
    }

    function churnAllocation(uint256 fromIndex, uint256 toIndex, uint256 rawAmount) public {
        if (amoVaults.length == 0 || fromIndex == toIndex) {
            return;
        }

        MockAmoVault fromVault = _vaultByIndex(fromIndex);
        MockAmoVault toVault = _vaultByIndex(toIndex);

        uint256 available = dstable.balanceOf(address(fromVault));
        if (available == 0) {
            return;
        }

        uint256 amount = bound(rawAmount, 1, available);
        decreaseAmoSupply(fromIndex, amount);
        increaseAmoSupply(toIndex, amount);
    }

    function toggleGuardianPause(uint256 seed) public {
        bool pause = seed % 2 == 0;
        bytes32 role = amoManager.AMO_INCREASE_ROLE();

        if (pause && !increaseRolePaused) {
            amoManager.revokeRole(role, address(this));
            increaseRolePaused = true;
        } else if (!pause && increaseRolePaused) {
            amoManager.grantRole(role, address(this));
            increaseRolePaused = false;
        }
    }

    function setPegDeviation(uint256 rawBps) public {
        uint256 newBps = bound(rawBps, 0, 40_000);
        if (newBps > BasisPointConstants.ONE_HUNDRED_PERCENT_BPS) {
            vm.expectRevert(
                abi.encodeWithSelector(
                    AmoManagerV2.PegDeviationOutOfRange.selector,
                    newBps,
                    BasisPointConstants.ONE_HUNDRED_PERCENT_BPS
                )
            );
        }
        amoManager.setPegDeviationBps(newBps);
    }

    function shockOracle(uint256 assetChoice, int256 rawDeltaBps) public {
        int256 deltaBps = bound(rawDeltaBps, -int256(MAX_ORACLE_SHOCK_BPS), int256(MAX_ORACLE_SHOCK_BPS));
        uint256 baseBps = 10_000;
        int256 newBps = int256(baseBps) + deltaBps;
        if (newBps <= 0) {
            newBps = 1;
        }

        uint256 targetPrice = (BASE_UNIT * uint256(newBps)) / baseBps;

        if (assetChoice % 3 == 0) {
            oracle.setPrice(address(dstable), targetPrice);
        } else if (assetChoice % 3 == 1) {
            oracle.setPrice(address(debtToken), targetPrice);
        } else {
            oracle.setPrice(address(usdc), targetPrice);
        }
    }

    function issueWithCollateral(uint256 rawAmount) public {
        uint256 amount = bound(rawAmount, 1, MAX_ISSUE_COLLATERAL);
        usdc.mint(user, amount);

        vm.startPrank(user);
        if (usdc.allowance(user, address(issuer)) < amount) {
            usdc.approve(address(issuer), type(uint256).max);
        }

        try issuer.issue(amount, address(usdc), 0) {
            // no-op: issuance success
        } catch {
            // ignore expected reverts from collateral limits
        }
        vm.stopPrank();
    }

    function redeemForCollateral(uint256 rawAmount) public {
        uint256 balance = dstable.balanceOf(user);
        if (balance == 0) {
            return;
        }

        uint256 amount = bound(rawAmount, 1, balance);

        vm.startPrank(user);
        if (dstable.allowance(user, address(redeemer)) < amount) {
            dstable.approve(address(redeemer), type(uint256).max);
        }

        try redeemer.redeem(amount, address(usdc), 0) {
            // success path
        } catch {
            // skip if redemption blocked (fees, pauses, etc.)
        }
        vm.stopPrank();
    }

    function injectFakeVaultValue(uint256 vaultIndex, uint256 rawValue) public {
        MockAmoVault vault = _vaultByIndex(vaultIndex);
        uint256 boundedValue = bound(rawValue, 0, 5_000_000 * 1e18);
        vault.setFakeDeFiCollateralValue(boundedValue);
    }

    // -------------------------------------------------------------------------
    // Invariants
    // -------------------------------------------------------------------------

    function invariantDebtMatchesAllocations() public {
        uint256 supply = debtToken.totalSupply();
        uint256 allocatedDebt = totalTrackedDebt;
        uint256 toleranceDebt = amoManager.baseToDebtUnits(amoManager.tolerance()) + 1;

        if (supply >= allocatedDebt) {
            uint256 diff = supply - allocatedDebt;
            emit log_named_uint("amo debt supply", supply);
            emit log_named_uint("allocated debt units", allocatedDebt);
            emit log_named_uint("debt tolerance units", toleranceDebt);
            assertLe(diff, toleranceDebt, "AMO debt exceeds recorded allocation");
        } else {
            uint256 diff = allocatedDebt - supply;
            emit log_named_uint("amo debt supply", supply);
            emit log_named_uint("allocated debt units", allocatedDebt);
            emit log_named_uint("debt tolerance units", toleranceDebt);
            assertLe(diff, toleranceDebt, "Recorded allocation exceeds debt supply");
        }
    }

    function invariantCirculatingBackedByCollateral() public {
        uint256 totalSupply = dstable.totalSupply();
        uint256 amoHoldings = _amoDstableHoldings();
        uint256 circulating = totalSupply > amoHoldings ? totalSupply - amoHoldings : 0;

        uint256 circulatingBase = amoManager.dstableAmountToBaseValue(circulating);
        uint256 collateralBase = collateralVault.totalValue();

        emit log_named_uint("circulating dStable base", circulatingBase);
        emit log_named_uint("collateral base value", collateralBase);
        assertLe(circulatingBase, collateralBase, "Circulating dStable must remain fully collateralised");
    }

    function invariantGuardianPauseMatchesRole() public {
        bool hasRole = amoManager.hasRole(amoManager.AMO_INCREASE_ROLE(), address(this));
        emit log_named_uint("guardian paused (1=true)", increaseRolePaused ? 1 : 0);
        emit log_named_uint("contract holds increase role (1=true)", hasRole ? 1 : 0);
        assertEq(hasRole, !increaseRolePaused, "Pause bookkeeping diverges from role state");
    }

    // -------------------------------------------------------------------------
    // Helpers
    // -------------------------------------------------------------------------

    function _vaultByIndex(uint256 index) internal view returns (MockAmoVault) {
        return amoVaults[index % amoVaults.length];
    }

    function _amoDstableHoldings() internal view returns (uint256 total) {
        for (uint256 i = 0; i < amoVaults.length; i++) {
            total += dstable.balanceOf(address(amoVaults[i]));
        }
    }

    function _allocatedDebtUnits() internal view returns (uint256) {
        return totalTrackedDebt;
    }

    function _pegGuardStatus() internal view returns (bool breached, address asset, uint256 price, uint256 guard) {
        guard = amoManager.pegDeviationBps();
        if (guard == 0) {
            return (false, address(0), 0, 0);
        }

        uint256 baseUnit = amoManager.baseCurrencyUnit();

        uint256 stablePrice = oracle.getAssetPrice(address(dstable));
        if (_deviationBps(stablePrice, baseUnit) > guard) {
            return (true, address(dstable), stablePrice, guard);
        }

        uint256 debtPrice = oracle.getAssetPrice(address(debtToken));
        if (_deviationBps(debtPrice, baseUnit) > guard) {
            return (true, address(debtToken), debtPrice, guard);
        }

        return (false, address(0), 0, guard);
    }

    function _deviationBps(uint256 price, uint256 baseUnit) internal pure returns (uint256) {
        if (price == baseUnit) {
            return 0;
        }
        uint256 diff = price > baseUnit ? price - baseUnit : baseUnit - price;
        return (diff * BasisPointConstants.ONE_HUNDRED_PERCENT_BPS) / baseUnit;
    }
}
