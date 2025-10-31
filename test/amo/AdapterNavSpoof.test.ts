import { expect } from "chai";
import { ethers } from "hardhat";
import { SignerWithAddress } from "@nomicfoundation/hardhat-ethers/signers";
import {
  DStakeCollateralVaultV2,
  DStakeRouterV2,
  DStakeTokenV2,
  MockAdapterNavSpoofer,
  MockERC4626Simple,
  TestMintableERC20,
} from "../../typechain-types";

describe("AdapterNavSpoof", function () {
  let owner: SignerWithAddress;
  let alice: SignerWithAddress;
  let bob: SignerWithAddress;

  let dStable: TestMintableERC20;
  let dStakeToken: DStakeTokenV2;
  let collateralVault: DStakeCollateralVaultV2;
  let router: DStakeRouterV2;
  let adapter: MockAdapterNavSpoofer;
  let strategyShare: MockERC4626Simple;

  const ONE_HUNDRED_PERCENT_BPS = 1_000_000;

  beforeEach(async function () {
    [owner, alice, bob] = await ethers.getSigners();

    const TokenFactory = await ethers.getContractFactory("TestMintableERC20");
    dStable = (await TokenFactory.deploy("Mock dStable", "dSTBL", 18)) as TestMintableERC20;

    const DStakeTokenFactory = await ethers.getContractFactory("DStakeTokenV2");
    const dStakeTokenImpl = await DStakeTokenFactory.deploy();
    const initCalldata = DStakeTokenFactory.interface.encodeFunctionData("initialize", [
      dStable.target,
      "dStake Token V2",
      "dSTAKEv2",
      owner.address,
      owner.address,
    ]);
    const ProxyFactory = await ethers.getContractFactory("ERC1967Proxy");
    const proxy = await ProxyFactory.deploy(dStakeTokenImpl.target, initCalldata);
    dStakeToken = (await ethers.getContractAt("DStakeTokenV2", proxy.target)) as DStakeTokenV2;

    const CollateralVaultFactory = await ethers.getContractFactory("DStakeCollateralVaultV2");
    collateralVault = (await CollateralVaultFactory.deploy(dStakeToken.target, dStable.target)) as DStakeCollateralVaultV2;

    const RouterFactory = await ethers.getContractFactory("DStakeRouterV2");
    router = (await RouterFactory.deploy(dStakeToken.target, collateralVault.target)) as DStakeRouterV2;

    const GovernanceModuleFactory = await ethers.getContractFactory("DStakeRouterV2GovernanceModule");
    const governanceModule = await GovernanceModuleFactory.deploy(dStakeToken.target, collateralVault.target);
    const RebalanceModuleFactory = await ethers.getContractFactory("DStakeRouterV2RebalanceModule");
    const rebalanceModule = await RebalanceModuleFactory.deploy(dStakeToken.target, collateralVault.target);

    await router.setGovernanceModule(governanceModule.target);
    await router.setRebalanceModule(rebalanceModule.target);

    await collateralVault.setRouter(router.target);
    await dStakeToken.migrateCore(router.target, collateralVault.target);

    const AdapterFactory = await ethers.getContractFactory("MockAdapterNavSpoofer");
    adapter = (await AdapterFactory.deploy(dStable.target, collateralVault.target)) as MockAdapterNavSpoofer;

    const strategyShareAddress = await adapter.strategyShare();
    strategyShare = (await ethers.getContractAt("MockERC4626Simple", strategyShareAddress)) as unknown as MockERC4626Simple;

    await router.addAdapter(strategyShareAddress, adapter.target);
    await router["addVaultConfig(address,address,uint256,uint8)"](strategyShareAddress, adapter.target, ONE_HUNDRED_PERCENT_BPS, 0);
    await router.setDefaultDepositStrategyShare(strategyShareAddress);
  });

  it("routes deposits successfully with honest adapter factors", async function () {
    const depositAmount = ethers.parseUnits("100", 18);

    await dStable.mint(alice.address, depositAmount);
    await dStable.connect(alice).approve(dStakeToken.target, depositAmount);

    const preview = await dStakeToken.previewDeposit(depositAmount);
    expect(preview).to.equal(depositAmount);

    await expect(dStakeToken.connect(alice).deposit(depositAmount, alice.address))
      .to.emit(router, "RouterDepositRouted")
      .withArgs(alice.address, alice.address, strategyShare.target, depositAmount, preview);

    expect(await strategyShare.balanceOf(collateralVault.target)).to.equal(depositAmount);

    const nav = await collateralVault.totalValueInDStable();
    expect(nav).to.equal(await router.totalManagedAssets());
    expect(nav).to.equal(await dStakeToken.totalAssets());

    const expectedNav = await strategyShare.previewRedeem(depositAmount);
    expect(nav).to.equal(expectedNav);
  });

  it("reverts deposits when adapter under-delivers strategy shares", async function () {
    const depositAmount = ethers.parseUnits("50", 18);
    const mintFactorBps = 9_500;

    await adapter.setMintFactorBps(mintFactorBps);

    await dStable.mint(alice.address, depositAmount);
    await dStable.connect(alice).approve(dStakeToken.target, depositAmount);

    const expectedShares = depositAmount;
    const deliveredShares = (depositAmount * BigInt(mintFactorBps)) / 10_000n;

    await expect(dStakeToken.connect(alice).deposit(depositAmount, alice.address))
      .to.be.revertedWithCustomError(router, "SlippageCheckFailed")
      .withArgs(strategyShare.target, deliveredShares, expectedShares);
  });

  it("reports inflated NAV when valueFactor is increased", async function () {
    const depositAmount = ethers.parseUnits("80", 18);
    const inflatedValueFactor = 12_500;

    await dStable.mint(bob.address, depositAmount);
    await dStable.connect(bob).approve(dStakeToken.target, depositAmount);
    await dStakeToken.connect(bob).deposit(depositAmount, bob.address);

    const strategyBalance = await strategyShare.balanceOf(collateralVault.target);
    expect(strategyBalance).to.equal(depositAmount);

    await adapter.setValueFactorBps(inflatedValueFactor);

    const reportedNav = await collateralVault.totalValueInDStable();
    const actualAssets = await strategyShare.previewRedeem(strategyBalance);

    const expectedReportedNav = (actualAssets * BigInt(inflatedValueFactor)) / 10_000n;
    expect(reportedNav).to.equal(expectedReportedNav);
    expect(reportedNav).to.be.gt(actualAssets);

    const discrepancy = reportedNav - actualAssets;
    const expectedDiscrepancy = (actualAssets * BigInt(inflatedValueFactor - 10_000)) / 10_000n;
    expect(discrepancy).to.equal(expectedDiscrepancy);
  });
});
