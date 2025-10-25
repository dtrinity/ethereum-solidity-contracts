import { HardhatEthersSigner } from "@nomicfoundation/hardhat-ethers/signers";
import { loadFixture } from "@nomicfoundation/hardhat-network-helpers";
import { expect } from "chai";
import { ethers } from "hardhat";

import { RewardExchangeDustHarness, TestMintableERC20 } from "../../typechain-types";

interface DustHarnessContext {
  deployer: HardhatEthersSigner;
  treasury: HardhatEthersSigner;
  keeper: HardhatEthersSigner;
  vault: HardhatEthersSigner;
  receiver: HardhatEthersSigner;
  exchangeToken: TestMintableERC20;
  alphaToken: TestMintableERC20;
  betaToken: TestMintableERC20;
  rewardManager: RewardExchangeDustHarness;
  rewardTokens: string[];
  exchangeRewardAmount: bigint;
  alphaRewardAmount: bigint;
  betaRewardAmount: bigint;
  depositAmount: bigint;
  dustDivisor: bigint;
}

async function deployDustHarnessFixture(): Promise<DustHarnessContext> {
  const [deployer, treasury, keeper, vault, receiver] = (await ethers.getSigners()) as HardhatEthersSigner[];

  const exchangeToken = (await ethers.deployContract("TestMintableERC20", [
    "dStable",
    "dSTB",
    18,
  ])) as TestMintableERC20;
  const alphaToken = (await ethers.deployContract("TestMintableERC20", [
    "AlphaReward",
    "ALPHA",
    18,
  ])) as TestMintableERC20;
  const betaToken = (await ethers.deployContract("TestMintableERC20", [
    "BetaReward",
    "BETA",
    18,
  ])) as TestMintableERC20;

  const rewardManager = (await ethers.deployContract("RewardExchangeDustHarness", [
    exchangeToken.target,
    treasury.address,
    vault.address,
  ])) as RewardExchangeDustHarness;

  const dustDivisor = 37n;
  await rewardManager.setDustDivisor(dustDivisor);

  const exchangeRewardAmount = ethers.parseUnits("2", await exchangeToken.decimals());
  const alphaRewardAmount = ethers.parseUnits("3", await alphaToken.decimals());
  const betaRewardAmount = ethers.parseUnits("5", await betaToken.decimals());

  const rewardTokens = [exchangeToken.target, alphaToken.target, betaToken.target];
  await rewardManager.setClaimAmounts(rewardTokens, [exchangeRewardAmount, alphaRewardAmount, betaRewardAmount]);

  const rewardsRole = await rewardManager.REWARDS_MANAGER_ROLE();
  await rewardManager.grantRole(rewardsRole, keeper.address);

  const depositAmount = ethers.parseUnits("253", await exchangeToken.decimals());

  return {
    deployer,
    treasury,
    keeper,
    vault,
    receiver,
    exchangeToken,
    alphaToken,
    betaToken,
    rewardManager,
    rewardTokens,
    exchangeRewardAmount,
    alphaRewardAmount,
    betaRewardAmount,
    depositAmount,
    dustDivisor,
  };
}

async function seedKeeperLiquidity(
  token: TestMintableERC20,
  keeper: HardhatEthersSigner,
  spender: string,
  amountPerCompound: bigint,
  compounds: number,
): Promise<bigint> {
  const totalAmount = amountPerCompound * BigInt(compounds);
  await token.mint(keeper.address, totalAmount);
  await token.connect(keeper).approve(spender, totalAmount);
  return totalAmount;
}

function permutations<T>(input: T[]): T[][] {
  if (input.length === 0) {
    return [[]];
  }

  const result: T[][] = [];
  for (let i = 0; i < input.length; i += 1) {
    const current = input[i];
    const rest = [...input.slice(0, i), ...input.slice(i + 1)];
    for (const perm of permutations(rest)) {
      result.push([current, ...perm]);
    }
  }
  return result;
}

describe("RewardExchangeDust", function () {
  describe("dust elimination", function () {
    it("sweeps exchange-asset dust back to a deterministic remainder after each compound", async function () {
      const context = await loadFixture(deployDustHarnessFixture);
      const {
        keeper,
        receiver,
        vault,
        exchangeToken,
        alphaToken,
        betaToken,
        rewardManager,
        rewardTokens,
        depositAmount,
        dustDivisor,
        exchangeRewardAmount,
        alphaRewardAmount,
        betaRewardAmount,
      } = context;

      const iterations = 37;
      await seedKeeperLiquidity(exchangeToken, keeper, rewardManager.target, depositAmount, iterations);

      const deterministicRemainder = depositAmount % dustDivisor;
      const forwarded = depositAmount - deterministicRemainder;

      for (let i = 0; i < iterations; i += 1) {
        await rewardManager.connect(keeper).compoundRewards(depositAmount, rewardTokens, receiver.address);

        const contractBalance = await exchangeToken.balanceOf(rewardManager.target);
        expect(contractBalance).to.equal(
          deterministicRemainder,
          `unexpected dust after iteration ${i + 1}`,
        );

        const sinkBalance = await exchangeToken.balanceOf(vault.address);
        expect(sinkBalance).to.equal(
          forwarded * BigInt(i + 1),
          `vault should receive each forwarded deposit portion (iteration ${i + 1})`,
        );
      }

      const receiverExchangeBalance = await exchangeToken.balanceOf(receiver.address);
      const remainderBonus = iterations > 0 ? deterministicRemainder * BigInt(iterations - 1) : 0n;
      expect(receiverExchangeBalance).to.equal(exchangeRewardAmount * BigInt(iterations) + remainderBonus);
      expect(await alphaToken.balanceOf(receiver.address)).to.equal(alphaRewardAmount * BigInt(iterations));
      expect(await betaToken.balanceOf(receiver.address)).to.equal(betaRewardAmount * BigInt(iterations));
      expect(await exchangeToken.balanceOf(keeper.address)).to.equal(0n);
    });
  });

  describe("ordering invariance", function () {
    it("prevents keepers from reclaiming deposits regardless of reward token order", async function () {
      const context = await loadFixture(deployDustHarnessFixture);
      const {
        keeper,
        receiver,
        vault,
        exchangeToken,
        alphaToken,
        betaToken,
        rewardManager,
        rewardTokens,
        depositAmount,
        dustDivisor,
        exchangeRewardAmount,
        alphaRewardAmount,
        betaRewardAmount,
      } = context;

      const orders = permutations(rewardTokens);
      await seedKeeperLiquidity(exchangeToken, keeper, rewardManager.target, depositAmount, orders.length);

      const deterministicRemainder = depositAmount % dustDivisor;
      const forwarded = depositAmount - deterministicRemainder;
      for (const order of orders) {
        await rewardManager.connect(keeper).compoundRewards(depositAmount, order, receiver.address);
        expect(await exchangeToken.balanceOf(rewardManager.target)).to.equal(deterministicRemainder);
      }

      const compounds = BigInt(orders.length);
      const orderingRemainderBonus = orders.length > 0 ? deterministicRemainder * BigInt(orders.length - 1) : 0n;
      expect(await exchangeToken.balanceOf(receiver.address)).to.equal(
        exchangeRewardAmount * compounds + orderingRemainderBonus,
      );
      expect(await alphaToken.balanceOf(receiver.address)).to.equal(alphaRewardAmount * compounds);
      expect(await betaToken.balanceOf(receiver.address)).to.equal(betaRewardAmount * compounds);
      expect(await exchangeToken.balanceOf(keeper.address)).to.equal(0n);
      expect(await exchangeToken.balanceOf(vault.address)).to.equal(forwarded * compounds);
    });
  });
});
