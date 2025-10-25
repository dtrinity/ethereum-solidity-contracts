import { expect } from "chai";
import { ethers } from "hardhat";
import { SignerWithAddress } from "@nomicfoundation/hardhat-ethers/signers";

import {
  DStakeCollateralVaultV2,
  DStakeRouterV2,
  DStakeTokenV2,
  MockAdapterPositiveSlippage,
  MockERC4626Simple,
  TestMintableERC20,
} from "../../typechain-types";

describe("DustToleranceDos", function () {
  let owner: SignerWithAddress;
  let rebalancer: SignerWithAddress;
  let alice: SignerWithAddress;

  let dStable: TestMintableERC20;
  let dStakeToken: DStakeTokenV2;
  let collateralVault: DStakeCollateralVaultV2;
  let router: DStakeRouterV2;
  let adapterA: MockAdapterPositiveSlippage;
  let adapterB: MockAdapterPositiveSlippage;
  let strategyShareA: string;
  let strategyShareB: string;
  let vaultTokenA: MockERC4626Simple;
  let vaultTokenB: MockERC4626Simple;

  const ONE_HUNDRED_PERCENT_BPS = 1_000_000;

  beforeEach(async function () {
    [owner, rebalancer, alice] = await ethers.getSigners();

    const TokenFactory = await ethers.getContractFactory("TestMintableERC20");
    dStable = (await TokenFactory.deploy("Mock dStable", "dSTBL", 18)) as TestMintableERC20;

    const DStakeTokenFactory = await ethers.getContractFactory("DStakeTokenV2");
    const dStakeTokenImpl = await DStakeTokenFactory.deploy();
    const initData = DStakeTokenFactory.interface.encodeFunctionData("initialize", [
      dStable.target,
      "dStake Token V2",
      "dSTAKEv2",
      owner.address,
      owner.address,
    ]);
    const ProxyFactory = await ethers.getContractFactory("ERC1967Proxy");
    const proxy = await ProxyFactory.deploy(dStakeTokenImpl.target, initData);
    dStakeToken = (await ethers.getContractAt("DStakeTokenV2", proxy.target)) as DStakeTokenV2;

    const CollateralVaultFactory = await ethers.getContractFactory("DStakeCollateralVaultV2");
    collateralVault = (await CollateralVaultFactory.deploy(dStakeToken.target, dStable.target)) as DStakeCollateralVaultV2;

    const RouterFactory = await ethers.getContractFactory("DStakeRouterV2");
    router = (await RouterFactory.deploy(dStakeToken.target, collateralVault.target)) as DStakeRouterV2;

    await collateralVault.setRouter(router.target);
    await dStakeToken.migrateCore(router.target, collateralVault.target);

    const AdapterFactory = await ethers.getContractFactory("MockAdapterPositiveSlippage");
    adapterA = (await AdapterFactory.deploy(dStable.target, collateralVault.target)) as MockAdapterPositiveSlippage;
    adapterB = (await AdapterFactory.deploy(dStable.target, collateralVault.target)) as MockAdapterPositiveSlippage;

    strategyShareA = await adapterA.strategyShare();
    strategyShareB = await adapterB.strategyShare();

    vaultTokenA = (await ethers.getContractAt("MockERC4626Simple", strategyShareA)) as MockERC4626Simple;
    vaultTokenB = (await ethers.getContractAt("MockERC4626Simple", strategyShareB)) as MockERC4626Simple;

    await router.addAdapter(strategyShareA, adapterA.target);
    await router.addAdapter(strategyShareB, adapterB.target);

    const sixtyPercentTarget = 600_000;
    const fortyPercentTarget = ONE_HUNDRED_PERCENT_BPS - sixtyPercentTarget;

    await router["addVaultConfig(address,address,uint256,uint8)"](strategyShareA, adapterA.target, sixtyPercentTarget, 0);
    await router["addVaultConfig(address,address,uint256,uint8)"](strategyShareB, adapterB.target, fortyPercentTarget, 0);

    await router.setDefaultDepositStrategyShare(strategyShareA);

    const rebalancerRole = await router.STRATEGY_REBALANCER_ROLE();
    await router.grantRole(rebalancerRole, rebalancer.address);
  });

  it("routes the minimal tranche between active vaults with dust tolerance at 1", async function () {
    const depositAmount = ethers.parseEther("100");
    await dStable.mint(alice.address, depositAmount);
    await dStable.connect(alice).approve(dStakeToken.target, depositAmount);

    await dStakeToken.connect(alice).deposit(depositAmount, alice.address);

    const dustTolerance = await router.dustTolerance();
    const tranche = dustTolerance + 1n;

    const fromBalanceBefore = await vaultTokenA.balanceOf(collateralVault.target);
    const toBalanceBefore = await vaultTokenB.balanceOf(collateralVault.target);

    const requiredShareAmount = await vaultTokenA.previewWithdraw(tranche);
    const expectedDStable = await adapterA.previewWithdrawFromStrategy(requiredShareAmount);
    const expectedToShares = await vaultTokenB.previewDeposit(expectedDStable);

    const tx = await router.connect(rebalancer).rebalanceStrategiesByValue(strategyShareA, strategyShareB, tranche, 0);

    await expect(tx)
      .to.emit(router, "StrategySharesExchanged")
      .withArgs(strategyShareA, strategyShareB, requiredShareAmount, expectedToShares, expectedDStable, rebalancer.address);

    await expect(tx).to.emit(router, "StrategiesRebalanced").withArgs(strategyShareA, strategyShareB, tranche, rebalancer.address);

    const fromBalanceAfter = await vaultTokenA.balanceOf(collateralVault.target);
    const toBalanceAfter = await vaultTokenB.balanceOf(collateralVault.target);

    expect(fromBalanceAfter).to.equal(fromBalanceBefore - requiredShareAmount);
    expect(toBalanceAfter).to.equal(toBalanceBefore + expectedToShares);
  });

  it("handles withdrawals and near-threshold rebalances after a dust tolerance bump", async function () {
    const depositAmount = ethers.parseEther("200");
    await dStable.mint(alice.address, depositAmount);
    await dStable.connect(alice).approve(dStakeToken.target, depositAmount);
    await dStakeToken.connect(alice).deposit(depositAmount, alice.address);

    const dustToleranceLarge = ethers.parseEther("50");
    await expect(router.connect(owner).setDustTolerance(dustToleranceLarge))
      .to.emit(router, "DustToleranceSet")
      .withArgs(dustToleranceLarge);

    const withdrawAmount = dustToleranceLarge - ethers.parseEther("1");
    const aliceBalanceBefore = await dStable.balanceOf(alice.address);
    await expect(dStakeToken.connect(alice).withdraw(withdrawAmount, alice.address, alice.address)).to.not.be.reverted;
    const aliceBalanceAfter = await dStable.balanceOf(alice.address);
    expect(aliceBalanceAfter - aliceBalanceBefore).to.equal(withdrawAmount);

    const fromBalanceBefore = await vaultTokenA.balanceOf(collateralVault.target);
    const toBalanceBefore = await vaultTokenB.balanceOf(collateralVault.target);

    const rebalanceAmount = dustToleranceLarge + 1n;
    const requiredShareAmount = await vaultTokenA.previewWithdraw(rebalanceAmount);
    const expectedDStable = await adapterA.previewWithdrawFromStrategy(requiredShareAmount);
    const expectedToShares = await vaultTokenB.previewDeposit(expectedDStable);

    const tx = await router.connect(rebalancer).rebalanceStrategiesByValue(strategyShareA, strategyShareB, rebalanceAmount, 0);

    await expect(tx)
      .to.emit(router, "StrategySharesExchanged")
      .withArgs(strategyShareA, strategyShareB, requiredShareAmount, expectedToShares, expectedDStable, rebalancer.address);

    await expect(tx).to.emit(router, "StrategiesRebalanced").withArgs(strategyShareA, strategyShareB, rebalanceAmount, rebalancer.address);

    const fromBalanceAfter = await vaultTokenA.balanceOf(collateralVault.target);
    const toBalanceAfter = await vaultTokenB.balanceOf(collateralVault.target);

    expect(fromBalanceAfter).to.equal(fromBalanceBefore - requiredShareAmount);
    expect(toBalanceAfter).to.equal(toBalanceBefore + expectedToShares);

    const managedAssets = await router.totalManagedAssets();
    const totalAssets = await dStakeToken.totalAssets();
    expect(managedAssets).to.equal(totalAssets);
  });
});
