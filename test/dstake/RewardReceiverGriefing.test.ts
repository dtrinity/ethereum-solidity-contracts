import { HardhatEthersSigner } from "@nomicfoundation/hardhat-ethers/signers";
import { loadFixture } from "@nomicfoundation/hardhat-network-helpers";
import { expect } from "chai";
import { ethers } from "hardhat";

import {
  MockERC20Blocklist,
  MockRewardHookToken,
  RewardReceiverGriefingHarness,
  RewardReentrantReceiver,
  TestMintableERC20,
} from "../../typechain-types";

interface BaseHarnessContext {
  deployer: HardhatEthersSigner;
  treasury: HardhatEthersSigner;
  vault: HardhatEthersSigner;
  receiver: HardhatEthersSigner;
  exchangeToken: TestMintableERC20;
  rewardToken: TestMintableERC20;
  rewardManager: RewardReceiverGriefingHarness;
  rewardTokens: string[];
  depositAmount: bigint;
  claimAmount: bigint;
}

interface BlocklistHarnessContext extends Omit<BaseHarnessContext, "rewardToken"> {
  rewardToken: MockERC20Blocklist;
}

interface ReentrancyHarnessContext {
  deployer: HardhatEthersSigner;
  treasury: HardhatEthersSigner;
  vault: HardhatEthersSigner;
  reentrantSigner: HardhatEthersSigner;
  exchangeToken: TestMintableERC20;
  rewardToken: MockRewardHookToken;
  rewardManager: RewardReceiverGriefingHarness;
  reentrantReceiver: RewardReentrantReceiver;
  rewardTokens: string[];
  depositAmount: bigint;
  claimAmount: bigint;
}

/** Deploys the standard RewardClaimable harness with ERC20 reward token. */
async function deployBaseHarness(): Promise<BaseHarnessContext> {
  const [deployer, treasury, vault, , receiver] = (await ethers.getSigners()) as HardhatEthersSigner[];

  const exchangeToken = (await ethers.deployContract("TestMintableERC20", ["dStable", "dSTB", 18])) as TestMintableERC20;
  const rewardToken = (await ethers.deployContract("TestMintableERC20", ["Reward", "RWD", 18])) as TestMintableERC20;

  const rewardManager = (await ethers.deployContract("RewardReceiverGriefingHarness", [
    exchangeToken.target,
    rewardToken.target,
    treasury.address,
    vault.address,
  ])) as RewardReceiverGriefingHarness;

  const rewardTokens = [rewardToken.target];
  const depositAmount = ethers.parseUnits("10", await exchangeToken.decimals());
  const claimAmount = ethers.parseUnits("5", await rewardToken.decimals());

  return {
    deployer,
    treasury,
    vault,
    receiver,
    exchangeToken,
    rewardToken,
    rewardManager,
    rewardTokens,
    depositAmount,
    claimAmount,
  };
}

/** Deploys harness with a blocklisting reward token. */
async function deployBlocklistHarness(): Promise<BlocklistHarnessContext> {
  const [deployer, treasury, vault, , receiver] = (await ethers.getSigners()) as HardhatEthersSigner[];

  const exchangeToken = (await ethers.deployContract("TestMintableERC20", ["dStable", "dSTB", 18])) as TestMintableERC20;
  const rewardToken = (await ethers.deployContract("MockERC20Blocklist", ["Blocked Reward", "bRWD", 18])) as MockERC20Blocklist;

  const rewardManager = (await ethers.deployContract("RewardReceiverGriefingHarness", [
    exchangeToken.target,
    rewardToken.target,
    treasury.address,
    vault.address,
  ])) as RewardReceiverGriefingHarness;

  const rewardTokens = [rewardToken.target];
  const depositAmount = ethers.parseUnits("10", await exchangeToken.decimals());
  const claimAmount = ethers.parseUnits("7", await rewardToken.decimals());

  return {
    deployer,
    treasury,
    vault,
    receiver,
    exchangeToken,
    rewardToken,
    rewardManager,
    rewardTokens,
    depositAmount,
    claimAmount,
  };
}

/** Deploys harness with a hooked reward token to exercise reentrancy. */
async function deployReentrancyHarness(): Promise<ReentrancyHarnessContext> {
  const [deployer, treasury, vault, , , reentrantSigner] = (await ethers.getSigners()) as HardhatEthersSigner[];

  const exchangeToken = (await ethers.deployContract("TestMintableERC20", ["dStable", "dSTB", 18])) as TestMintableERC20;
  const rewardToken = (await ethers.deployContract("MockRewardHookToken", ["Reward", "RHT"])) as MockRewardHookToken;

  const rewardManager = (await ethers.deployContract("RewardReceiverGriefingHarness", [
    exchangeToken.target,
    rewardToken.target,
    treasury.address,
    vault.address,
  ])) as RewardReceiverGriefingHarness;

  const reentrantFactory = await ethers.getContractFactory("RewardReentrantReceiver", reentrantSigner);
  const reentrantReceiver = (await reentrantFactory.deploy()) as RewardReentrantReceiver;

  const rewardTokens = [rewardToken.target];
  const depositAmount = ethers.parseUnits("4", await exchangeToken.decimals());
  const claimAmount = ethers.parseUnits("2", await rewardToken.decimals());

  return {
    deployer,
    treasury,
    vault,
    reentrantSigner,
    exchangeToken,
    rewardToken,
    rewardManager,
    reentrantReceiver,
    rewardTokens,
    depositAmount,
    claimAmount,
  };
}

describe("RewardReceiverGriefing", function () {
  describe("burn address receiver", function () {
    it("reverts when rewards are directed to the zero address", async function () {
      const { deployer, exchangeToken, rewardToken, rewardManager, rewardTokens, depositAmount, claimAmount } =
        await loadFixture(deployBaseHarness);

      await rewardToken.mint(deployer.address, claimAmount);
      await rewardToken.connect(deployer).approve(rewardManager.target, claimAmount);
      await rewardManager.connect(deployer).fundRewards(claimAmount);
      await rewardManager.setClaimAmount(claimAmount);

      await exchangeToken.mint(deployer.address, depositAmount);
      await exchangeToken.connect(deployer).approve(rewardManager.target, depositAmount);

      await expect(
        rewardManager.connect(deployer).compoundRewards(depositAmount, rewardTokens, ethers.ZeroAddress),
      ).to.be.revertedWithCustomError(rewardManager, "ZeroReceiverAddress");
    });
  });

  describe("reverting receiver contract", function () {
    it("rolls back the entire compound when the receiver blocks transfers", async function () {
      const { deployer, exchangeToken, rewardToken, rewardManager, rewardTokens, receiver, depositAmount, claimAmount } =
        await loadFixture(deployBlocklistHarness);

      await rewardToken.mint(deployer.address, claimAmount);
      await rewardToken.connect(deployer).approve(rewardManager.target, claimAmount);
      await rewardManager.connect(deployer).fundRewards(claimAmount);
      await rewardManager.setClaimAmount(claimAmount);

      await exchangeToken.mint(deployer.address, depositAmount);
      await exchangeToken.connect(deployer).approve(rewardManager.target, depositAmount);

      await rewardToken.setBlocked(receiver.address, true);

      const callerBalanceBefore = await exchangeToken.balanceOf(deployer.address);
      const managerBalanceBefore = await exchangeToken.balanceOf(rewardManager.target);
      const rewardBalanceBefore = await rewardToken.balanceOf(rewardManager.target);

      await expect(
        rewardManager.connect(deployer).compoundRewards(depositAmount, rewardTokens, receiver.address),
      ).to.be.revertedWithCustomError(rewardToken, "BlockedRecipient");

      expect(await exchangeToken.balanceOf(deployer.address)).to.equal(callerBalanceBefore);
      expect(await exchangeToken.balanceOf(rewardManager.target)).to.equal(managerBalanceBefore);
      expect(await rewardToken.balanceOf(rewardManager.target)).to.equal(rewardBalanceBefore);
    });
  });

  describe("ERC777-style reentrancy", function () {
    it("guards against reentrant hooks during compoundRewards", async function () {
      const {
        deployer,
        exchangeToken,
        rewardToken,
        rewardManager,
        reentrantReceiver,
        reentrantSigner,
        rewardTokens,
        depositAmount,
        claimAmount,
      } = await loadFixture(deployReentrancyHarness);

      await rewardToken.mint(deployer.address, claimAmount * 2n);
      await rewardToken.connect(deployer).approve(rewardManager.target, claimAmount * 2n);
      await rewardManager.connect(deployer).fundRewards(claimAmount * 2n);
      await rewardManager.setClaimAmount(claimAmount);

      await exchangeToken.mint(deployer.address, depositAmount);
      await exchangeToken.connect(deployer).approve(rewardManager.target, depositAmount);

      const threshold = await rewardManager.exchangeThreshold();
      await exchangeToken.mint(await reentrantReceiver.getAddress(), threshold);

      await reentrantReceiver.connect(reentrantSigner).configure(rewardManager.target, exchangeToken.target);

      const rewardsRole = await rewardManager.REWARDS_MANAGER_ROLE();
      await rewardManager.grantRole(rewardsRole, await reentrantReceiver.getAddress());

      await rewardToken.setHook(await reentrantReceiver.getAddress(), true);

      await expect(
        rewardManager.connect(deployer).compoundRewards(depositAmount, rewardTokens, await reentrantReceiver.getAddress()),
      ).to.be.revertedWithCustomError(rewardManager, "ReentrancyGuardReentrantCall");

      expect(await exchangeToken.balanceOf(await reentrantReceiver.getAddress())).to.equal(threshold);
    });
  });
});
