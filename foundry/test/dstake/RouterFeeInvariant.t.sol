// SPDX-License-Identifier: MIT
pragma solidity ^0.8.20;

import "forge-std/Test.sol";

import { IERC20 } from "@openzeppelin/contracts/token/ERC20/IERC20.sol";
import { IERC4626 } from "@openzeppelin/contracts/interfaces/IERC4626.sol";

import { MockDStakeToken } from "../utils/MockDStakeToken.sol";
import { DStakeRouterV2 } from "vaults/dstake/DStakeRouterV2.sol";
import { DStakeRouterV2Storage } from "../../../../contracts/vaults/dstake/DStakeRouterV2Storage.sol";
import { DStakeRouterV2GovernanceModule } from "../../../../contracts/vaults/dstake/DStakeRouterV2GovernanceModule.sol";
import { WithdrawalFeeMath } from "common/WithdrawalFeeMath.sol";
import { TestMintableERC20 } from "../utils/TestMintableERC20.sol";
import { InvariantDStakeCollateralVault } from "../utils/InvariantDStakeCollateralVault.sol";
import { InvariantStableAdapter, StrategyShare } from "../utils/InvariantStableAdapter.sol";

contract RouterFeeInvariant is Test {

    uint256 private constant MAX_ASSET_DEPOSIT = 5e24;
    uint256 private constant MAX_SHARE_DEPOSIT = 5e24;
    uint256 private constant MAX_DUST_TOLERANCE = 1e6;
    uint256 private constant MAX_SHORTFALL = 1e25;
    uint256 private constant ONE_HUNDRED_PERCENT_BPS = 1_000_000;

    TestMintableERC20 internal dstable;
    MockDStakeToken internal dStakeToken;
    InvariantDStakeCollateralVault internal collateralVault;
    DStakeRouterV2 internal router;

    address internal solver;
    address internal feeClaimer;

    struct VaultState {
        InvariantStableAdapter adapter;
        StrategyShare share;
        bool exists;
    }

    VaultState[] internal vaultStates;
    mapping(address => uint256) internal shareIndex;

    uint256 internal feeBuffer;
    uint256 internal lastReinvestAmount;
    uint256 internal lastReinvestIncentive;
    uint256 internal lastReinvestBps;

    function setUp() public {
        solver = address(0xBEEF);
        feeClaimer = address(0xFEED);

        dstable = new TestMintableERC20("dStable", "dSTB", 18);
        dstable.setMinter(address(this), true);

        collateralVault = new InvariantDStakeCollateralVault(address(dstable));
        dStakeToken = new MockDStakeToken(address(dstable));

        router = new DStakeRouterV2(address(dStakeToken), address(collateralVault));

        DStakeRouterV2GovernanceModule governanceModule = new DStakeRouterV2GovernanceModule(address(dStakeToken), address(collateralVault));
        router.setGovernanceModule(address(governanceModule));

        collateralVault.setDStakeToken(address(dStakeToken));
        collateralVault.setRouter(address(router));

        dStakeToken.setRouter(address(router));

        router.setDepositCap(5e26);
        router.setDustTolerance(25);
        router.setReinvestIncentive(250); // 0.025%
        router.setWithdrawalFee(350); // 0.035%

        _deployVault(6_000);
        _deployVault(2_500);
        _deployVault(1_500);

        router.setDefaultDepositStrategyShare(address(vaultStates[0].share));

        _ensureSolverApproval();

        _seedInitialLiquidity();
        _syncSystem();

        targetContract(address(this));
        bytes4[] memory selectors = new bytes4[](11);
        selectors[0] = this.solverDepositAssets.selector;
        selectors[1] = this.solverDepositShares.selector;
        selectors[2] = this.solverWithdrawAssets.selector;
        selectors[3] = this.solverWithdrawShares.selector;
        selectors[4] = this.adjustWithdrawalFee.selector;
        selectors[5] = this.adjustReinvestIncentive.selector;
        selectors[6] = this.adjustDustTolerance.selector;
        selectors[7] = this.reinvestFees.selector;
        selectors[8] = this.sweepSurplus.selector;
        selectors[9] = this.manageShortfall.selector;
        selectors[10] = this.toggleTotalsInvariantBypass.selector;
        targetSelector(FuzzSelector({ addr: address(this), selectors: selectors }));
    }

    // -------------------------------------------------------------------------
    // Actions
    // -------------------------------------------------------------------------

    function solverDepositAssets(uint256 seed, uint256 rawAmount) public {
        address[] memory selected = _selectVaults(seed, true);
        uint256 count = selected.length;
        if (count == 0) return;

        uint256 cap = router.depositCap();
        uint256 managed = router.totalManagedAssets();
        if (cap != 0 && managed >= cap) return;

        uint256 amount = bound(rawAmount, 1, MAX_ASSET_DEPOSIT);
        if (cap != 0 && managed + amount > cap) {
            amount = cap - managed;
            if (amount == 0) return;
        }

        uint256[] memory amounts = _distributeAmounts(seed, amount, count);
        uint256 total;
        for (uint256 i = 0; i < count; i++) {
            total += amounts[i];
        }
        if (total == 0) {
            amounts[seed % count] = amount;
            total = amount;
        }

        dstable.mint(solver, total);

        vm.startPrank(solver);
        router.solverDepositAssets(selected, amounts, 0, solver);
        vm.stopPrank();

        _syncSystem();
    }

    function solverDepositShares(uint256 seed, uint256 rawShareAmount) public {
        address[] memory selected = _selectVaults(seed, true);
        uint256 count = selected.length;
        if (count == 0) return;

        uint256 totalShareAmount = bound(rawShareAmount, 1, MAX_SHARE_DEPOSIT);
        uint256[] memory shareAmounts = _distributeAmounts(seed, totalShareAmount, count);

        uint256 totalAssets;
        uint256[] memory assets = new uint256[](count);
        for (uint256 i = 0; i < count; i++) {
            if (shareAmounts[i] == 0) continue;
            assets[i] = IERC4626(selected[i]).previewMint(shareAmounts[i]);
            totalAssets += assets[i];
        }

        if (totalAssets == 0) return;

        uint256 cap = router.depositCap();
        if (cap != 0 && router.totalManagedAssets() + totalAssets > cap) {
            return;
        }

        dstable.mint(solver, totalAssets);

        vm.startPrank(solver);
        router.solverDepositShares(selected, shareAmounts, 0, solver);
        vm.stopPrank();

        _syncSystem();
    }

    function solverWithdrawAssets(uint256 seed, uint256 rawAmount) public {
        uint256 userShares = dStakeToken.balanceOf(solver);
        if (userShares == 0) return;

        uint256 maxNet = router.maxWithdraw(solver);
        if (maxNet == 0) return;

        uint256 amount = bound(rawAmount, 1, maxNet);
        address[] memory selected = _selectVaults(seed, false);
        uint256 count = selected.length;
        if (count == 0) return;

        uint256[] memory amounts = _distributeAmounts(seed, amount, count);
        uint256 total;
        for (uint256 i = 0; i < count; i++) {
            total += amounts[i];
        }
        if (total == 0) {
            amounts[seed % count] = amount;
            total = amount;
        }

        vm.startPrank(solver);
        (uint256 netAssets, uint256 fee, ) = router.solverWithdrawAssets(
            selected,
            amounts,
            userShares,
            solver,
            solver
        );
        vm.stopPrank();

        if (netAssets > 0) {
            feeBuffer += fee;
        }

        _syncSystem();
    }

    function solverWithdrawShares(uint256 seed, uint256 rawScale) public {
        uint256 userShares = dStakeToken.balanceOf(solver);
        if (userShares == 0) return;

        address[] memory selected = _selectVaults(seed, false);
        uint256 count = selected.length;
        if (count == 0) return;

        uint256[] memory shareAmounts = new uint256[](count);
        uint256 totalShares;
        for (uint256 i = 0; i < count; i++) {
            uint256 balance = IERC20(selected[i]).balanceOf(address(collateralVault));
            if (balance == 0) continue;
            uint256 amount = uint256(keccak256(abi.encode(seed, rawScale, i))) % (balance + 1);
            shareAmounts[i] = amount;
            totalShares += amount;
        }

        if (totalShares == 0) return;

        vm.startPrank(solver);
        (, uint256 fee, ) = router.solverWithdrawShares(selected, shareAmounts, userShares, solver, solver);
        vm.stopPrank();

        feeBuffer += fee;
        _syncSystem();
    }

    function adjustWithdrawalFee(uint256 rawFeeBps) public {
        uint256 maxFee = router.maxWithdrawalFeeBps();
        uint256 newFee = rawFeeBps % (maxFee + 1);
        router.setWithdrawalFee(newFee);
        _syncSystem();
    }

    function adjustReinvestIncentive(uint256 rawIncentiveBps) public {
        uint256 maxIncentive = router.MAX_REINVEST_INCENTIVE_BPS();
        uint256 newIncentive = rawIncentiveBps % (maxIncentive + 1);
        router.setReinvestIncentive(newIncentive);
    }

    function adjustDustTolerance(uint256 rawDust) public {
        uint256 tolerance = bound(rawDust, 1, MAX_DUST_TOLERANCE);
        router.setDustTolerance(tolerance);
    }

    function reinvestFees(uint256 seed) public {
        uint256 idleBefore = _routerIdle();
        vm.prank(seed % 2 == 0 ? feeClaimer : address(0xC0FFEE));
        (uint256 amount, uint256 incentive) = router.reinvestFees();
        lastReinvestAmount = amount;
        lastReinvestIncentive = incentive;
        lastReinvestBps = router.reinvestIncentiveBps();

        if (idleBefore > 0) {
            if (idleBefore >= feeBuffer) {
                feeBuffer = 0;
            } else {
                feeBuffer -= idleBefore;
            }
        }

        _syncSystem();
    }

    function sweepSurplus(uint256 rawLimit) public {
        uint256 idleBefore = _routerIdle();
        if (idleBefore == 0) return;

        uint256 maxAmount = rawLimit % (idleBefore + 1);
        if (maxAmount == 0) {
            maxAmount = idleBefore;
        }

        uint256 navBefore = _aggregateVaultValue();

        vm.prank(feeClaimer);
        router.sweepSurplus(maxAmount);

        uint256 idleAfter = _routerIdle();
        uint256 navAfter = _aggregateVaultValue();

        assertGe(navAfter, navBefore, "sweep must increase or maintain vault NAV");
        assertLe(idleAfter, idleBefore, "sweep must not increase idle balance");

        if (idleBefore > idleAfter) {
            uint256 swept = idleBefore - idleAfter;
            if (swept >= feeBuffer) {
                feeBuffer = 0;
            } else {
                feeBuffer -= swept;
            }
        }

        _syncSystem();
    }

    function manageShortfall(int256 rawDelta) public {
        if (rawDelta == 0) return;
        if (rawDelta > 0) {
            uint256 delta = bound(uint256(rawDelta), 1, MAX_SHORTFALL);
            try router.recordShortfall(delta) {} catch {}
        } else {
            uint256 current = router.currentShortfall();
            if (current == 0) return;
            uint256 delta = bound(uint256(-rawDelta), 1, current);
            router.clearShortfall(delta);
        }
    }

    function toggleTotalsInvariantBypass(uint256 rawFlag) public {
        bool enable = rawFlag % 2 == 0;
        address(router).call(abi.encodeWithSignature("setTotalsInvariantBypass(bool)", enable));
    }

    // -------------------------------------------------------------------------
    // Invariants
    // -------------------------------------------------------------------------

    function invariantBackingCoversVaults() public view {
        uint256 idle = _routerIdle();
        uint256 nav = _aggregateVaultValue();
        uint256 shortfall = router.currentShortfall();
        uint256 tokenAssets = dStakeToken.totalAssets();

        if (nav + idle > shortfall) {
            uint256 requiredBacking = nav + idle - shortfall;
            assertGe(tokenAssets, requiredBacking, "dStakeToken assets must cover vaults + idle - shortfall");
        } else {
            assertEq(tokenAssets, 0, "token assets zeroed when shortfall eclipses NAV");
        }
    }

    function invariantWithdrawalPreviewsRespectFees() public view {
        uint256 solverShares = dStakeToken.balanceOf(solver);
        if (solverShares == 0) return;

        uint256 sampleShares = solverShares / 2;
        if (sampleShares == 0) {
            sampleShares = solverShares;
        }
        uint256 netFromRedeem = dStakeToken.previewRedeem(sampleShares);
        if (netFromRedeem == 0) return;

        uint256 sharesNeeded = dStakeToken.previewWithdraw(netFromRedeem);
        uint256 roundTripNet = dStakeToken.previewRedeem(sharesNeeded);

        uint256 dust = router.dustTolerance() + 1;
        uint256 diff = netFromRedeem > roundTripNet ? netFromRedeem - roundTripNet : roundTripNet - netFromRedeem;
        assertLe(diff, dust, "withdraw previews deviate beyond dust tolerance");

        uint256 feeBps = router.withdrawalFeeBps();
        uint256 inferredGross = WithdrawalFeeMath.grossFromNet(netFromRedeem, feeBps);
        uint256 expectedNet = WithdrawalFeeMath.netAfterFee(inferredGross, feeBps);
        uint256 feeDrift = netFromRedeem > expectedNet ? netFromRedeem - expectedNet : expectedNet - netFromRedeem;
        assertLe(feeDrift, dust, "net preview must align with configured fee bps");
    }

    function invariantReinvestIncentiveBounded() public view {
        if (lastReinvestAmount == 0 && lastReinvestIncentive == 0) {
            return;
        }

        uint256 totalProcessed = lastReinvestAmount + lastReinvestIncentive;
        if (totalProcessed == 0) return;

        uint256 maxIncentive = (totalProcessed * lastReinvestBps) / ONE_HUNDRED_PERCENT_BPS;
        assertLe(
            lastReinvestIncentive,
            maxIncentive + 1,
            "incentive paid exceeds configured reinvest bps allowance"
        );
    }

    function invariantIdleWithinTolerance() public view {
        uint256 idle = _routerIdle();
        uint256 tolerance = router.dustTolerance() + 1;
        assertLe(idle, feeBuffer + tolerance, "router idle exceeds fees owed plus dust tolerance");
    }

    // -------------------------------------------------------------------------
    // Helpers
    // -------------------------------------------------------------------------

    function _deployVault(uint256 targetBps) internal {
        InvariantStableAdapter adapter = new InvariantStableAdapter(address(dstable), address(collateralVault));
        StrategyShare share = StrategyShare(adapter.strategyShare());

        collateralVault.addSupportedStrategyShare(address(share));
        router.addVaultConfig(
            address(share),
            address(adapter),
            targetBps,
            DStakeRouterV2Storage.VaultStatus.Active
        );

        vaultStates.push(VaultState({ adapter: adapter, share: share, exists: true }));
        shareIndex[address(share)] = vaultStates.length - 1;
    }

    function _seedInitialLiquidity() internal {
        address[] memory vaults = new address[](vaultStates.length);
        uint256[] memory amounts = new uint256[](vaultStates.length);
        uint256 total;

        for (uint256 i = 0; i < vaultStates.length; i++) {
            vaults[i] = address(vaultStates[i].share);
            amounts[i] = (i + 1) * 1e21;
            total += amounts[i];
        }

        dstable.mint(solver, total);

        vm.startPrank(solver);
        router.solverDepositAssets(vaults, amounts, 0, solver);
        vm.stopPrank();
    }

    function _ensureSolverApproval() internal {
        vm.startPrank(solver);
        dstable.approve(address(router), type(uint256).max);
        vm.stopPrank();
    }

    function _selectVaults(uint256 seed, bool deposits) internal view returns (address[] memory) {
        uint256 vaultCount = router.getVaultCount();
        if (vaultCount == 0) return new address[](0);

        address[] memory temp = new address[](vaultCount);
        uint256 count;
        for (uint256 i = 0; i < vaultCount; i++) {
            DStakeRouterV2Storage.VaultConfig memory cfg = router.getVaultConfigByIndex(i);
            if (_isEligible(cfg, deposits)) {
                temp[count++] = cfg.strategyVault;
            }
        }

        if (count == 0) return new address[](0);

        uint256 selectCount = (seed % count) + 1;
        address[] memory selected = new address[](selectCount);
        for (uint256 i = 0; i < selectCount; i++) {
            selected[i] = temp[(seed + i) % count];
        }
        return selected;
    }

    function _isEligible(DStakeRouterV2Storage.VaultConfig memory cfg, bool deposits) internal pure returns (bool) {
        if (cfg.adapter == address(0)) return false;
        if (deposits) {
            return cfg.status == DStakeRouterV2Storage.VaultStatus.Active && cfg.targetBps > 0;
        }
        return cfg.status == DStakeRouterV2Storage.VaultStatus.Active || cfg.status == DStakeRouterV2Storage.VaultStatus.Impaired;
    }

    function _distributeAmounts(uint256 seed, uint256 amount, uint256 count) internal pure returns (uint256[] memory) {
        uint256[] memory amounts = new uint256[](count);
        uint256 remaining = amount;
        for (uint256 i = 0; i < count; i++) {
            if (i == count - 1) {
                amounts[i] = remaining;
            } else {
                uint256 chunk = uint256(keccak256(abi.encode(seed, i, remaining))) % (remaining + 1);
                amounts[i] = chunk;
                remaining -= chunk;
            }
        }
        return amounts;
    }

    function _syncSystem() internal {
        uint256 total;
        for (uint256 i = 0; i < vaultStates.length; i++) {
            VaultState storage state = vaultStates[i];
            if (!state.exists) continue;
            uint256 balance = IERC20(address(state.share)).balanceOf(address(collateralVault));
            if (balance == 0) continue;
            try state.adapter.strategyShareValueInDStable(address(state.share), balance) returns (uint256 value) {
                total += value;
            } catch {}
        }

        collateralVault.setTotalValue(total);
    }

    function _aggregateVaultValue() internal view returns (uint256 total) {
        for (uint256 i = 0; i < vaultStates.length; i++) {
            VaultState storage state = vaultStates[i];
            if (!state.exists) continue;
            uint256 balance = IERC20(address(state.share)).balanceOf(address(collateralVault));
            if (balance == 0) continue;
            try state.adapter.strategyShareValueInDStable(address(state.share), balance) returns (uint256 value) {
                total += value;
            } catch {}
        }
    }

    function _routerIdle() internal view returns (uint256) {
        return dstable.balanceOf(address(router));
    }
}
