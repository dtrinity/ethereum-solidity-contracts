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

describe("RouterShortfallSpoof", function () {
  let owner: SignerWithAddress;
  let alice: SignerWithAddress;
  let bob: SignerWithAddress;
  let carol: SignerWithAddress;

  let dStable: TestMintableERC20;
  let dStakeToken: DStakeTokenV2;
  let collateralVault: DStakeCollateralVaultV2;
  let router: DStakeRouterV2;
  let adapter: MockAdapterPositiveSlippage;
  let strategyShare: MockERC4626Simple;

  const ONE_HUNDRED_PERCENT_BPS = 1_000_000;

  beforeEach(async function () {
    [owner, alice, bob, carol] = await ethers.getSigners();

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
    collateralVault = (await CollateralVaultFactory.deploy(
      dStakeToken.target,
      dStable.target,
    )) as DStakeCollateralVaultV2;

    const RouterFactory = await ethers.getContractFactory("DStakeRouterV2");
    router = (await RouterFactory.deploy(dStakeToken.target, collateralVault.target)) as DStakeRouterV2;

    await collateralVault.setRouter(router.target);
    await dStakeToken.migrateCore(router.target, collateralVault.target);

    const AdapterFactory = await ethers.getContractFactory("MockAdapterPositiveSlippage");
    adapter = (await AdapterFactory.deploy(dStable.target, collateralVault.target)) as MockAdapterPositiveSlippage;
    const strategyShareAddress = await adapter.strategyShare();
    strategyShare = (await ethers.getContractAt(
      "MockERC4626Simple",
      strategyShareAddress,
    )) as unknown as MockERC4626Simple;

    await router.addAdapter(strategyShareAddress, adapter.target);
    await router["addVaultConfig(address,address,uint256,uint8)"](
      strategyShareAddress,
      adapter.target,
      ONE_HUNDRED_PERCENT_BPS,
      0,
    );
    await router.setDefaultDepositStrategyShare(strategyShareAddress);
  });

  it("maintains fair share accounting when governance records and clears shortfall", async function () {
    const firstDeposit = ethers.parseUnits("100", 18);
    const secondDeposit = ethers.parseUnits("50", 18);
    const thirdDeposit = ethers.parseUnits("25", 18);
    const shortfall = ethers.parseUnits("20", 18);

    await dStable.mint(alice.address, firstDeposit);
    await dStable.connect(alice).approve(dStakeToken.target, firstDeposit);

    const firstPreview = await dStakeToken.previewDeposit(firstDeposit);
    expect(firstPreview).to.equal(firstDeposit);

    await expect(dStakeToken.connect(alice).deposit(firstDeposit, alice.address))
      .to.emit(router, "RouterDepositRouted")
      .withArgs(alice.address, alice.address, strategyShare.target, firstDeposit, firstPreview);

    expect(await dStakeToken.balanceOf(alice.address)).to.equal(firstPreview);
    expect(await strategyShare.balanceOf(collateralVault.target)).to.equal(firstDeposit);
    expect(await router.currentShortfall()).to.equal(0n);
    expect(await dStakeToken.totalAssets()).to.equal(await router.totalManagedAssets());

    await dStable.mint(bob.address, secondDeposit);
    const previewWithoutShortfall = await dStakeToken.previewDeposit(secondDeposit);

    await router.recordShortfall(shortfall);
    expect(await router.currentShortfall()).to.equal(shortfall);

    const previewWithShortfall = await dStakeToken.previewDeposit(secondDeposit);
    expect(previewWithShortfall).to.be.gt(previewWithoutShortfall);

    await dStable.connect(bob).approve(dStakeToken.target, secondDeposit);
    await expect(dStakeToken.connect(bob).deposit(secondDeposit, bob.address))
      .to.emit(router, "RouterDepositRouted")
      .withArgs(bob.address, bob.address, strategyShare.target, secondDeposit, previewWithShortfall);

    expect(await dStakeToken.balanceOf(bob.address)).to.equal(previewWithShortfall);
    expect(await strategyShare.balanceOf(collateralVault.target)).to.equal(firstDeposit + secondDeposit);

    const managedAfterSecond = await router.totalManagedAssets();
    expect(await dStakeToken.totalAssets()).to.equal(managedAfterSecond - shortfall);

    await router.clearShortfall(shortfall);
    expect(await router.currentShortfall()).to.equal(0n);

    await dStable.mint(carol.address, thirdDeposit);
    const previewAfterClear = await dStakeToken.previewDeposit(thirdDeposit);
    expect(previewAfterClear).to.be.lt(thirdDeposit);

    await dStable.connect(carol).approve(dStakeToken.target, thirdDeposit);
    await expect(dStakeToken.connect(carol).deposit(thirdDeposit, carol.address))
      .to.emit(router, "RouterDepositRouted")
      .withArgs(carol.address, carol.address, strategyShare.target, thirdDeposit, previewAfterClear);

    expect(await dStakeToken.balanceOf(carol.address)).to.equal(previewAfterClear);

    const finalStrategyShares = await strategyShare.balanceOf(collateralVault.target);
    expect(finalStrategyShares).to.equal(firstDeposit + secondDeposit + thirdDeposit);

    const collateralValue = await collateralVault.totalValueInDStable();
    const managedAssets = await router.totalManagedAssets();
    expect(collateralValue).to.equal(managedAssets);
    expect(await dStakeToken.totalAssets()).to.equal(managedAssets);
    expect(managedAssets).to.equal(await strategyShare.previewRedeem(finalStrategyShares));
  });
});
