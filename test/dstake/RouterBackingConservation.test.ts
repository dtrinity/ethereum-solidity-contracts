import { expect } from "chai";
import { ethers } from "hardhat";

import { backingFixture as fixture } from "../incident-2026-09-05/fixture";

describe("Router backing conservation — incident regression", function () {
  it("rejects agreed zero inner shares and zero attributable backing (solver)", async function () {
    const f = await fixture();
    await f.vault.configure(1, 0, 0, 0);
    await expect(f.deposit(100n)).to.be.revertedWithCustomError(f.router, "StrategyBackingLoss");
    expect(await f.token.totalSupply()).to.equal(0);
    expect(await f.asset.balanceOf(f.vault.target)).to.equal(0); // entire operation reverted
  });

  it("rejects the same condition through standard deposit/handleDeposit", async function () {
    const f = await fixture();
    await f.vault.configure(1, 0, 0, 0);
    await expect(f.token.connect(f.user).deposit(100n, f.user.address)).to.be.revertedWithCustomError(f.router, "StrategyBackingLoss");
    expect(await f.token.totalSupply()).to.equal(0);
  });

  it("rejects the same condition through standard mint", async function () {
    const f = await fixture();
    await f.vault.configure(1, 0, 0, 0);
    await expect(f.token.connect(f.user).mint(100n, f.user.address)).to.be.revertedWithCustomError(f.router, "StrategyBackingLoss");
  });

  it("rejects matching tiny NONZERO preview/actual/reported shares with insufficient backing", async function () {
    const f = await fixture();
    await f.vault.configure(2, 99, 0, 0);
    await expect(f.deposit(100n)).to.be.revertedWithCustomError(f.router, "StrategyBackingLoss");
    expect(await f.token.totalSupply()).to.equal(0);
  });

  it("protects solverDepositShares, which also pulls underlying assets", async function () {
    const f = await fixture();
    await f.vault.configure(2, 99, 0, 0);
    await expect(f.router.connect(f.user).solverDepositShares([f.vault.target], [1n], 0, f.user.address))
      .to.be.revertedWithCustomError(f.router, "StrategyBackingLoss");
  });

  it("does not let a healthy leg hide an insufficiently backed leg", async function () {
    const f = await fixture();
    const bad = await f.addVault(false, 0);
    await bad.vault.configure(2, 99, 0, 0);
    await expect(f.router.connect(f.user).solverDepositAssets([f.vault.target, bad.vault.target], [100n, 100n], 0, f.user.address))
      .to.be.revertedWithCustomError(f.router, "StrategyBackingLoss");
    expect(await f.token.totalSupply()).to.equal(0);
    expect(await f.vault.balanceOf(f.collateral.target)).to.equal(0);
  });

  it("bounds rounding loss once per entire operation, including duplicate vault legs", async function () {
    const f = await fixture();
    await f.vault.configure(0, 1, 0, 0);
    await expect(f.router.connect(f.user).solverDepositAssets([f.vault.target, f.vault.target], [100n, 100n], 0, f.user.address))
      .to.be.revertedWithCustomError(f.router, "StrategyBackingLoss");
  });

  it("allows one smallest asset unit of nonzero attributable-backing rounding loss", async function () {
    const f = await fixture();
    await f.vault.configure(0, 1, 0, 0);
    await f.deposit(100n);
    expect(await f.token.totalAssets()).to.equal(99n);
    expect(await f.token.totalSupply()).to.equal(100n);
  });

  it("does not turn the tolerance into permission to credit a one-unit zero-backing deposit", async function () {
    const f = await fixture();
    await f.vault.configure(1, 0, 0, 0);
    await expect(f.deposit(1n)).to.be.revertedWithCustomError(f.router, "StrategyBackingLoss");
  });

  it("allows zero NEW shares when already-owned shares gain sufficient backing", async function () {
    const f = await fixture();
    await f.deposit(10n ** 18n);
    const beforeShares = await f.vault.balanceOf(f.collateral.target);
    const beforeAssets = await f.token.totalAssets();
    await f.vault.configure(1, 0, 0, 0);
    await f.deposit(100n);
    expect(await f.vault.balanceOf(f.collateral.target)).to.equal(beforeShares);
    expect((await f.token.totalAssets()) - beforeAssets).to.be.gte(99n);
  });

  it("handles a legacy Idle donation without granting unsupported outer claims; reserves remain reserved", async function () {
    const f = await fixture();
    const idle = await f.addVault(true, 0);
    await f.asset.connect(f.other).approve(idle.vault.target, ethers.MaxUint256);
    await idle.vault.connect(f.other).deposit(10n, f.other.address);
    await f.asset.connect(f.other).transfer(idle.vault.target, 1_000_000n);
    await f.asset.approve(idle.vault.target, 500n);
    await idle.vault.fundRewards(500n);
    const reserve = await idle.vault.rewardReserve();
    await expect(f.deposit(100n, idle.vault.target)).to.be.revertedWithCustomError(f.router, "StrategyBackingLoss");
    expect(await idle.vault.rewardReserve()).to.equal(reserve);
    expect(await f.token.totalSupply()).to.equal(0);
  });

  it("checks reinvestment instead of trusting nominal cash redeposited", async function () {
    const f = await fixture();
    await f.asset.transfer(f.router.target, 100n);
    await f.vault.configure(2, 99, 0, 0);
    await expect(f.router.reinvestFees()).to.be.revertedWithCustomError(f.router, "StrategyBackingLoss");
    expect(await f.asset.balanceOf(f.router.target)).to.equal(100n);
  });

  it("checks governance surplus sweeps through the same primitive", async function () {
    const f = await fixture();
    await f.asset.transfer(f.router.target, 100n);
    await f.vault.configure(2, 99, 0, 0);
    await expect(f.router.sweepSurplus(0)).to.be.revertedWithCustomError(f.router, "StrategyBackingLoss");
  });

  for (const entry of ["rebalanceStrategiesByShares", "rebalanceStrategiesBySharesViaExternalLiquidity"]) {
    it(`checks backing in ${entry}`, async function () {
      const f = await fixture();
      await f.deposit(1_000n);
      const bad = await f.addVault(false, 0);
      await bad.vault.configure(2, 99, 0, 0);
      await expect(f.router[entry](f.vault.target, bad.vault.target, 100n, 0))
        .to.be.revertedWithCustomError(f.router, "StrategyBackingLoss");
    });
  }

  it("rejects a withdrawal return-value lie even when the router has enough pre-existing cash", async function () {
    const f = await fixture();
    await f.deposit(1_000n);
    await f.asset.transfer(f.router.target, 100n);
    await f.vault.configure(0, 0, 0, 50);
    await expect(f.router.connect(f.user).solverWithdrawAssets([f.vault.target], [100n], ethers.MaxUint256, f.user.address, f.user.address))
      .to.be.revertedWithCustomError(f.router, "WithdrawalAssetsMismatch");
  });

  it("checks actual cash in standard withdrawals before it can consume old router cash", async function () {
    const f = await fixture();
    await f.deposit(1_000n);
    await f.asset.transfer(f.router.target, 100n);
    await f.vault.configure(0, 0, 0, 50);
    await expect(f.token.connect(f.user).withdraw(100n, f.user.address, f.user.address))
      .to.be.revertedWithCustomError(f.router, "WithdrawalAssetsMismatch");
  });

  it("checks actual cash in solverWithdrawShares too", async function () {
    const f = await fixture();
    await f.deposit(1_000n);
    await f.vault.configure(0, 0, 0, 50);
    await expect(f.router.connect(f.user).solverWithdrawShares([f.vault.target], [100n], ethers.MaxUint256, f.user.address, f.user.address))
      .to.be.revertedWithCustomError(f.router, "WithdrawalAssetsMismatch");
  });

  it("rejects withdrawal-induced loss to the remaining strategy position", async function () {
    const f = await fixture();
    await f.deposit(1_000n);
    await f.vault.configure(0, 0, 50, 0);
    await expect(f.token.connect(f.user).withdraw(100n, f.user.address, f.user.address))
      .to.be.revertedWithCustomError(f.router, "StrategyWithdrawalLoss");
  });

  it("retains withdrawal rounding surplus instead of paying unpriced assets to the user", async function () {
    const f = await fixture();
    await f.deposit(1_000n);
    await f.asset.transfer(f.vault.target, 1_000n);
    const before = await f.asset.balanceOf(f.user.address);
    await f.token.connect(f.user).withdraw(2n, f.user.address, f.user.address);
    expect((await f.asset.balanceOf(f.user.address)) - before).to.equal(2n);
    expect(await f.asset.balanceOf(f.router.target)).to.equal(1n);
  });

  it("preserves unlimited-cap semantics and explicit zero-weight solver routing", async function () {
    const f = await fixture();
    const zeroWeight = await f.addVault(false, 0);
    await f.router.setDepositCap(0);
    await f.deposit(100n, zeroWeight.vault.target);
    expect(await f.token.totalSupply()).to.equal(100n);
  });

  it("still rejects suspended vaults", async function () {
    const f = await fixture();
    await f.router.emergencyPauseVault(f.vault.target);
    await expect(f.deposit(100n)).to.be.revertedWithCustomError(f.router, "VaultNotActive");
  });

  it("still enforces the global deposit cap", async function () {
    const f = await fixture();
    await f.router.setDepositCap(100n);
    await expect(f.deposit(101n)).to.be.revertedWithCustomError(f.router, "DepositCapExceeded");
  });

  it("makes pause cover privileged strategy movements as well as public flows", async function () {
    const f = await fixture();
    await f.router.pause();
    await expect(f.router.sweepSurplus(0)).to.be.revertedWithCustomError(f.router, "EnforcedPause");
    await expect(f.router.rebalanceStrategiesByShares(f.vault.target, f.vault.target, 1, 0))
      .to.be.revertedWithCustomError(f.router, "EnforcedPause");
  });

  it("cleans allowances after successful deposits and withdrawals", async function () {
    const f = await fixture();
    await f.deposit(1_000n);
    await f.router.connect(f.user).solverWithdrawAssets([f.vault.target], [100n], ethers.MaxUint256, f.user.address, f.user.address);
    expect(await f.asset.allowance(f.router.target, f.adapter.target)).to.equal(0);
    expect(await f.vault.allowance(f.router.target, f.adapter.target)).to.equal(0);
  });
});
