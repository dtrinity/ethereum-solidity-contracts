import { expect } from "chai";
import { time } from "@nomicfoundation/hardhat-network-helpers";
import { ethers } from "hardhat";
import { SignerWithAddress } from "@nomicfoundation/hardhat-ethers/signers";
import { DStakeIdleVault, TestMintableERC20 } from "../../typechain-types";

async function deployIdleVaultFixture(): Promise<{
  admin: SignerWithAddress;
  treasury: SignerWithAddress;
  alice: SignerWithAddress;
  keeper: SignerWithAddress;
  asset: TestMintableERC20;
  vault: DStakeIdleVault;
}> {
  const [admin, treasury, alice, keeper] = await ethers.getSigners();

  const tokenFactory = await ethers.getContractFactory("TestMintableERC20");
  const asset = (await tokenFactory.deploy("Mock dStable", "dSTBL", 18)) as TestMintableERC20;

  const vaultFactory = await ethers.getContractFactory("DStakeIdleVault");
  const vault = (await vaultFactory.deploy(asset.target, "dStake Idle Vault", "dIDLE", admin.address, treasury.address)) as DStakeIdleVault;

  return { admin, treasury, alice, keeper, asset, vault };
}

describe("IdleVaultRewardSweep", function () {
  it("requires reserve coverage before enabling emissions", async function () {
    const { vault, asset, treasury } = await deployIdleVaultFixture();

    const emissionRate = ethers.parseUnits("1", 18);
    const start = (await time.latest()) + 10;
    const duration = 3 * 24 * 60 * 60; // three days
    const end = start + duration;
    const requiredFunding = emissionRate * BigInt(duration);

    await expect(vault.connect(treasury).setEmissionSchedule(start, end, emissionRate)).to.be.revertedWithCustomError(
      vault,
      "InsufficientRewardReserve",
    );

    await asset.mint(treasury.address, requiredFunding);
    await asset.connect(treasury).approve(vault.target, ethers.MaxUint256);
    await expect(vault.connect(treasury).fundAndScheduleEmission(start, end, emissionRate, requiredFunding))
      .to.emit(vault, "RewardsFunded")
      .withArgs(treasury.address, requiredFunding)
      .and.to.emit(vault, "EmissionScheduleSet")
      .withArgs(start, end, emissionRate);
  });

  it("reverts unbounded emission rates", async function () {
    const { vault, treasury } = await deployIdleVaultFixture();
    const emissionRate = ethers.parseUnits("1", 18);
    const start = await time.latest();

    await expect(vault.connect(treasury).setEmissionSchedule(start, 0, emissionRate)).to.be.revertedWithCustomError(
      vault,
      "UnboundedEmissionRate",
    );
  });

  it("allows the treasury to strip idle emissions before a fresh depositor enters", async function () {
    const { vault, asset, treasury, alice } = await deployIdleVaultFixture();

    const emissionRate = ethers.parseUnits("1", 18);
    const emissionDuration = 7 * 24 * 60 * 60; // one week
    const fundingAmount = emissionRate * BigInt(emissionDuration);
    const sentinelDeposit = fundingAmount; // keep supply comfortably above zero
    const userDeposit = ethers.parseUnits("1", 18);

    await asset.mint(treasury.address, fundingAmount + sentinelDeposit);
    await asset.connect(treasury).approve(vault.target, ethers.MaxUint256);
    await vault.connect(treasury).deposit(sentinelDeposit, treasury.address);

    const start = await time.latest();
    await vault.connect(treasury).fundAndScheduleEmission(start, start + emissionDuration, emissionRate, fundingAmount);

    await time.increase(3600);
    const pendingBeforeSweep = await vault.pendingEmission();
    expect(pendingBeforeSweep).to.be.gt(0n);
    expect(await vault.maxWithdraw(treasury.address)).to.be.gte(pendingBeforeSweep);

    const treasuryBalanceBefore = await asset.balanceOf(treasury.address);
    await vault.connect(treasury).withdraw(pendingBeforeSweep, treasury.address, treasury.address);
    const treasuryBalanceAfter = await asset.balanceOf(treasury.address);

    const rewardCollected = treasuryBalanceAfter - treasuryBalanceBefore;
    expect(rewardCollected).to.be.gte(pendingBeforeSweep);
    expect(rewardCollected - pendingBeforeSweep).to.be.lte(emissionRate);

    const sentinelSharesRemaining = await vault.balanceOf(treasury.address);
    expect(sentinelSharesRemaining).to.be.gt(0n);
    expect(sentinelSharesRemaining).to.be.lt(sentinelDeposit);

    const remainingReserve = await vault.rewardReserve();
    const reserveGap = fundingAmount - rewardCollected - remainingReserve;
    expect(reserveGap).to.be.gte(0n);
    expect(reserveGap).to.be.lte(emissionRate);

    await asset.mint(alice.address, userDeposit);
    await asset.connect(alice).approve(vault.target, userDeposit);
    const aliceBalanceBefore = await asset.balanceOf(alice.address);

    await vault.connect(alice).deposit(userDeposit, alice.address);
    const aliceShares = await vault.balanceOf(alice.address);
    expect(aliceShares).to.be.gt(0n);

    await vault.connect(alice).redeem(aliceShares, alice.address, alice.address);
    const aliceBalanceAfter = await asset.balanceOf(alice.address);
    const aliceDelta = aliceBalanceAfter - aliceBalanceBefore;
    expect(aliceDelta).to.be.gte(0n);
    expect(aliceDelta).to.be.lte(emissionRate);
  });

  it("keeps repeated treasury sweeps ahead of cumulative idle emissions", async function () {
    const { vault, asset, treasury } = await deployIdleVaultFixture();

    const emissionRate = ethers.parseUnits("2", 18);
    const emissionDuration = 6 * 60 * 60; // six hours
    const fundingAmount = emissionRate * BigInt(emissionDuration);
    const sentinelDeposit = fundingAmount; // sentinel supply equals full emission budget
    const cadenceSteps = [300, 901, 1200, 1800, 900];

    await asset.mint(treasury.address, fundingAmount + sentinelDeposit);
    await asset.connect(treasury).approve(vault.target, ethers.MaxUint256);
    await vault.connect(treasury).deposit(sentinelDeposit, treasury.address);

    const start = await time.latest();
    await vault.connect(treasury).fundAndScheduleEmission(start, start + emissionDuration, emissionRate, fundingAmount);

    let cumulativeCollected = 0n;

    for (const seconds of cadenceSteps) {
      await time.increase(seconds);
      const pending = await vault.pendingEmission();
      if (pending === 0n) {
        break;
      }

      expect(await vault.maxWithdraw(treasury.address)).to.be.gte(pending);

      const balanceBefore = await asset.balanceOf(treasury.address);
      await vault.connect(treasury).withdraw(pending, treasury.address, treasury.address);
      const balanceAfter = await asset.balanceOf(treasury.address);

      const iterationReward = balanceAfter - balanceBefore;
      expect(iterationReward).to.be.gte(pending);
      expect(iterationReward - pending).to.be.lte(emissionRate);

      cumulativeCollected += iterationReward;
    }

    const finalTreasuryBalance = await asset.balanceOf(treasury.address);
    expect(finalTreasuryBalance).to.equal(cumulativeCollected);

    const remainingReserve = await vault.rewardReserve();
    const reserveGap = fundingAmount - cumulativeCollected - remainingReserve;
    const maxTolerance = emissionRate * BigInt(cadenceSteps.length + 1);
    expect(reserveGap).to.be.gte(0n);
    expect(reserveGap).to.be.lte(maxTolerance);

    const sentinelSharesFinal = await vault.balanceOf(treasury.address);
    expect(sentinelSharesFinal).to.be.gt(0n);
  });

  it("exposes reserve requirements for monitoring", async function () {
    const { vault, asset, treasury } = await deployIdleVaultFixture();
    const emissionRate = ethers.parseUnits("3", 18);
    const duration = 12 * 60 * 60;
    const start = (await time.latest()) + 30;
    const end = start + duration;
    const requiredFunding = emissionRate * BigInt(duration);

    await asset.mint(treasury.address, requiredFunding);
    await asset.connect(treasury).approve(vault.target, ethers.MaxUint256);

    const required = await vault.requiredReserve(start, end, emissionRate);
    expect(required).to.equal(requiredFunding);

    await vault.connect(treasury).fundRewards(requiredFunding);
    await vault.connect(treasury).setEmissionSchedule(start, end, emissionRate);
    expect(await vault.rewardReserve()).to.equal(requiredFunding);
  });
});
