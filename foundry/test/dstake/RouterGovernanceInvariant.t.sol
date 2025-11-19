// SPDX-License-Identifier: MIT
pragma solidity ^0.8.20;

import "forge-std/Test.sol";

import { IERC20 } from "@openzeppelin/contracts/token/ERC20/IERC20.sol";
import { IERC4626 } from "@openzeppelin/contracts/interfaces/IERC4626.sol";
import { Math } from "@openzeppelin/contracts/utils/math/Math.sol";

import { DStakeRouterV2 } from "vaults/dstake/DStakeRouterV2.sol";
import { DStakeRouterV2Storage } from "../../../../contracts/vaults/dstake/DStakeRouterV2Storage.sol";
import { DStakeRouterV2GovernanceModule } from "../../../../contracts/vaults/dstake/DStakeRouterV2GovernanceModule.sol";
import { WithdrawalFeeMath } from "common/WithdrawalFeeMath.sol";

import { TestMintableERC20 } from "../utils/TestMintableERC20.sol";
import { InvariantDStakeCollateralVault } from "../utils/InvariantDStakeCollateralVault.sol";
import { MockDStakeToken } from "../utils/MockDStakeToken.sol";
import { InvariantDynamicStrategyAdapter } from "../utils/InvariantDynamicStrategyAdapter.sol";
import { StrategyShare } from "../utils/InvariantStableAdapter.sol";

contract RouterGovernanceInvariant is Test {
    using stdStorage for StdStorage;

    uint256 private constant MAX_ASSET_DEPOSIT = 5e24;
    uint256 private constant MAX_SHARE_MINT = 5e24;
    uint256 private constant MAX_NAV_SHIFT = 1e22;
    uint256 private constant MAX_VAULTS = 6;
    uint256 private constant TARGET_SCALE = 10_000;

    TestMintableERC20 internal dstable;
    MockDStakeToken internal dStakeToken;
    InvariantDStakeCollateralVault internal collateralVault;
    DStakeRouterV2 internal router;

    address internal solver;
    address internal feeClaimer;

    struct VaultState {
        InvariantDynamicStrategyAdapter adapter;
        StrategyShare share;
        bool exists;
    }

    VaultState[] internal vaultStates;
    mapping(address => uint256) internal shareIndex;

    uint256 internal lastShareWithdrawGross;
    uint256 internal lastShareWithdrawNet;
    uint256 internal lastShareWithdrawFee;

    function setUp() public {
        solver = address(0xBEEF);
        feeClaimer = address(0xFEED);

        dstable = new TestMintableERC20("dStable", "dSTB", 18);
        dstable.setMinter(address(this), true);

        collateralVault = new InvariantDStakeCollateralVault(address(dstable));
        collateralVault.setOwner(address(this));

        dStakeToken = new MockDStakeToken(address(dstable));
        dStakeToken.setOwner(address(this));

        router = new DStakeRouterV2(address(dStakeToken), address(collateralVault));

        DStakeRouterV2GovernanceModule governanceModule = new DStakeRouterV2GovernanceModule(address(dStakeToken), address(collateralVault));
        router.setGovernanceModule(address(governanceModule));

        dStakeToken.setRouter(address(router));
        collateralVault.setRouter(address(router));
        collateralVault.setDStakeToken(address(dStakeToken));

        router.setDepositCap(5e25);
        router.setDustTolerance(25);
        router.setReinvestIncentive(250);
        router.setWithdrawalFee(300); // 0.03%

        _deployVault(4_000);
        _deployVault(3_500);
        _deployVault(2_500);

        router.setDefaultDepositStrategyShare(address(vaultStates[0].share));

        _syncSystem();

        targetContract(address(this));
        bytes4[] memory selectors = new bytes4[](13);
        selectors[0] = this.depositViaAssets.selector;
        selectors[1] = this.depositViaShares.selector;
        selectors[2] = this.withdrawViaAssets.selector;
        selectors[3] = this.withdrawViaShares.selector;
        selectors[4] = this.suspendVault.selector;
        selectors[5] = this.removeAdapterForVault.selector;
        selectors[6] = this.restoreVaultConfig.selector;
        selectors[7] = this.normalizeVaultTargets.selector;
        selectors[8] = this.setDefaultVault.selector;
        selectors[9] = this.manageShortfall.selector;
        selectors[10] = this.shiftNav.selector;
        selectors[11] = this.reinstateAdapter.selector;
        selectors[12] = this.reinvestFees.selector;
        targetSelector(FuzzSelector({ addr: address(this), selectors: selectors }));
    }

    // -------------------------------------------------------------------------
    // Solver + Governance Actions
    // -------------------------------------------------------------------------

    function depositViaAssets(uint256 seed, uint256 rawAmount) public {
        address[] memory selected = _selectVaults(seed, true);
        uint256 count = selected.length;
        if (count == 0) return;

        uint256 cap = router.depositCap();
        uint256 managed = router.totalManagedAssets();
        if (cap != 0 && managed >= cap) {
            return;
        }

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
        dstable.approve(address(router), total);
        router.solverDepositAssets(selected, amounts, 0, solver);
        vm.stopPrank();

        _syncSystem();
    }

    function depositViaShares(uint256 seed, uint256 rawShareAmount) public {
        address[] memory selected = _selectVaults(seed, true);
        uint256 count = selected.length;
        if (count == 0) return;

        uint256 cap = router.depositCap();
        uint256 managed = router.totalManagedAssets();
        if (cap != 0 && managed >= cap) {
            return;
        }

        uint256 totalShareAmount = bound(rawShareAmount, 1, MAX_SHARE_MINT);
        uint256[] memory shareAmounts = _distributeAmounts(seed, totalShareAmount, count);

        uint256 totalAssets;
        uint256[] memory assetAmounts = new uint256[](count);
        for (uint256 i = 0; i < count; i++) {
            if (shareAmounts[i] == 0) continue;
            assetAmounts[i] = IERC4626(selected[i]).previewMint(shareAmounts[i]);
            totalAssets += assetAmounts[i];
        }
        if (totalAssets == 0) return;
        if (cap != 0 && managed + totalAssets > cap) {
            return;
        }

        dstable.mint(solver, totalAssets);

        vm.startPrank(solver);
        dstable.approve(address(router), totalAssets);
        router.solverDepositShares(selected, shareAmounts, 0, solver);
        vm.stopPrank();

        _syncSystem();
    }

    function withdrawViaAssets(uint256 seed, uint256 rawAmount) public {
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
        for (uint256 i = 0; i < amounts.length; i++) {
            total += amounts[i];
        }
        if (total == 0) {
            amounts[seed % count] = amount;
            total = amount;
        }

        vm.startPrank(solver);
        router.solverWithdrawAssets(selected, amounts, userShares, solver, solver);
        vm.stopPrank();

        _syncSystem();
    }

    function withdrawViaShares(uint256 seed, uint256 rawShareAmount) public {
        uint256 userShares = dStakeToken.balanceOf(solver);
        if (userShares == 0) return;

        address[] memory selected = _selectWithdrawableVaults(seed);
        if (selected.length == 0) return;

        uint256 totalShares = bound(rawShareAmount, 1, userShares);
        uint256[] memory shareAmounts = _distributeAmounts(seed, totalShares, selected.length);

        for (uint256 i = 0; i < selected.length; i++) {
            uint256 available = IERC20(selected[i]).balanceOf(address(collateralVault));
            if (shareAmounts[i] > available) {
                shareAmounts[i] = available;
            }
        }

        uint256 grossPreview;
        for (uint256 i = 0; i < selected.length; i++) {
            uint256 shares = shareAmounts[i];
            if (shares == 0) continue;
            grossPreview += IERC4626(selected[i]).previewRedeem(shares);
        }
        if (grossPreview == 0) return;

        vm.startPrank(solver);
        (uint256 net, uint256 fee, ) = router.solverWithdrawShares(selected, shareAmounts, userShares, solver, solver);
        vm.stopPrank();

        lastShareWithdrawNet = net;
        lastShareWithdrawFee = fee;
        lastShareWithdrawGross = net + fee;

        _syncSystem();
    }

    function suspendVault(uint8 seed) public {
        uint256 vaultCount = router.getVaultCount();
        if (vaultCount == 0) return;
        address target = router.getVaultConfigByIndex(seed % vaultCount).strategyVault;
        router.suspendVaultForRemoval(target);
        _ensureDefaultVaultHealthy();
    }

    function removeAdapterForVault(uint8 seed) public {
        uint256 vaultCount = router.getVaultCount();
        if (vaultCount == 0) return;
        address target = router.getVaultConfigByIndex(seed % vaultCount).strategyVault;
        DStakeRouterV2Storage.VaultConfig memory cfg = router.getVaultConfig(target);
        if (cfg.status != DStakeRouterV2Storage.VaultStatus.Suspended || cfg.targetBps != 0) {
            router.suspendVaultForRemoval(target);
            cfg = router.getVaultConfig(target);
        }
        address adapter = router.strategyShareToAdapter(target);
        if (adapter == address(0)) {
            return;
        }
        router.removeAdapter(target);
        _ensureDefaultVaultHealthy();
    }

    function restoreVaultConfig(uint8 seed, uint16 bias) public {
        uint256 vaultCount = router.getVaultCount();
        if (vaultCount == 0) return;

        address target = router.getVaultConfigByIndex(seed % vaultCount).strategyVault;
        VaultState storage state = _vaultState(target);

        uint256 remaining = TARGET_SCALE - _activeTargetSumExcluding(target);
        uint256 targetBps = remaining == 0 ? 0 : 1 + (uint256(bias) % remaining);

        router.updateVaultConfig(
            DStakeRouterV2Storage.VaultConfig({
                strategyVault: target,
                adapter: address(state.adapter),
                targetBps: targetBps,
                status: DStakeRouterV2Storage.VaultStatus.Active
            })
        );
        _ensureDefaultVaultHealthy();
    }

    function normalizeVaultTargets(uint256 seed) public {
        uint256 vaultCount = router.getVaultCount();
        if (vaultCount == 0) return;

        DStakeRouterV2Storage.VaultConfig[] memory configs = new DStakeRouterV2Storage.VaultConfig[](vaultCount);
        uint256 remaining = TARGET_SCALE;
        uint256 lastActiveIndex = type(uint256).max;

        for (uint256 i = 0; i < vaultCount; i++) {
            address vault = router.getVaultConfigByIndex(i).strategyVault;
            VaultState storage state = _vaultState(vault);

            DStakeRouterV2Storage.VaultStatus status = DStakeRouterV2Storage.VaultStatus(uint8(uint256(keccak256(abi.encode(seed, i))) % 3));
            uint256 target = 0;
            if (status == DStakeRouterV2Storage.VaultStatus.Active) {
                lastActiveIndex = i;
                if (i == vaultCount - 1) {
                    target = remaining;
                } else {
                    uint256 raw = uint256(keccak256(abi.encode(seed, i, remaining))) % (remaining + 1);
                    target = raw;
                }
                remaining -= target;
            }

            configs[i] = DStakeRouterV2Storage.VaultConfig({
                strategyVault: vault,
                adapter: address(state.adapter),
                targetBps: target,
                status: status
            });
        }

        if (remaining > 0) {
            if (lastActiveIndex == type(uint256).max) {
                return;
            }
            configs[lastActiveIndex].targetBps += remaining;
            remaining = 0;
        }

        router.setVaultConfigs(configs);
        _ensureDefaultVaultHealthy();
    }

    function setDefaultVault(uint8 seed) public {
        address[] memory active = router.getActiveVaultsForDeposits();
        if (active.length == 0) {
            router.clearDefaultDepositStrategyShare();
            return;
        }
        router.setDefaultDepositStrategyShare(active[seed % active.length]);
    }

    function manageShortfall(int256 deltaRaw) public {
        if (deltaRaw == 0) return;

        if (deltaRaw > 0) {
            uint256 managed = router.totalManagedAssets();
            if (managed == 0) return;
            uint256 amount = bound(uint256(deltaRaw), 1, managed);
            router.recordShortfall(amount);
        } else {
            uint256 current = router.currentShortfall();
            if (current == 0) return;
            uint256 amount = bound(uint256(-deltaRaw), 1, current);
            router.clearShortfall(amount);
        }
        _syncSystem();
    }

    function shiftNav(uint8 vaultSeed, int128 deltaRaw) public {
        if (deltaRaw == 0) return;
        if (vaultStates.length == 0) return;
        VaultState storage state = vaultStates[vaultSeed % vaultStates.length];
        if (!state.exists) return;

        int256 delta = deltaRaw;
        uint256 magnitude = uint256(delta > 0 ? delta : -delta);
        if (magnitude > MAX_NAV_SHIFT) {
            magnitude = MAX_NAV_SHIFT;
        }
        if (magnitude == 0) return;

        if (delta > 0) {
            dstable.mint(address(this), magnitude);
            dstable.approve(address(state.adapter), magnitude);
        }
        state.adapter.adjustReserves(delta);
        if (delta > 0) {
            dstable.approve(address(state.adapter), 0);
        }

        _syncSystem();
    }

    function reinstateAdapter(uint8 seed) public {
        if (router.getVaultCount() == 0) return;
        address target = router.getVaultConfigByIndex(seed % router.getVaultCount()).strategyVault;
        if (router.strategyShareToAdapter(target) != address(0)) {
            return;
        }
        VaultState storage state = _vaultState(target);
        router.addAdapter(address(state.share), address(state.adapter));
        _ensureDefaultVaultHealthy();
    }

    function reinvestFees(uint256 rawAmount) public {
        uint256 amount = bound(rawAmount, 1, 1e23);
        dstable.mint(address(router), amount);
        vm.prank(feeClaimer);
        router.reinvestFees();
        _syncSystem();
    }

    // -------------------------------------------------------------------------
    // Invariants
    // -------------------------------------------------------------------------

    function invariantDefaultVaultActive() public view {
        address defaultVault = router.defaultDepositStrategyShare();
        if (defaultVault == address(0)) return;
        DStakeRouterV2Storage.VaultConfig memory cfg = router.getVaultConfig(defaultVault);
        assertEq(uint8(cfg.status), uint8(DStakeRouterV2Storage.VaultStatus.Active), "default vault inactive");
        assertTrue(cfg.adapter != address(0), "default vault missing adapter");
    }

    function invariantTargetSumsBounded() public view {
        uint256 vaultCount = router.getVaultCount();
        uint256 totalTargets;
        for (uint256 i = 0; i < vaultCount; i++) {
            DStakeRouterV2Storage.VaultConfig memory cfg = router.getVaultConfigByIndex(i);
            totalTargets += cfg.targetBps;
            if (cfg.status != DStakeRouterV2Storage.VaultStatus.Active) {
                assertEq(cfg.targetBps, 0, "inactive vault carries target");
            }
        }
        assertLe(totalTargets, TARGET_SCALE, "target weights exceed 100%");
    }

    function invariantManagedAssetsSynced() public view {
        uint256 expectedVaultValue = _aggregateVaultValue();
        uint256 idle = dstable.balanceOf(address(router));
        assertEq(router.totalManagedAssets(), expectedVaultValue + idle, "managed assets drift");
    }

    function invariantShortfallMatchesSupply() public view {
        uint256 managed = router.totalManagedAssets();
        uint256 supply = dStakeToken.totalSupply();
        uint256 targetShortfall = supply > managed ? supply - managed : 0;
        uint256 tolerance = router.dustTolerance() + 10;
        assertApproxEqAbs(router.currentShortfall(), targetShortfall, tolerance, "shortfall mismatch");
    }

    function invariantShareWithdrawHonorsFee() public view {
        if (lastShareWithdrawGross == 0) return;
        uint256 expectedFee = WithdrawalFeeMath.calculateWithdrawalFee(
            lastShareWithdrawGross,
            router.withdrawalFeeBps()
        );
        assertEq(lastShareWithdrawFee, expectedFee, "fee preview mismatch");
        assertEq(lastShareWithdrawNet + lastShareWithdrawFee, lastShareWithdrawGross, "gross/net mismatch");
    }

    // -------------------------------------------------------------------------
    // Helpers
    // -------------------------------------------------------------------------

    function _deployVault(uint256 initialTargetBps) internal {
        if (router.getVaultCount() >= MAX_VAULTS) return;

        InvariantDynamicStrategyAdapter adapter = new InvariantDynamicStrategyAdapter(
            address(dstable),
            address(collateralVault)
        );
        adapter.setOwner(address(this));
        StrategyShare share = StrategyShare(adapter.strategyShare());
        collateralVault.addSupportedStrategyShare(address(share));

        router.addVaultConfig(
            address(share),
            address(adapter),
            initialTargetBps,
            DStakeRouterV2Storage.VaultStatus.Active
        );

        shareIndex[address(share)] = vaultStates.length;
        vaultStates.push(VaultState({ adapter: adapter, share: share, exists: true }));
    }

    function _selectVaults(uint256 seed, bool deposits) internal view returns (address[] memory) {
        uint256 vaultCount = router.getVaultCount();
        address[] memory temp = new address[](vaultCount);
        uint256 count;

        for (uint256 i = 0; i < vaultCount; i++) {
            DStakeRouterV2Storage.VaultConfig memory cfg = router.getVaultConfigByIndex(i);
            if (!_isEligible(cfg, deposits)) continue;
            if (uint256(keccak256(abi.encode(seed, i))) & 1 == 0) continue;
            temp[count++] = cfg.strategyVault;
        }

        if (count == 0) {
            for (uint256 i = 0; i < vaultCount; i++) {
                DStakeRouterV2Storage.VaultConfig memory cfg = router.getVaultConfigByIndex(i);
                if (_isEligible(cfg, deposits)) {
                    temp[count++] = cfg.strategyVault;
                    break;
                }
            }
        }

        address[] memory selected = new address[](count);
        for (uint256 i = 0; i < count; i++) {
            selected[i] = temp[i];
        }
        return selected;
    }

    function _selectWithdrawableVaults(uint256 seed) internal view returns (address[] memory) {
        uint256 vaultCount = router.getVaultCount();
        address[] memory temp = new address[](vaultCount);
        uint256 count;
        for (uint256 i = 0; i < vaultCount; i++) {
            DStakeRouterV2Storage.VaultConfig memory cfg = router.getVaultConfigByIndex(i);
            if (!_isEligible(cfg, false)) continue;
            if (IERC20(cfg.strategyVault).balanceOf(address(collateralVault)) == 0) continue;
            if (uint256(keccak256(abi.encode(seed, i, block.timestamp))) & 1 == 0) continue;
            temp[count++] = cfg.strategyVault;
        }
        if (count == 0) {
            for (uint256 i = 0; i < vaultCount; i++) {
                DStakeRouterV2Storage.VaultConfig memory cfg = router.getVaultConfigByIndex(i);
                if (_isEligible(cfg, false) && IERC20(cfg.strategyVault).balanceOf(address(collateralVault)) > 0) {
                    temp[count++] = cfg.strategyVault;
                    break;
                }
            }
        }

        address[] memory selected = new address[](count);
        for (uint256 i = 0; i < count; i++) {
            selected[i] = temp[i];
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
        stdstore.target(address(dStakeToken)).sig("backingAssets()").checked_write(total);

        uint256 managedAssets = total + dstable.balanceOf(address(router));
        _reconcileShortfall(managedAssets);
    }

    function _reconcileShortfall(uint256 managedAssets) internal {
        uint256 supply = dStakeToken.totalSupply();
        uint256 targetShortfall = supply > managedAssets ? supply - managedAssets : 0;
        uint256 currentShortfall = router.currentShortfall();

        if (targetShortfall > currentShortfall) {
            uint256 delta = targetShortfall - currentShortfall;
            if (delta > 0) {
                router.recordShortfall(delta);
            }
        } else if (currentShortfall > targetShortfall) {
            uint256 delta = currentShortfall - targetShortfall;
            if (delta > 0) {
                router.clearShortfall(delta);
            }
        }
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

    function _vaultState(address share) internal view returns (VaultState storage) {
        uint256 index = shareIndex[share];
        return vaultStates[index];
    }

    function _ensureDefaultVaultHealthy() internal {
        address current = router.defaultDepositStrategyShare();
        if (current == address(0)) {
            address[] memory active = router.getActiveVaultsForDeposits();
            if (active.length > 0) {
                router.setDefaultDepositStrategyShare(active[0]);
            }
            return;
        }

        DStakeRouterV2Storage.VaultConfig memory cfg = router.getVaultConfig(current);
        if (cfg.status != DStakeRouterV2Storage.VaultStatus.Active || cfg.adapter == address(0)) {
            address[] memory active = router.getActiveVaultsForDeposits();
            if (active.length == 0) {
                router.clearDefaultDepositStrategyShare();
            } else {
                router.setDefaultDepositStrategyShare(active[0]);
            }
        }
    }

    function _activeTargetSumExcluding(address exclude) internal view returns (uint256 total) {
        uint256 vaultCount = router.getVaultCount();
        for (uint256 i = 0; i < vaultCount; i++) {
            DStakeRouterV2Storage.VaultConfig memory cfg = router.getVaultConfigByIndex(i);
            if (cfg.strategyVault == exclude) continue;
            total += cfg.targetBps;
        }
    }
}
