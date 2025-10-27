// SPDX-License-Identifier: MIT
pragma solidity ^0.8.20;

import "forge-std/Test.sol";

import { IssuerV2 } from "dstable/IssuerV2.sol";
import { RedeemerV2 } from "dstable/RedeemerV2.sol";
import { CollateralHolderVault } from "dstable/CollateralHolderVault.sol";
import { AmoManager } from "dstable/AmoManager.sol";
import { MockAmoVault } from "testing/dstake/MockAmoVault.sol";

import { MockPriceOracle } from "../utils/MockPriceOracle.sol";
import { TestMintableERC20 } from "../utils/TestMintableERC20.sol";
import { MultiCollateralSupport } from "../utils/MultiCollateralSupport.sol";
import { WithdrawalFeeMath } from "common/WithdrawalFeeMath.sol";

contract MultiCollateralRedemptionInvariant is Test {
    using MultiCollateralSupport for MultiCollateralSupport.CollateralAsset;

    uint256 internal constant BASE_UNIT = 1e8;
    uint256 internal constant BASIS_POINT_SCALE = 10_000;
    uint256 internal constant NAV_TOLERANCE_BPS = 2_000; // permit 20% drift for abrupt oracle shocks
    uint256 internal constant AMO_MAX_DELTA = 1e24;

    MockPriceOracle internal oracle;
    TestMintableERC20 internal dstable;
    CollateralHolderVault internal collateralVault;
    AmoManager internal amoManager;
    IssuerV2 internal issuer;
    RedeemerV2 internal redeemer;
    MockAmoVault internal amoVault;

    MultiCollateralSupport.CollateralAsset[] internal collateralAssets;
    mapping(address => uint256) internal collateralIndex;

    address[] internal feeCollectors;
    mapping(address => bool) internal isFeeCollector;

    address internal user;

    mapping(address => uint256) internal expectedFeeByAsset;

    function setUp() public virtual {
        oracle = new MockPriceOracle(address(0), BASE_UNIT);
        dstable = new TestMintableERC20("dStable", "dSTB", 18);
        oracle.setPrice(address(dstable), BASE_UNIT);

        _registerCollateral("USD Coin", "USDC", 6, BASE_UNIT);
        _registerCollateral("Tether USD", "USDT", 6, BASE_UNIT);
        _registerCollateral("DAI Stablecoin", "DAI", 18, BASE_UNIT);
        _registerCollateral("Wrapped BTC", "WBTC", 8, 35_000 * BASE_UNIT);

        collateralVault = new CollateralHolderVault(oracle);
        amoManager = new AmoManager(address(dstable), address(collateralVault), oracle);
        issuer = new IssuerV2(address(collateralVault), address(dstable), oracle, address(amoManager));
        redeemer = new RedeemerV2(address(collateralVault), address(dstable), oracle, address(this), 0);
        amoVault = new MockAmoVault(
            address(dstable),
            address(amoManager),
            address(this),
            address(this),
            address(this),
            oracle
        );

        dstable.setMinter(address(issuer), true);
        dstable.setMinter(address(amoManager), true);

        collateralVault.grantRole(collateralVault.COLLATERAL_WITHDRAWER_ROLE(), address(redeemer));
        collateralVault.grantRole(collateralVault.COLLATERAL_WITHDRAWER_ROLE(), address(amoManager));
        collateralVault.grantRole(collateralVault.COLLATERAL_STRATEGY_ROLE(), address(amoManager));

        for (uint256 i = 0; i < collateralAssets.length; i++) {
            MultiCollateralSupport.CollateralAsset storage asset = collateralAssets[i];
            collateralVault.allowCollateral(asset.addr());
            amoVault.allowCollateral(asset.addr());

            uint8 decimals = asset.decimals();
            uint256 initialInventory = 10_000_000 * (10 ** decimals);
            asset.token.mint(address(this), initialInventory);
            asset.token.approve(address(collateralVault), initialInventory);
            collateralVault.deposit(initialInventory, asset.addr());
        }

        amoManager.enableAmoVault(address(amoVault));

        feeCollectors.push(address(this));
        isFeeCollector[address(this)] = true;

        user = address(0xBEEF);
        vm.label(user, "user");
        vm.label(address(collateralVault), "collateralVault");
        vm.label(address(issuer), "issuer");
        vm.label(address(redeemer), "redeemer");
        vm.label(address(amoManager), "amoManager");
        vm.label(address(amoVault), "amoVault");

        targetContract(address(this));
        bytes4[] memory selectors = new bytes4[](9);
        selectors[0] = this.issueWithCollateral.selector;
        selectors[1] = this.redeemForCollateral.selector;
        selectors[2] = this.rotateFeeReceiver.selector;
        selectors[3] = this.setCollateralFeeOverride.selector;
        selectors[4] = this.setDefaultFee.selector;
        selectors[5] = this.toggleMintPause.selector;
        selectors[6] = this.toggleRedemptionPause.selector;
        selectors[7] = this.updateOraclePrice.selector;
        selectors[8] = this.adjustAmoPosition.selector;
        targetSelector(FuzzSelector({ addr: address(this), selectors: selectors }));
    }

    // -------------------------------------------------------------------------
    // Action generators
    // -------------------------------------------------------------------------

    function issueWithCollateral(uint256 indexSeed, uint256 rawAmount) public {
        MultiCollateralSupport.CollateralAsset storage asset = _collateralByIndex(indexSeed);
        uint256 maxAmount = 1_000_000 * (10 ** asset.decimals()); // cap single-call issuance vs vault seed
        uint256 amount = bound(rawAmount, 1, maxAmount);

        asset.token.mint(user, amount);

        vm.startPrank(user);
        if (asset.token.allowance(user, address(issuer)) < amount) {
            asset.token.approve(address(issuer), type(uint256).max);
        }

        uint256 dstableBefore = dstable.balanceOf(user);
        try issuer.issue(amount, asset.addr(), 0) {
            uint256 dstableAfter = dstable.balanceOf(user) - dstableBefore;
            uint256 baseValue = oracle.getAssetPrice(asset.addr());
            baseValue = (baseValue * amount) / (10 ** asset.decimals());
            uint256 expectedDstable = issuer.baseValueToDstableAmount(baseValue);
            assertApproxEqAbs(
                dstableAfter,
                expectedDstable,
                1,
                "issuance must track oracle base value"
            );
            vm.stopPrank();
        } catch {
            vm.stopPrank();
        }
    }

    function redeemForCollateral(uint256 indexSeed, uint256 rawAmount) public {
        MultiCollateralSupport.CollateralAsset storage asset = _collateralByIndex(indexSeed);
        uint256 dstableBalance = dstable.balanceOf(user);
        if (dstableBalance == 0) {
            return;
        }

        uint256 amount = bound(rawAmount, 1, dstableBalance);

        vm.startPrank(user);
        if (dstable.allowance(user, address(redeemer)) < amount) {
            dstable.approve(address(redeemer), type(uint256).max);
        }

        address feeReceiver = redeemer.feeReceiver();
        uint256 feeBefore = asset.token.balanceOf(feeReceiver);
        uint256 userCollateralBefore = asset.token.balanceOf(user);

        uint256 dstableValue = redeemer.dstableAmountToBaseValue(amount);
        uint256 totalCollateral = collateralVault.assetAmountFromValue(dstableValue, asset.addr());

        uint256 feeBps = redeemer.isCollateralFeeOverridden(asset.addr())
            ? redeemer.collateralRedemptionFeeBps(asset.addr())
            : redeemer.defaultRedemptionFeeBps();

        uint256 expectedFee = WithdrawalFeeMath.calculateWithdrawalFee(totalCollateral, feeBps);
        uint256 expectedNet = WithdrawalFeeMath.netAfterFee(totalCollateral, feeBps);

        try redeemer.redeem(amount, asset.addr(), 0) {
            vm.stopPrank();
        } catch {
            vm.stopPrank();
            return;
        }

        uint256 feeAfter = asset.token.balanceOf(feeReceiver);
        uint256 userCollateralAfter = asset.token.balanceOf(user);

        uint256 feeDelta = feeAfter - feeBefore;
        uint256 userDelta = userCollateralAfter - userCollateralBefore;

        assertApproxEqAbs(feeDelta, expectedFee, 1, "fee accounting deviates");
        assertApproxEqAbs(userDelta, expectedNet, 1, "user net collateral deviates");

        _recordFee(asset.addr(), feeDelta);
    }

    function rotateFeeReceiver(uint256 salt) public {
        address newCollector = address(uint160(uint256(keccak256(abi.encodePacked(salt, address(this))))));
        if (newCollector == address(0) || newCollector == redeemer.feeReceiver()) {
            return;
        }

        redeemer.setFeeReceiver(newCollector);
        if (!isFeeCollector[newCollector]) {
            feeCollectors.push(newCollector);
            isFeeCollector[newCollector] = true;
        }
    }

    function setCollateralFeeOverride(uint256 indexSeed, uint256 rawFeeBps, bool enable) public {
        MultiCollateralSupport.CollateralAsset storage asset = _collateralByIndex(indexSeed);
        uint256 newFee = bound(rawFeeBps, 0, redeemer.MAX_FEE_BPS());

        if (enable) {
            redeemer.setCollateralRedemptionFee(asset.addr(), newFee);
        } else if (redeemer.isCollateralFeeOverridden(asset.addr())) {
            redeemer.clearCollateralRedemptionFee(asset.addr());
        }
    }

    function setDefaultFee(uint256 rawFeeBps) public {
        uint256 newFee = bound(rawFeeBps, 0, redeemer.MAX_FEE_BPS());
        redeemer.setDefaultRedemptionFee(newFee);
    }

    function toggleMintPause(uint256 indexSeed) public {
        MultiCollateralSupport.CollateralAsset storage asset = _collateralByIndex(indexSeed);
        bool currentlyPaused = issuer.assetMintingPaused(asset.addr());
        issuer.setAssetMintingPause(asset.addr(), !currentlyPaused);
    }

    function toggleRedemptionPause(uint256 indexSeed) public {
        MultiCollateralSupport.CollateralAsset storage asset = _collateralByIndex(indexSeed);
        bool currentlyPaused = redeemer.assetRedemptionPaused(asset.addr());
        redeemer.setAssetRedemptionPause(asset.addr(), !currentlyPaused);
    }

    function updateOraclePrice(uint256 indexSeed, uint256 rawPrice) public {
        MultiCollateralSupport.CollateralAsset storage asset = _collateralByIndex(indexSeed);
        uint256 currentPrice = oracle.getAssetPrice(asset.addr());
        uint256 minPrice = (currentPrice * 85) / 100; // 15% downward shock floor
        uint256 maxPrice = (currentPrice * 120) / 100; // 20% upward shock cap
        uint256 newPrice = bound(rawPrice, minPrice, maxPrice);
        oracle.setPrice(asset.addr(), newPrice);
    }

    function adjustAmoPosition(int256 rawDelta) public {
        if (rawDelta == 0) {
            return;
        }

        if (rawDelta > 0) {
            uint256 amount = bound(uint256(rawDelta), 1, AMO_MAX_DELTA);
            issuer.increaseAmoSupply(amount);
            amoManager.allocateAmo(address(amoVault), amount);
        } else {
            uint256 allocation = amoManager.amoVaultAllocation(address(amoVault));
            uint256 amount = bound(uint256(-rawDelta), 0, allocation);
            if (amount == 0) return;
            amoManager.deallocateAmo(address(amoVault), amount);
            amoManager.decreaseAmoSupply(amount);
        }
    }

    // -------------------------------------------------------------------------
    // Invariant checks
    // -------------------------------------------------------------------------

    function invariantSystemCollateralised() public view {
        uint256 vaultBase = collateralVault.totalValue();
        uint256 amoBase = amoVault.totalCollateralValue();
        uint256 treasuryBase = _totalFeeCollectorBaseValue();

        uint256 totalBase = vaultBase + amoBase + treasuryBase;
        uint256 collateralisedSupply = issuer.baseValueToDstableAmount(totalBase);

        uint256 allowed = collateralisedSupply
            + ((collateralisedSupply * NAV_TOLERANCE_BPS) / BASIS_POINT_SCALE)
            + 2; // rounding guard

        assertLe(issuer.circulatingDstable(), allowed, "circulating supply exceeds collateral support");
    }

    function invariantTreasuryFeeAccounting() public view {
        uint256 actualBase = _totalFeeCollectorBaseValue();
        uint256 expectedBase = _expectedFeeBaseValue();
        assertEq(actualBase, expectedBase, "treasury fee base mismatch");

        for (uint256 i = 0; i < collateralAssets.length; i++) {
            MultiCollateralSupport.CollateralAsset storage asset = collateralAssets[i];
            uint256 observed = _totalFeeForAsset(asset.token);
            assertEq(
                observed,
                expectedFeeByAsset[asset.addr()],
                "per-asset fee accumulation diverged"
            );
        }
    }

    function invariantVaultValuationMatchesBalances() public view {
        uint256 manual = 0;
        for (uint256 i = 0; i < collateralAssets.length; i++) {
            MultiCollateralSupport.CollateralAsset storage asset = collateralAssets[i];
            uint256 balance = asset.token.balanceOf(address(collateralVault));
            manual += oracle.getAssetPrice(asset.addr()) * balance / (10 ** asset.decimals());
        }

        assertEq(manual, collateralVault.totalValue(), "vault valuation drifted from balances");
    }

    function invariantAmoAllocationBookkeeping() public view {
        uint256 recorded = amoManager.totalAllocated();
        address[] memory vaults = amoManager.amoVaults();
        uint256 observed = 0;
        for (uint256 i = 0; i < vaults.length; i++) {
            observed += amoManager.amoVaultAllocation(vaults[i]);
        }
        assertEq(recorded, observed, "AMO allocation accounting mismatch");
    }

    // -------------------------------------------------------------------------
    // Helpers
    // -------------------------------------------------------------------------

    function _recordFee(address asset, uint256 feeAmount) internal {
        if (feeAmount == 0) return;

        expectedFeeByAsset[asset] += feeAmount;
    }

    function _totalFeeCollectorBaseValue() internal view returns (uint256 totalBase) {
        for (uint256 i = 0; i < collateralAssets.length; i++) {
            MultiCollateralSupport.CollateralAsset storage asset = collateralAssets[i];
            uint256 totalAmount = _totalFeeForAsset(asset.token);
            if (totalAmount == 0) continue;
            totalBase += oracle.getAssetPrice(asset.addr()) * totalAmount / (10 ** asset.decimals());
        }
    }

    function _totalFeeForAsset(TestMintableERC20 token) internal view returns (uint256 totalAmount) {
        for (uint256 i = 0; i < feeCollectors.length; i++) {
            totalAmount += token.balanceOf(feeCollectors[i]);
        }
    }

    function _collateralByIndex(uint256 indexSeed) internal view returns (MultiCollateralSupport.CollateralAsset storage) {
        uint256 index = bound(indexSeed, 0, collateralAssets.length - 1);
        return collateralAssets[index];
    }

    function _registerCollateral(
        string memory name,
        string memory symbol,
        uint8 decimals,
        uint256 price
    ) internal {
        TestMintableERC20 token = new TestMintableERC20(name, symbol, decimals);
        oracle.setPrice(address(token), price);

        _pushCollateral(token);
    }

    function _pushCollateral(TestMintableERC20 token) internal {
        collateralAssets.push(MultiCollateralSupport.CollateralAsset({ token: token }));
        collateralIndex[address(token)] = collateralAssets.length - 1;
    }

    function _expectedFeeBaseValue() internal view returns (uint256 totalBase) {
        for (uint256 i = 0; i < collateralAssets.length; i++) {
            MultiCollateralSupport.CollateralAsset storage asset = collateralAssets[i];
            uint256 accrued = expectedFeeByAsset[asset.addr()];
            if (accrued == 0) continue;
            totalBase += oracle.getAssetPrice(asset.addr()) * accrued / (10 ** asset.decimals());
        }
    }

}
