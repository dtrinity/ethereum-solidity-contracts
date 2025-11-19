// SPDX-License-Identifier: MIT
pragma solidity ^0.8.20;

import "forge-std/Test.sol";

import { IERC20 } from "@openzeppelin/contracts/token/ERC20/IERC20.sol";

import { DStakeRouterV2 } from "vaults/dstake/DStakeRouterV2.sol";
import { DStakeRouterV2Storage } from "../../../../contracts/vaults/dstake/DStakeRouterV2Storage.sol";
import { DStakeRouterV2GovernanceModule } from "../../../../contracts/vaults/dstake/DStakeRouterV2GovernanceModule.sol";

import { TestMintableERC20 } from "../utils/TestMintableERC20.sol";
import { InvariantDStakeCollateralVault } from "../utils/InvariantDStakeCollateralVault.sol";
import { MockDStakeToken } from "../utils/MockDStakeToken.sol";
import { InvariantDynamicStrategyAdapter } from "../utils/InvariantDynamicStrategyAdapter.sol";
import { StrategyShare } from "../utils/InvariantStableAdapter.sol";

contract RouterMultiVaultInvariant is Test {
    using stdStorage for StdStorage;
    uint256 private constant MAX_DEPOSIT = 5e24;
    uint256 private constant MAX_NAV_SHIFT = 1e22;
    uint256 private constant MAX_SHARE_PRICE_RAY = 2e18;

    TestMintableERC20 internal dstable;
    MockDStakeToken internal dStakeToken;
    InvariantDStakeCollateralVault internal collateralVault;
    DStakeRouterV2 internal router;

    address internal solver;
    address internal feeClaimer;

    struct VaultState {
        InvariantDynamicStrategyAdapter adapter;
        StrategyShare share;
    }

    VaultState[] internal vaults;

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

        _deployVault(5_000);
        _deployVault(3_000);
        _deployVault(2_000);

        router.setDefaultDepositStrategyShare(address(vaults[0].share));
        router.setDepositCap(0);
        router.setReinvestIncentive(0);
        router.setDustTolerance(2);

        _syncCollateralValue();

        targetContract(address(this));
        bytes4[] memory selectors = new bytes4[](8);
        selectors[0] = this.depositAssets.selector;
        selectors[1] = this.withdrawAssets.selector;
        selectors[2] = this.adjustVaultConfigs.selector;
        selectors[3] = this.manageShortfall.selector;
        selectors[4] = this.updateCaps.selector;
        selectors[5] = this.shiftNav.selector;
        selectors[6] = this.reinvestFees.selector;
        selectors[7] = this.updateDefault.selector;
        targetSelector(FuzzSelector({ addr: address(this), selectors: selectors }));
    }

    // -------------------------------------------------------------------------
    // Actions
    // -------------------------------------------------------------------------

    function depositAssets(uint256 seed, uint256 rawAmount) public {
        address[] memory selectedVaults = _selectVaults(seed, true);
        uint256 count = selectedVaults.length;
        if (count == 0) return;

        uint256 amount = bound(rawAmount, 1, MAX_DEPOSIT);
        uint256[] memory amounts = new uint256[](count);
        uint256 remaining = amount;

        for (uint256 i = 0; i < count; i++) {
            if (i == count - 1) {
                amounts[i] = remaining;
            } else {
                uint256 maxChunk = remaining;
                uint256 chunk = bound(uint256(keccak256(abi.encode(seed, i))) % (maxChunk + 1), 0, maxChunk);
                amounts[i] = chunk;
                remaining -= chunk;
            }
        }

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
        dstable.approve(address(router), type(uint256).max);
        router.solverDepositAssets(selectedVaults, amounts, 0, solver);
        vm.stopPrank();

        _syncCollateralValue();
    }

    function withdrawAssets(uint256 seed, uint256 rawAmount) public {
        vm.startPrank(solver);
        uint256 userShares = dStakeToken.balanceOf(solver);
        if (userShares == 0) {
            vm.stopPrank();
            return;
        }

        uint256 maxNet = router.maxWithdraw(solver);
        if (maxNet == 0) {
            vm.stopPrank();
            return;
        }
        uint256 amount = bound(rawAmount, 1, maxNet);
        vm.stopPrank();

        address[] memory selectedVaults = _selectVaults(seed, false);
        uint256 count = selectedVaults.length;
        if (count == 0) return;

        uint256[] memory amounts = new uint256[](count);
        uint256 remaining = amount;
        for (uint256 i = 0; i < count; i++) {
            if (i == count - 1) {
                amounts[i] = remaining;
            } else {
                uint256 maxChunk = remaining;
                uint256 chunk = bound(uint256(keccak256(abi.encode(seed, i, amount))) % (maxChunk + 1), 0, maxChunk);
                amounts[i] = chunk;
                remaining -= chunk;
            }
        }

        uint256 total;
        for (uint256 i = 0; i < count; i++) {
            total += amounts[i];
        }
        if (total == 0) {
            amounts[seed % count] = amount;
            total = amount;
        }

        vm.startPrank(solver);
        router.solverWithdrawAssets(selectedVaults, amounts, userShares, solver, solver);
        vm.stopPrank();

        _syncCollateralValue();
    }

    function adjustVaultConfigs(uint256 seed, uint16 bias) public {
        uint256 vaultCount = router.getVaultCount();
        if (vaultCount == 0) return;

        uint256 remaining = 10_000;
        for (uint256 i = 0; i < vaultCount; i++) {
            DStakeRouterV2Storage.VaultConfig memory cfg = router.getVaultConfigByIndex(i);

            uint8 statusSelector = uint8(seed >> (i * 2)) % 3;
            DStakeRouterV2Storage.VaultStatus status = DStakeRouterV2Storage.VaultStatus(statusSelector);

            uint256 maxTarget = remaining;
            uint256 raw = uint256(keccak256(abi.encode(seed, bias, i))) % (maxTarget + 1);
            uint256 target = status == DStakeRouterV2Storage.VaultStatus.Active ? raw : 0;
            remaining -= target;

            DStakeRouterV2Storage.VaultConfig memory nextCfg = DStakeRouterV2Storage.VaultConfig({
                strategyVault: cfg.strategyVault,
                adapter: cfg.adapter,
                targetBps: target,
                status: status
            });

            router.updateVaultConfig(nextCfg);
        }

        _ensureDefaultVaultHealthy();
    }

    function manageShortfall(int256 deltaRaw) public {
        if (deltaRaw == 0) return;

        if (deltaRaw > 0) {
            uint256 managed = router.totalManagedAssets();
            if (managed == 0) return;
            uint256 maxDelta = managed / 2;
            if (maxDelta == 0) return;
            uint256 amount = bound(uint256(deltaRaw), 1, maxDelta);
            router.recordShortfall(amount);
        } else {
            uint256 current = router.currentShortfall();
            if (current == 0) return;
            uint256 amount = bound(uint256(-deltaRaw), 1, current);
            router.clearShortfall(amount);
        }
    }

    function updateCaps(uint256 newCapRaw, uint16 newDustRaw, uint16 reinvestRaw) public {
        uint256 managed = router.totalManagedAssets();
        uint256 cap;
        uint256 headroom = MAX_DEPOSIT * 1_000;
        if ((newCapRaw & 1) == 0) {
            cap = 0;
        } else {
            cap = managed + headroom + (newCapRaw % (headroom + 1));
        }
        router.setDepositCap(cap);

        uint256 dust = bound(uint256(newDustRaw), 1, 1e6);
        router.setDustTolerance(dust);

        uint256 incentive = reinvestRaw % (router.MAX_REINVEST_INCENTIVE_BPS() + 1);
        router.setReinvestIncentive(incentive);
    }

    function shiftNav(uint8 vaultIndexSeed, int128 deltaRaw) public {
        if (vaults.length == 0) return;
        uint256 index = vaultIndexSeed % vaults.length;
        InvariantDynamicStrategyAdapter adapter = vaults[index].adapter;

        if (deltaRaw == 0) return;

        uint256 beforeManaged = router.totalManagedAssets();
        int256 delta = deltaRaw;
        uint256 magnitude = uint256(delta > 0 ? delta : -delta);
        magnitude = bound(magnitude, 1, MAX_NAV_SHIFT);

        if (delta > 0) {
            uint256 shareSupply = vaults[index].share.totalSupply();
            if (shareSupply == 0) {
                return;
            }
            uint256 reserves = dstable.balanceOf(address(adapter));
            uint256 maxReserves = (shareSupply * MAX_SHARE_PRICE_RAY) / 1e18;
            if (maxReserves <= reserves) {
                return;
            }
            uint256 headroom = maxReserves - reserves;
            if (magnitude > headroom) {
                magnitude = headroom;
                if (magnitude == 0) {
                    return;
                }
            }
            dstable.mint(address(this), magnitude);
            dstable.approve(address(adapter), magnitude);
            adapter.adjustReserves(int256(uint256(magnitude)));
        } else {
            adapter.adjustReserves(-int256(magnitude));
        }

        _syncCollateralValue();

        if (delta < 0) {
            uint256 afterManaged = router.totalManagedAssets();
            if (afterManaged < beforeManaged) {
                uint256 drop = beforeManaged - afterManaged;
                uint256 currentShortfall = router.currentShortfall();
                if (currentShortfall > afterManaged) {
                    uint256 excess = currentShortfall - afterManaged;
                    uint256 clearance = excess > drop ? drop : excess;
                    if (clearance > 0) {
                        router.clearShortfall(clearance);
                    }
                }
            }
        }
    }

    function reinvestFees(uint256 rawAmount, uint256 sweepLimit) public {
        address[] memory active = router.getActiveVaultsForDeposits();
        if (active.length == 0) {
            return;
        }

        uint256 cap = router.depositCap();
        uint256 managed = router.totalManagedAssets();
        if (cap != 0 && managed >= cap) {
            return;
        }

        uint256 amount = bound(rawAmount, 1, 1e23);
        if (cap != 0 && managed + amount > cap) {
            amount = cap - managed;
            if (amount == 0) {
                return;
            }
        }

        dstable.mint(address(router), amount);

        vm.prank(feeClaimer);
        router.reinvestFees();
        _syncCollateralValue();

        address defaultShare = router.defaultDepositStrategyShare();
        if (defaultShare != address(0)) {
            _ensureDefaultVaultHealthy();
            uint256 balance = dstable.balanceOf(address(router));
            if (balance > 0) {
                uint256 maxAmount = sweepLimit % (balance + 1);
                if (maxAmount > 0) {
                    router.sweepSurplus(maxAmount);
                    _syncCollateralValue();
                }
            }
        }
    }

    function updateDefault(uint8 vaultIndexSeed) public {
        address[] memory eligible = router.getActiveVaultsForDeposits();
        if (eligible.length == 0) {
            router.clearDefaultDepositStrategyShare();
            return;
        }
        address chosen = eligible[vaultIndexSeed % eligible.length];
        router.setDefaultDepositStrategyShare(chosen);
    }

    // -------------------------------------------------------------------------
    // Invariants
    // -------------------------------------------------------------------------

    function invariantManagedAssetsTrackVaults() public view {
        uint256 expectedVaultValue = _aggregateVaultValue();
        uint256 idleBalance = dstable.balanceOf(address(router));
        assertEq(
            router.totalManagedAssets(),
            expectedVaultValue + idleBalance,
            "Router managed assets must match vault value + idle"
        );

        assertLe(router.currentShortfall(), router.totalManagedAssets() + router.dustTolerance(), "Shortfall capped");
    }

    function invariantTokenSupplyMatchesAssets() public view {
        uint256 nav = router.totalManagedAssets();
        uint256 shortfall = router.currentShortfall();
        uint256 netNav = nav > shortfall ? nav - shortfall : 0;
        uint256 tolerance = router.dustTolerance() + (MAX_NAV_SHIFT * 10);
        assertApproxEqAbs(
            dStakeToken.totalAssets(),
            netNav,
            tolerance,
            "dStake backing must match managed assets net of shortfall"
        );
        assertApproxEqAbs(
            dStakeToken.totalSupply(),
            nav,
            tolerance,
            "dStake supply must equal backing assets"
        );
    }

    function invariantTargetsWithinLimit() public view {
        uint256 vaultCount = router.getVaultCount();
        uint256 totalTargets;
        for (uint256 i = 0; i < vaultCount; i++) {
            DStakeRouterV2Storage.VaultConfig memory cfg = router.getVaultConfigByIndex(i);
            totalTargets += cfg.targetBps;
            if (cfg.status != DStakeRouterV2Storage.VaultStatus.Active) {
                assertEq(cfg.targetBps, 0, "Inactive vault must have zero target");
            }
        }
        assertLe(totalTargets, 10_000, "Target vector exceeds 100%");
    }

    function invariantDepositCapRespected() public view {
        uint256 cap = router.depositCap();
        if (cap == 0) return;
        assertLe(router.totalManagedAssets(), cap, "Managed assets exceed deposit cap");
    }

    function invariantDefaultVaultHealthy() public view {
        address defaultVault = router.defaultDepositStrategyShare();
        if (defaultVault == address(0)) return;

        uint256 vaultCount = router.getVaultCount();
        for (uint256 i = 0; i < vaultCount; i++) {
            DStakeRouterV2Storage.VaultConfig memory cfg = router.getVaultConfigByIndex(i);
            if (cfg.strategyVault == defaultVault) {
                assertEq(uint8(cfg.status), uint8(DStakeRouterV2Storage.VaultStatus.Active), "Default vault must remain active");
                break;
            }
        }
    }

    // -------------------------------------------------------------------------
    // Helpers
    // -------------------------------------------------------------------------

    function _deployVault(uint256 initialTargetBps) internal {
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

        vaults.push(VaultState({ adapter: adapter, share: share }));
    }

    function _selectVaults(uint256 seed, bool deposits) internal view returns (address[] memory) {
        uint256 vaultCount = router.getVaultCount();
        address[] memory temp = new address[](vaultCount);
        uint256 count;

        for (uint256 i = 0; i < vaultCount; i++) {
            DStakeRouterV2Storage.VaultConfig memory cfg = router.getVaultConfigByIndex(i);
            if (deposits && cfg.status != DStakeRouterV2Storage.VaultStatus.Active) {
                continue;
            }

            if (uint256(keccak256(abi.encode(seed, i))) & 1 == 1) {
                temp[count++] = cfg.strategyVault;
            }
        }

        if (count == 0 && vaultCount > 0) {
            for (uint256 i = 0; i < vaultCount; i++) {
                DStakeRouterV2Storage.VaultConfig memory cfg = router.getVaultConfigByIndex(i);
                if (deposits && cfg.status != DStakeRouterV2Storage.VaultStatus.Active) {
                    continue;
                }
                temp[count++] = cfg.strategyVault;
                break;
            }
        }

        address[] memory selected = new address[](count);
        for (uint256 i = 0; i < count; i++) {
            selected[i] = temp[i];
        }
        return selected;
    }

    function _syncCollateralValue() internal {
        uint256 total;
        for (uint256 i = 0; i < vaults.length; i++) {
            uint256 shareBalance = IERC20(address(vaults[i].share)).balanceOf(address(collateralVault));
            uint256 shareValue = vaults[i].adapter.strategyShareValueInDStable(
                address(vaults[i].share),
                shareBalance
            );
            total += shareValue;
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
            uint256 headroom = managedAssets > currentShortfall ? managedAssets - currentShortfall : 0;
            uint256 delta = targetShortfall - currentShortfall;
            if (delta > headroom) {
                delta = headroom;
            }
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
        for (uint256 i = 0; i < vaults.length; i++) {
            uint256 shareBalance = IERC20(address(vaults[i].share)).balanceOf(address(collateralVault));
            uint256 shareValue = vaults[i].adapter.strategyShareValueInDStable(
                address(vaults[i].share),
                shareBalance
            );
            total += shareValue;
        }
    }

    function _ensureDefaultVaultHealthy() internal {
        address defaultVault = router.defaultDepositStrategyShare();
        if (defaultVault == address(0)) return;
        DStakeRouterV2Storage.VaultConfig memory cfg = router.getVaultConfig(defaultVault);
        if (cfg.status != DStakeRouterV2Storage.VaultStatus.Active) {
            address[] memory eligible = router.getActiveVaultsForDeposits();
            if (eligible.length == 0) {
                router.clearDefaultDepositStrategyShare();
            } else {
                router.setDefaultDepositStrategyShare(eligible[0]);
            }
        }
    }
}
