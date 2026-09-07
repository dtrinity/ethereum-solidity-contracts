import { expect } from "chai";
import { ethers } from "hardhat";
import { staticFixture } from "./fixtures";
import { backingFixture } from "../incident-2026-09-05/fixture";

const RAY = 10n ** 27n;
const INPUT = 1_000_000_000_000_000_009n;
async function roundingFixture() {
  const f = await staticFixture();
  await f.deposit(1_000n * 10n ** 18n); // nonzero outer supply before adding an existing static position
  await f.pool.setIncome((109n * RAY) / 100n);
  await f.seed(f.collateral.target, 100_000n * 10n ** 18n);
  return f;
}

describe("Follow-up: bounded honest rounding", function () {
  it("reproduces the two-unit loss with REAL StaticATokenLM and the entire existing position", async function () {
    const f = await roundingFixture();
    const shares = await f.wrapper.balanceOf(f.collateral.target);
    const newShares = await f.wrapper.previewDeposit(INPUT);
    const increase = (await f.wrapper.previewRedeem(shares + newShares)) - (await f.wrapper.previewRedeem(shares));
    expect(INPUT - increase).to.equal(2);
    expect(newShares).to.be.gt(0);
    await expect(f.router.connect(f.user).solverDepositAssets([f.wrapper.target], [INPUT], 0, f.user.address)).to.be.reverted;
    await f.router.pause();
    await f.router.setStrategyRoundingLoss(f.wrapper.target, 2);
    await f.router.setOperationRoundingLoss(2);
    await f.router.unpause();
    const before = await f.token.totalAssets();
    await f.router.connect(f.user).solverDepositAssets([f.wrapper.target], [INPUT], 0, f.user.address);
    expect((await f.token.totalAssets()) - before).to.equal(INPUT - 2n);
  });

  it("keeps the aggregate limit independent from a permissive per-strategy setting", async function () {
    const f = await roundingFixture();
    await f.router.pause();
    await f.router.setStrategyRoundingLoss(f.wrapper.target, 2);
    await f.router.unpause(); // operation remains 1
    await expect(f.router.connect(f.user).solverDepositAssets([f.wrapper.target], [INPUT], 0, f.user.address)).to.be.reverted;
  });

  it("does not multiply the operation budget for repeated strategy legs", async function () {
    const f = await roundingFixture();
    await f.router.pause();
    await f.router.setStrategyRoundingLoss(f.wrapper.target, 2);
    await f.router.setOperationRoundingLoss(2);
    await f.router.unpause();
    await expect(f.router.connect(f.user).solverDepositAssets([f.wrapper.target, f.wrapper.target], [INPUT, INPUT], 0, f.user.address)).to
      .be.reverted;
  });

  it("requires privileged paused configuration and rejects budgets above 16 base units", async function () {
    const f = await roundingFixture();
    await expect(f.router.setOperationRoundingLoss(2)).to.be.reverted;
    await f.router.pause();
    await expect(f.router.connect(f.other).setOperationRoundingLoss(2)).to.be.reverted;
    await expect(f.router.setOperationRoundingLoss(17)).to.be.reverted;
    await expect(f.router.setStrategyRoundingLoss(f.wrapper.target, 17)).to.be.reverted;
    await f.router.setOperationRoundingLoss(0);
    await f.router.setStrategyRoundingLoss(f.wrapper.target, 0);
    expect(await f.router.strategyRoundingLoss(f.wrapper.target)).to.equal(0);
  });

  it("still refuses zero added backing at the maximum allowance", async function () {
    const f = await backingFixture();
    await f.router.pause();
    await f.router.setOperationRoundingLoss(16);
    await f.router.setStrategyRoundingLoss(f.vault.target, 16);
    await f.router.unpause();
    await f.vault.configure(1, 0, 0, 0);
    await expect(f.deposit(2n)).to.be.reverted;
  });
});

describe("Follow-up: strategy eligibility is not NAV membership", function () {
  it("rejects replacing the adapter for a funded strategy", async function () {
    const f = await backingFixture();
    await f.deposit(1_000n);
    const replacementAdapter: any = await (
      await ethers.getContractFactory("GenericERC4626ConversionAdapter")
    ).deploy(f.asset.target, f.vault.target, f.collateral.target);

    await expect(
      f.router["updateVaultConfig(address,address,uint256,uint8)"](f.vault.target, replacementAdapter.target, 1_000_000, 0),
    ).to.be.revertedWithCustomError(f.router, "FundedStrategyAdapterReplacement");
    expect(await f.router.strategyShareToAdapter(f.vault.target)).to.equal(f.adapter.target);
  });

  it("preserves funded NAV during config replacement and suspension", async function () {
    const f = await backingFixture();
    await f.deposit(1_000n);
    const value = await f.token.totalAssets();
    await f.router.setVaultConfigs([[f.vault.target, f.adapter.target, 1_000_000, 1]]);
    expect(await f.token.totalAssets()).to.equal(value);
    expect(await f.collateral.getSupportedStrategyShares()).to.deep.equal([f.vault.target]);
  });

  it("rejects removing a funded strategy through either public governance route", async function () {
    const f = await backingFixture();
    await f.deposit(1_000n);
    const v2 = await f.addVault(false, 0);
    await expect(f.router.removeAdapter(f.vault.target)).to.be.reverted;
    await expect(f.router.setVaultConfigs([[v2.vault.target, v2.adapter.target, 1_000_000, 0]])).to.be.reverted;
    expect(await f.token.totalAssets()).to.equal(1_000);
  });

  for (const value of [1n, 100n]) {
    it(`permits explicit one-unit dust only, residual underlying value=${value}`, async function () {
      const f = await backingFixture();
      const v2 = await f.addVault(false, 0);
      await f.asset.approve(f.vault.target, value);
      await f.vault.deposit(value, f.collateral.target);
      await f.router.setVaultConfigs([
        [f.vault.target, f.adapter.target, 0, 1],
        [v2.vault.target, v2.adapter.target, 1_000_000, 0],
      ]);
      await f.router.pause();
      if (value > 1n) {
        await expect(f.router.disposeRetiredStrategyDust(f.vault.target)).to.be.reverted;
      } else {
        await expect(f.router.connect(f.other).disposeRetiredStrategyDust(f.vault.target)).to.be.reverted;
        await f.router.disposeRetiredStrategyDust(f.vault.target);
        expect(await f.vault.balanceOf(f.collateral.target)).to.equal(0);
        await f.router.removeVault(f.vault.target);
        expect(await f.collateral.getSupportedStrategyShares()).not.to.include(f.vault.target);
      }
    });
  }
});
