import { ethers } from "hardhat";
import { backingFixture } from "../incident-2026-09-05/fixture";

export async function staticFixture() {
  const f = await backingFixture();
  const reward: any = await (await ethers.getContractFactory("IncidentMintableERC20")).deploy();
  const aToken: any = await (await ethers.getContractFactory("FollowupAToken")).deploy(f.asset.target);
  const pool: any = await (await ethers.getContractFactory("FollowupIndexPool")).deploy(aToken.target);
  const controller: any = await (await ethers.getContractFactory("FollowupRewardsController")).deploy(reward.target);
  const wrapper: any = await (
    await ethers.getContractFactory("StaticATokenLM")
  ).deploy(pool.target, controller.target, aToken.target, "Real Static Wrapper", "RSW");
  const staticAdapter: any = await (
    await ethers.getContractFactory("GenericERC4626ConversionAdapter")
  ).deploy(f.asset.target, wrapper.target, f.collateral.target);
  await staticAdapter.setAuthorizedCaller(f.router.target, true);
  await f.router["addVaultConfig(address,address,uint256,uint8)"](wrapper.target, staticAdapter.target, 0, 0);
  async function seed(receiver: any, shares: bigint) {
    const amount = await wrapper.previewMint(shares);
    await aToken.mint(f.admin.address, amount);
    await aToken.approve(wrapper.target, amount);
    await wrapper.depositATokens(amount, receiver);
  }
  return { ...f, reward, aToken, pool, controller, wrapper, staticAdapter, seed };
}

export async function rewardsFixture() {
  const f = await staticFixture();
  const [, , , treasury, receiver] = await ethers.getSigners();
  // Ordinary users own economically independent shares in the SAME real wrapper.
  await f.seed(f.collateral.target, ethers.parseEther("300"));
  await f.seed(f.other.address, ethers.parseEther("100"));
  const manager: any = await (
    await ethers.getContractFactory("DStakeRewardManagerDLend")
  ).deploy(
    f.collateral.target,
    f.router.target,
    f.controller.target,
    f.wrapper.target,
    f.aToken.target,
    treasury.address,
    100_000,
    50_000,
    10n ** 18n, // 10% ceiling, 5% fee, 1 underlying threshold
  );
  await f.controller.setClaimer(f.collateral.target, manager.target);
  await f.asset.connect(f.user).approve(manager.target, ethers.MaxUint256);
  // Freeze the deterministic emission index after accrual: later calls cannot
  // disguise failure to recover precollected rewards through new emissions.
  await f.controller.setIndex(2n * 10n ** 18n);
  await f.reward.mint(f.controller.target, ethers.parseEther("400"));
  return { ...f, manager, treasury, receiver };
}
