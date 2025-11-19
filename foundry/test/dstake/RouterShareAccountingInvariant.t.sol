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
import { InvariantStableAdapter, StrategyShare } from "../utils/InvariantStableAdapter.sol";

contract RouterShareAccountingInvariant is Test {

    TestMintableERC20 internal dstable;
    MockDStakeToken internal dStakeToken;
    InvariantDStakeCollateralVault internal collateralVault;
    DStakeRouterV2 internal router;
    InvariantStableAdapter internal adapter;
    StrategyShare internal strategyShare;

    address internal user;

    function setUp() public {
        user = address(0xBEEF);

        dstable = new TestMintableERC20("dStable", "dSTB", 18);
        dstable.setMinter(address(this), true);

        collateralVault = new InvariantDStakeCollateralVault(address(dstable));
        dStakeToken = new MockDStakeToken(address(dstable));
        router = new DStakeRouterV2(address(dStakeToken), address(collateralVault));

        DStakeRouterV2GovernanceModule governanceModule = new DStakeRouterV2GovernanceModule(address(dStakeToken), address(collateralVault));
        router.setGovernanceModule(address(governanceModule));

        adapter = new InvariantStableAdapter(address(dstable), address(collateralVault));
        strategyShare = StrategyShare(adapter.strategyShare());

        dStakeToken.setRouter(address(router));
        collateralVault.setDStakeToken(address(dStakeToken));
        collateralVault.setRouter(address(router));
        collateralVault.addSupportedStrategyShare(address(strategyShare));

        router.addVaultConfig(
            address(strategyShare),
            address(adapter),
            10_000,
            DStakeRouterV2Storage.VaultStatus.Active
        );

        targetContract(address(this));
        bytes4[] memory selectors = new bytes4[](4);
        selectors[0] = this.depositAssets.selector;
        selectors[1] = this.withdrawAssets.selector;
        selectors[2] = this.adjustShortfall.selector;
        selectors[3] = this.reinvestIdle.selector;
        targetSelector(FuzzSelector({ addr: address(this), selectors: selectors }));
    }

    // -------------------------------------------------------------------------
    // Actions
    // -------------------------------------------------------------------------

    function depositAssets(uint256 rawAmount) public {
        uint256 amount = bound(rawAmount, 1, 1e24);

        dstable.mint(user, amount);

        vm.startPrank(user);
        dstable.approve(address(router), type(uint256).max);
        address[] memory vaults = new address[](1);
        vaults[0] = address(strategyShare);
        uint256[] memory assets = new uint256[](1);
        assets[0] = amount;
        router.solverDepositAssets(vaults, assets, 0, user);
        vm.stopPrank();

        _syncVaultValue();
    }

    function withdrawAssets(uint256 rawAmount) public {
        vm.startPrank(user);
        uint256 userShares = dStakeToken.balanceOf(user);
        if (userShares == 0) {
            vm.stopPrank();
            return;
        }

        uint256 maxNet = router.maxWithdraw(user);
        if (maxNet == 0) {
            vm.stopPrank();
            return;
        }

        uint256 amount = bound(rawAmount, 1, maxNet);
        address[] memory vaults = new address[](1);
        vaults[0] = address(strategyShare);
        uint256[] memory assets = new uint256[](1);
        assets[0] = amount;
        router.solverWithdrawAssets(vaults, assets, userShares, user, user);
        vm.stopPrank();

        _syncVaultValue();
    }

    function adjustShortfall(int256 rawDelta) public {
        if (rawDelta == 0) {
            return;
        }
        uint256 totalManaged = router.totalManagedAssets();
        uint256 currentShortfall = router.currentShortfall();

        if (rawDelta > 0) {
            uint256 delta = bound(uint256(rawDelta), 1, totalManaged);
            if (delta > totalManaged) {
                delta = totalManaged;
            }
            router.recordShortfall(delta);
        } else {
            uint256 delta = bound(uint256(-rawDelta), 0, currentShortfall);
            if (delta == 0) {
                return;
            }
            router.clearShortfall(delta);
        }
    }

    function reinvestIdle(uint256 rawAmount) public {
        uint256 amount = bound(rawAmount, 1, 1e24);
        dstable.mint(address(router), amount);
        router.reinvestFees();
        _syncVaultValue();
    }

    // -------------------------------------------------------------------------
    // Invariants
    // -------------------------------------------------------------------------

    function invariantRouterSupplyTracksNav() public view {
        uint256 nav = router.totalManagedAssets();
        uint256 shortfall = router.currentShortfall();
        uint256 backing = dStakeToken.totalAssets();
        uint256 expectedBacking = nav > shortfall ? nav - shortfall : 0;
        assertEq(backing, expectedBacking, "Router backing must equal managed assets net of shortfall");
    }

    function invariantTokenSupplyMatchesRouter() public view {
        uint256 supply = dStakeToken.totalSupply();
        uint256 nav = router.totalManagedAssets();
        assertEq(supply, nav, "Share supply must equal gross managed assets");
    }

    // -------------------------------------------------------------------------
    // Helpers
    // -------------------------------------------------------------------------

    function _syncVaultValue() internal {
        uint256 shareBalance = IERC20(address(strategyShare)).balanceOf(address(collateralVault));
        collateralVault.setTotalValue(shareBalance);
    }
}
