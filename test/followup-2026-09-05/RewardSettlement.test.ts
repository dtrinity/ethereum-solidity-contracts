import { expect } from "chai";
import { ethers } from "hardhat";
import { rewardsFixture } from "./fixtures";

// REAL StaticATokenLM + real router/adapters/manager. Pool/emission index are
// deterministic mocks. Pinned-mainnet controller integration is a separate gate.
describe("Follow-up: permissionless holder-attributed reward settlement", function () {
  for (const precollected of [false, true]) {
    it(`pays exactly collateral-holder entitlement, preserves another holder, precollection=${precollected}`, async function () {
      const f = await rewardsFixture();
      expect(await f.manager.paused()).to.equal(true);
      expect(await f.manager.hasRole(await f.manager.REWARDS_MANAGER_ROLE(), f.user.address)).to.equal(false);
      expect(await f.staticAdapter.hasRole(ethers.id("AUTHORIZED_CALLER_ROLE"), f.manager.target)).to.equal(false);
      expect(await f.adapter.hasRole(ethers.id("AUTHORIZED_CALLER_ROLE"), f.manager.target)).to.equal(false);
      const own = await f.wrapper.getClaimableRewards(f.collateral.target, f.reward.target);
      const external = await f.wrapper.getClaimableRewards(f.other.address, f.reward.target);
      expect(own).to.equal(ethers.parseEther("300"));
      expect(external).to.equal(ethers.parseEther("100"));
      if (precollected) {
        await f.wrapper.connect(f.other).collectAndUpdateRewards(f.reward.target);
        expect(await f.reward.balanceOf(f.controller.target)).to.equal(0);
        expect(await f.reward.balanceOf(f.wrapper.target)).to.equal(own + external);
      }
      await f.manager.unpauseCompounding();
      const assets = await f.token.totalAssets();
      const supply = await f.token.totalSupply();
      await f.manager.connect(f.user).compoundRewards(10n ** 18n, [f.reward.target], f.receiver.address);
      const fee = await f.manager.getTreasuryFee(own);
      expect(await f.reward.balanceOf(f.receiver.address)).to.equal(own - fee);
      expect(await f.reward.balanceOf(f.treasury.address)).to.equal(fee);
      expect(await f.wrapper.getClaimableRewards(f.collateral.target, f.reward.target)).to.equal(0);
      expect(await f.wrapper.getClaimableRewards(f.other.address, f.reward.target)).to.equal(external);
      expect(await f.token.totalAssets()).to.equal(assets + 10n ** 18n);
      expect(await f.token.totalSupply()).to.equal(supply); // keeper receives NO sdAsset
      expect(await f.asset.allowance(f.manager.target, f.router.target)).to.equal(0);
      await f.wrapper.connect(f.other).claimRewards(f.other.address, [f.reward.target]);
      expect(await f.reward.balanceOf(f.other.address)).to.equal(external);
      expect(await f.reward.balanceOf(f.wrapper.target)).to.equal(0);
    });
  }

  it("requires the threshold but never an execution role", async function () {
    const f = await rewardsFixture();
    await f.manager.unpauseCompounding();
    await expect(
      f.manager.connect(f.user).compoundRewards(10n ** 18n - 1n, [f.reward.target], f.receiver.address),
    ).to.be.revertedWithCustomError(f.manager, "ExchangeAmountTooLow");
    await expect(f.manager.connect(f.user).compoundRewards(10n ** 18n, [f.reward.target], f.receiver.address)).to.emit(
      f.manager,
      "RewardCompounded",
    );
  });

  it("rejects duplicate and zero reward inputs before any value moves", async function () {
    const f = await rewardsFixture();
    await f.manager.unpauseCompounding();
    const cash = await f.asset.balanceOf(f.user.address);
    await expect(
      f.manager.connect(f.user).compoundRewards(10n ** 18n, [f.reward.target, f.reward.target], f.receiver.address),
    ).to.be.revertedWithCustomError(f.manager, "DuplicateRewardToken");
    await expect(
      f.manager.connect(f.user).compoundRewards(10n ** 18n, [ethers.ZeroAddress], f.receiver.address),
    ).to.be.revertedWithCustomError(f.manager, "InvalidRewardToken");
    expect(await f.asset.balanceOf(f.user.address)).to.equal(cash);
  });

  for (const reason of ["manager", "router", "strategy", "default", "cap"] as const) {
    it(`blocks and rolls back the auction when ${reason} prevents safe compounding`, async function () {
      const f = await rewardsFixture();
      await f.manager.unpauseCompounding();
      if (reason === "manager") await f.manager.pauseCompounding();
      if (reason === "router") await f.router.pause();
      if (reason === "strategy")
        await f.router.setVaultConfigs([
          [f.vault.target, f.adapter.target, 1_000_000, 1],
          [f.wrapper.target, f.staticAdapter.target, 0, 0],
        ]);
      if (reason === "default") await f.router.clearDefaultDepositStrategyShare();
      if (reason === "cap") await f.router.setDepositCap(await f.token.totalAssets());
      const cash = await f.asset.balanceOf(f.user.address);
      const entitled = await f.wrapper.getClaimableRewards(f.collateral.target, f.reward.target);
      await expect(f.manager.connect(f.user).compoundRewards(10n ** 18n, [f.reward.target], f.receiver.address)).to.be.reverted;
      expect(await f.asset.balanceOf(f.user.address)).to.equal(cash);
      expect(await f.reward.balanceOf(f.receiver.address)).to.equal(0);
      expect(await f.wrapper.getClaimableRewards(f.collateral.target, f.reward.target)).to.equal(entitled);
    });
  }

  it("rejects stale router binding even when the old manager remains unpaused", async function () {
    const f = await rewardsFixture();
    await f.manager.unpauseCompounding();
    const next = await (await ethers.getContractFactory("DStakeRouterV2Incident")).deploy(f.token.target, f.collateral.target);
    await f.collateral.setRouter(next.target);
    await expect(
      f.manager.connect(f.user).compoundRewards(10n ** 18n, [f.reward.target], f.receiver.address),
    ).to.be.revertedWithCustomError(f.manager, "StaleCompoundingRouter");
  });

  it("gives emergency signers pause-only authority, not reopening/configuration authority", async function () {
    const f = await rewardsFixture();
    await f.manager.unpauseCompounding();
    await f.manager.grantRole(await f.manager.COMPOUND_PAUSER_ROLE(), f.other.address);
    await f.manager.connect(f.other).pauseCompounding();
    await expect(f.manager.connect(f.other).unpauseCompounding()).to.be.revertedWithCustomError(
      f.manager,
      "AccessControlUnauthorizedAccount",
    );
  });
});
