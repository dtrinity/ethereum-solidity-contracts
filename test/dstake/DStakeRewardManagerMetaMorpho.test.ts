import { ethers } from "hardhat";
import { expect } from "chai";
import { SignerWithAddress } from "@nomicfoundation/hardhat-ethers/signers";
import {
  DStakeRewardManagerMetaMorpho,
  MockMetaMorphoVault,
  MockUniversalRewardsDistributor,
  TestMintableERC20,
  DStakeCollateralVaultV2,
  DStakeRouterV2,
  MetaMorphoConversionAdapter,
} from "../../typechain-types";

describe("DStakeRewardManagerMetaMorpho", function () {
  let owner: SignerWithAddress;
  let user: SignerWithAddress;
  let treasury: SignerWithAddress;
  let manager: SignerWithAddress;

  let dStable: TestMintableERC20;
  let rewardToken: TestMintableERC20;
  let rewardToken2: TestMintableERC20;
  let metaMorphoVault: MockMetaMorphoVault;
  let urd: MockUniversalRewardsDistributor;
  let collateralVault: DStakeCollateralVaultV2;
  let router: DStakeRouterV2;
  let adapter: MetaMorphoConversionAdapter;
  let rewardManager: DStakeRewardManagerMetaMorpho;
  let REWARDS_MANAGER_ROLE: string;

  // Note: This project uses a non-standard BPS representation where ONE_BPS = 100
  // So 100% = 1000000, 1% = 10000, 0.01% = 100
  const INITIAL_TREASURY_FEE_BPS = 50000; // 5% = 50000/1000000
  const MAX_TREASURY_FEE_BPS = 300000; // 30% = 300000/1000000
  const EXCHANGE_THRESHOLD = ethers.parseEther("10");

  beforeEach(async function () {
    [owner, user, treasury, manager] = await ethers.getSigners();

    // Deploy tokens
    const TokenFactory = await ethers.getContractFactory("TestMintableERC20");
    dStable = await TokenFactory.deploy("dStable", "dSTABLE", 18);
    rewardToken = await TokenFactory.deploy("Reward Token", "RWD", 18);
    rewardToken2 = await TokenFactory.deploy("Reward Token 2", "RWD2", 18);

    // Deploy mock MetaMorpho vault
    const VaultFactory = await ethers.getContractFactory("MockMetaMorphoVault");
    metaMorphoVault = await VaultFactory.deploy(dStable.target, "MetaMorpho dStable", "mmdSTABLE");

    // Deploy mock URD
    const URDFactory = await ethers.getContractFactory("MockUniversalRewardsDistributor");
    urd = await URDFactory.deploy();

    // Deploy dStake token first (needed for collateral vault)
    const DStakeTokenV2Factory = await ethers.getContractFactory("TestMintableERC20");
    const dStakeToken = await DStakeTokenV2Factory.deploy("dStake Token", "dSTAKE", 18);

    // Deploy collateral vault
    const CollateralVaultFactory = await ethers.getContractFactory("DStakeCollateralVaultV2");
    collateralVault = await CollateralVaultFactory.deploy(
      dStakeToken.target, // dStakeVaultShare
      dStable.target, // dStableAsset
    );

    // Deploy router
    const RouterFactory = await ethers.getContractFactory("DStakeRouterV2");
    router = await RouterFactory.deploy(dStakeToken.target, collateralVault.target);

    const GovernanceModuleFactory = await ethers.getContractFactory("DStakeRouterV2GovernanceModule");
    const governanceModule = await GovernanceModuleFactory.deploy(dStakeToken.target, collateralVault.target);
    const RebalanceModuleFactory = await ethers.getContractFactory("DStakeRouterV2RebalanceModule");
    const rebalanceModule = await RebalanceModuleFactory.deploy(dStakeToken.target, collateralVault.target);

    await router.setGovernanceModule(governanceModule.target);
    await router.setRebalanceModule(rebalanceModule.target);

    // Grant ROUTER_ROLE to the router
    const ROUTER_ROLE = await collateralVault.ROUTER_ROLE();
    await collateralVault.grantRole(ROUTER_ROLE, router.target);

    // Deploy adapter
    const AdapterFactory = await ethers.getContractFactory("MetaMorphoConversionAdapter");
    adapter = await AdapterFactory.deploy(dStable.target, metaMorphoVault.target, collateralVault.target, owner.address);

    // Configure router
    await router.addAdapter(metaMorphoVault.target, adapter.target);
    await router.setDefaultDepositStrategyShare(metaMorphoVault.target);

    // Deploy reward manager
    const RewardManagerFactory = await ethers.getContractFactory("DStakeRewardManagerMetaMorpho");
    rewardManager = await RewardManagerFactory.deploy(
      collateralVault.target,
      router.target,
      metaMorphoVault.target,
      urd.target,
      treasury.address,
      MAX_TREASURY_FEE_BPS,
      INITIAL_TREASURY_FEE_BPS,
      EXCHANGE_THRESHOLD,
    );

    // Grant manager role
    REWARDS_MANAGER_ROLE = await rewardManager.REWARDS_MANAGER_ROLE();
    await rewardManager.grantRole(REWARDS_MANAGER_ROLE, manager.address);

    // Allow the reward manager to interact with the adapter just like the deploy flow does.
    await adapter.connect(owner).setAuthorizedCaller(rewardManager.target, true);

    // Setup: Mint tokens and set up initial state
    await dStable.mint(user.address, ethers.parseEther("10000"));
    await dStable.mint(owner.address, ethers.parseEther("10000"));
    await rewardToken.mint(urd.target, ethers.parseEther("1000"));
    await rewardToken2.mint(urd.target, ethers.parseEther("1000"));
  });

  describe("Deployment", function () {
    it("should deploy with correct parameters", async function () {
      expect(await rewardManager.dStakeCollateralVault()).to.equal(collateralVault.target);
      expect(await rewardManager.dStakeRouter()).to.equal(router.target);
      expect(await rewardManager.metaMorphoVault()).to.equal(metaMorphoVault.target);
      expect(await rewardManager.urd()).to.equal(urd.target);
      expect(await rewardManager.treasury()).to.equal(treasury.address);
      expect(await rewardManager.treasuryFeeBps()).to.equal(INITIAL_TREASURY_FEE_BPS);
      expect(await rewardManager.exchangeThreshold()).to.equal(EXCHANGE_THRESHOLD);
      expect(await rewardManager.exchangeAsset()).to.equal(dStable.target);
    });

    it("should handle deployment with zero URD address", async function () {
      const RewardManagerFactory = await ethers.getContractFactory("DStakeRewardManagerMetaMorpho");
      const rewardManager2 = await RewardManagerFactory.deploy(
        collateralVault.target,
        router.target,
        metaMorphoVault.target,
        ethers.ZeroAddress, // No URD initially
        treasury.address,
        MAX_TREASURY_FEE_BPS,
        INITIAL_TREASURY_FEE_BPS,
        EXCHANGE_THRESHOLD,
      );

      expect(await rewardManager2.urd()).to.equal(ethers.ZeroAddress);
      expect(await rewardManager2.isURDConfigured()).to.be.false;
    });

    it("should revert with zero addresses", async function () {
      const RewardManagerFactory = await ethers.getContractFactory("DStakeRewardManagerMetaMorpho");

      // This should revert with ZeroAddress from the constructor
      await expect(
        RewardManagerFactory.deploy(
          ethers.ZeroAddress,
          router.target,
          metaMorphoVault.target,
          urd.target,
          treasury.address,
          MAX_TREASURY_FEE_BPS,
          INITIAL_TREASURY_FEE_BPS,
          EXCHANGE_THRESHOLD,
        ),
      ).to.be.reverted; // Just check it reverts, the exact error might be from parent constructor
    });
  });

  describe("Admin Functions", function () {
    it("should allow admin to update URD", async function () {
      const newURD = await (await ethers.getContractFactory("MockUniversalRewardsDistributor")).deploy();

      await expect(rewardManager.setURD(newURD.target)).to.emit(rewardManager, "URDUpdated").withArgs(urd.target, newURD.target);

      expect(await rewardManager.urd()).to.equal(newURD.target);
      expect(await rewardManager.isURDConfigured()).to.be.true;
    });

    it("should allow admin to disable URD", async function () {
      await expect(rewardManager.setURD(ethers.ZeroAddress)).to.emit(rewardManager, "URDUpdated").withArgs(urd.target, ethers.ZeroAddress);

      expect(await rewardManager.urd()).to.equal(ethers.ZeroAddress);
      expect(await rewardManager.isURDConfigured()).to.be.false;
    });

    it("should only allow admin to update URD", async function () {
      await expect(rewardManager.connect(user).setURD(ethers.ZeroAddress)).to.be.revertedWithCustomError(
        rewardManager,
        "AccessControlUnauthorizedAccount",
      );
    });

    it("should validate URD interface when setting", async function () {
      // Try to set an invalid contract (use a token contract which doesn't have root() function)
      await expect(rewardManager.setURD(dStable.target)).to.be.revertedWithCustomError(rewardManager, "InvalidURD");
    });

    it("should allow admin to set as skim recipient", async function () {
      // First set the reward manager as owner of vault (for testing)
      await metaMorphoVault.transferOwnership(rewardManager.target);

      await rewardManager.becomeSkimRecipient();

      expect(await metaMorphoVault.skimRecipient()).to.equal(rewardManager.target);
    });
  });

  describe("Reward Skimming", function () {
    beforeEach(async function () {
      // Setup: Set URD as skim recipient and add rewards to vault
      await metaMorphoVault.setSkimRecipient(urd.target);
      await rewardToken.mint(metaMorphoVault.target, ethers.parseEther("100"));
      await rewardToken2.mint(metaMorphoVault.target, ethers.parseEther("50"));
    });

    it("should skim single reward token", async function () {
      const balanceBefore = await rewardToken.balanceOf(urd.target);

      // Now requires REWARDS_MANAGER_ROLE
      await expect(rewardManager.connect(manager).skimRewards([rewardToken.target]))
        .to.emit(rewardManager, "RewardsSkimmed")
        .withArgs(rewardToken.target, ethers.parseEther("100"));

      const balanceAfter = await rewardToken.balanceOf(urd.target);
      expect(balanceAfter - balanceBefore).to.equal(ethers.parseEther("100"));
    });

    it("should skim multiple reward tokens", async function () {
      // Now requires REWARDS_MANAGER_ROLE
      await expect(rewardManager.connect(manager).skimRewards([rewardToken.target, rewardToken2.target]))
        .to.emit(rewardManager, "RewardsSkimmed")
        .withArgs(rewardToken.target, ethers.parseEther("100"))
        .and.to.emit(rewardManager, "RewardsSkimmed")
        .withArgs(rewardToken2.target, ethers.parseEther("50"));

      expect(await rewardToken.balanceOf(urd.target)).to.be.gt(0);
      expect(await rewardToken2.balanceOf(urd.target)).to.be.gt(0);
    });

    it("should handle skimming with no rewards", async function () {
      // Skim first to clear rewards
      await rewardManager.connect(manager).skimRewards([rewardToken.target]);

      // Skim again - should not emit event
      const tx = await rewardManager.connect(manager).skimRewards([rewardToken.target]);
      const receipt = await tx.wait();
      const events = receipt?.logs.filter((log) => log.topics[0] === ethers.id("RewardsSkimmed(address,uint256)"));
      expect(events).to.have.lengthOf(0);
    });

    it("should only allow manager to skim rewards", async function () {
      // User should not be able to skim
      await expect(rewardManager.connect(user).skimRewards([rewardToken.target])).to.be.revertedWithCustomError(
        rewardManager,
        "AccessControlUnauthorizedAccount",
      );
    });
  });

  describe("URD Reward Claiming", function () {
    beforeEach(async function () {
      // Setup pending rewards in URD - now rewards go to the reward manager contract
      await urd.setPendingReward(rewardManager.target, rewardToken.target, ethers.parseEther("100"));
      await urd.setPendingReward(rewardManager.target, rewardToken2.target, ethers.parseEther("50"));

      // Fund URD
      await rewardToken.mint(urd.target, ethers.parseEther("100"));
      await rewardToken2.mint(urd.target, ethers.parseEther("50"));
    });

    it("should claim rewards from URD", async function () {
      const claimData = [
        {
          rewardToken: rewardToken.target,
          claimableAmount: ethers.parseEther("100"),
          proof: [ethers.keccak256(ethers.toUtf8Bytes("proof1"))],
        },
      ];

      await expect(rewardManager.connect(manager).claimRewardsFromURD(claimData))
        .to.emit(rewardManager, "RewardsClaimed")
        .withArgs(rewardToken.target, ethers.parseEther("100"));

      expect(await rewardToken.balanceOf(rewardManager.target)).to.equal(ethers.parseEther("100"));
    });

    it("should claim multiple rewards from URD", async function () {
      const claimData = [
        {
          rewardToken: rewardToken.target,
          claimableAmount: ethers.parseEther("100"),
          proof: [ethers.keccak256(ethers.toUtf8Bytes("proof1"))],
        },
        {
          rewardToken: rewardToken2.target,
          claimableAmount: ethers.parseEther("50"),
          proof: [ethers.keccak256(ethers.toUtf8Bytes("proof2"))],
        },
      ];

      await rewardManager.connect(manager).claimRewardsFromURD(claimData);

      expect(await rewardToken.balanceOf(rewardManager.target)).to.equal(ethers.parseEther("100"));
      expect(await rewardToken2.balanceOf(rewardManager.target)).to.equal(ethers.parseEther("50"));
    });

    it("should revert if URD not configured", async function () {
      await rewardManager.setURD(ethers.ZeroAddress);

      const claimData = [
        {
          rewardToken: rewardToken.target,
          claimableAmount: ethers.parseEther("100"),
          proof: [],
        },
      ];

      await expect(rewardManager.connect(manager).claimRewardsFromURD(claimData)).to.be.revertedWithCustomError(
        rewardManager,
        "InvalidURD",
      );
    });

    it("should only allow manager to claim from URD", async function () {
      const claimData = [
        {
          rewardToken: rewardToken.target,
          claimableAmount: ethers.parseEther("100"),
          proof: [],
        },
      ];

      await expect(rewardManager.connect(user).claimRewardsFromURD(claimData)).to.be.revertedWithCustomError(
        rewardManager,
        "AccessControlUnauthorizedAccount",
      );
    });

    it("should handle claim failure gracefully", async function () {
      // Don't set pending rewards but try to claim
      // This will make the URD claim fail
      const claimData = [
        {
          rewardToken: rewardToken.target,
          claimableAmount: ethers.parseEther("100"),
          proof: [],
        },
      ];

      // Remove pending rewards to cause failure
      await urd.setPendingReward(rewardManager.target, rewardToken.target, 0);

      // This should revert because URD has no pending rewards for this contract
      await expect(rewardManager.connect(manager).claimRewardsFromURD(claimData)).to.be.revertedWithCustomError(
        rewardManager,
        "ClaimFailed",
      );
    });

    it("should verify rewards are received by the reward manager contract", async function () {
      // This test demonstrates the fix for the Merkle proof bypass vulnerability
      // Previously, claiming for collateralVault would send rewards to collateralVault
      // Now, claiming sends rewards to the reward manager for proper processing

      const claimAmount = ethers.parseEther("100");

      // Setup pending rewards for the reward manager contract (not collateral vault)
      await urd.setPendingReward(rewardManager.target, rewardToken.target, claimAmount);
      await rewardToken.mint(urd.target, claimAmount);

      const claimData = [
        {
          rewardToken: rewardToken.target,
          claimableAmount: claimAmount,
          proof: [],
        },
      ];

      // Verify initial balances
      const rewardManagerBalanceBefore = await rewardToken.balanceOf(rewardManager.target);
      const collateralVaultBalanceBefore = await rewardToken.balanceOf(collateralVault.target);

      // Claim rewards
      await expect(rewardManager.connect(manager).claimRewardsFromURD(claimData))
        .to.emit(rewardManager, "RewardsClaimed")
        .withArgs(rewardToken.target, claimAmount);

      // Verify rewards went to the reward manager contract (not collateral vault)
      const rewardManagerBalanceAfter = await rewardToken.balanceOf(rewardManager.target);
      const collateralVaultBalanceAfter = await rewardToken.balanceOf(collateralVault.target);

      expect(rewardManagerBalanceAfter - rewardManagerBalanceBefore).to.equal(claimAmount);
      expect(collateralVaultBalanceAfter - collateralVaultBalanceBefore).to.equal(0);
    });
  });

  describe("Reward Compounding", function () {
    beforeEach(async function () {
      // Setup: Claim rewards from URD first
      await urd.setPendingReward(rewardManager.target, rewardToken.target, ethers.parseEther("100"));
      await rewardToken.mint(urd.target, ethers.parseEther("100"));

      const claimData = [
        {
          rewardToken: rewardToken.target,
          claimableAmount: ethers.parseEther("100"),
          proof: [],
        },
      ];

      await rewardManager.connect(manager).claimRewardsFromURD(claimData);

      // Setup vault for deposits
      await dStable.connect(user).approve(metaMorphoVault.target, ethers.MaxUint256);
      await metaMorphoVault.connect(user).deposit(ethers.parseEther("1000"), user.address);

      await rewardManager.grantRole(REWARDS_MANAGER_ROLE, user.address);
    });

    it("should revert when caller lacks rewards manager role", async function () {
      await rewardManager.connect(owner).revokeRole(REWARDS_MANAGER_ROLE, user.address);
      const compoundAmount = ethers.parseEther("50");

      await expect(
        rewardManager.connect(user).compoundRewards(compoundAmount, [rewardToken.target], user.address),
      ).to.be.revertedWithCustomError(rewardManager, "AccessControlUnauthorizedAccount");
    });

    it("should compound rewards with claimed tokens", async function () {
      const compoundAmount = ethers.parseEther("50");

      // User provides dStable for compounding
      await dStable.connect(user).approve(rewardManager.target, compoundAmount);

      const treasuryBalanceBefore = await rewardToken.balanceOf(treasury.address);
      const userBalanceBefore = await rewardToken.balanceOf(user.address);

      await expect(rewardManager.connect(user).compoundRewards(compoundAmount, [rewardToken.target], user.address))
        .to.emit(rewardManager, "RewardCompounded")
        .withArgs(dStable.target, compoundAmount, [rewardToken.target]);

      // Check treasury fee (5% of the actual claimed amount)
      // We only have 100 tokens in the reward manager, even if we request more
      const actualClaimed = ethers.parseEther("100");
      // 500 BPS = 5%, so 5% of 100 = 5
      const expectedFee = (actualClaimed * BigInt(500)) / BigInt(10000);
      const treasuryBalanceAfter = await rewardToken.balanceOf(treasury.address);
      expect(treasuryBalanceAfter - treasuryBalanceBefore).to.equal(expectedFee);

      // Check user received remainder (100 - expectedFee)
      const userBalanceAfter = await rewardToken.balanceOf(user.address);
      expect(userBalanceAfter - userBalanceBefore).to.equal(actualClaimed - expectedFee);

      // Check vault received dStable (via adapter)
      expect(await metaMorphoVault.balanceOf(collateralVault.target)).to.be.gt(0);
    });

    it("should handle multiple reward tokens", async function () {
      // Setup second reward
      await urd.setPendingReward(rewardManager.target, rewardToken2.target, ethers.parseEther("50"));
      await rewardToken2.mint(urd.target, ethers.parseEther("50"));

      const claimData = [
        {
          rewardToken: rewardToken2.target,
          claimableAmount: ethers.parseEther("50"),
          proof: [],
        },
      ];

      await rewardManager.connect(manager).claimRewardsFromURD(claimData);

      // Compound both rewards
      const compoundAmount = ethers.parseEther("50");
      await dStable.connect(user).approve(rewardManager.target, compoundAmount);

      await rewardManager.connect(user).compoundRewards(compoundAmount, [rewardToken.target, rewardToken2.target], user.address);

      // Check both rewards distributed
      expect(await rewardToken.balanceOf(treasury.address)).to.equal(ethers.parseEther("5")); // 5% of 100
      expect(await rewardToken2.balanceOf(treasury.address)).to.equal(ethers.parseEther("2.5")); // 5% of 50
      expect(await rewardToken.balanceOf(user.address)).to.equal(ethers.parseEther("95"));
      expect(await rewardToken2.balanceOf(user.address)).to.equal(ethers.parseEther("47.5"));
    });

    it("should handle dStable rewards without consuming the compounding float", async function () {
      const rewardAmount = ethers.parseEther("100");

      // Fund URD with dStable and stage a claim for the reward manager
      await dStable.mint(urd.target, rewardAmount);
      await urd.setPendingReward(rewardManager.target, dStable.target, rewardAmount);

      const claimData = [
        {
          rewardToken: dStable.target,
          claimableAmount: rewardAmount,
          proof: [],
        },
      ];
      await rewardManager.connect(manager).claimRewardsFromURD(claimData);

      const compoundAmount = ethers.parseEther("50");
      await dStable.connect(user).approve(rewardManager.target, compoundAmount);

      const treasuryBalanceBefore = await dStable.balanceOf(treasury.address);
      const userBalanceBefore = await dStable.balanceOf(user.address);
      const vaultSharesBefore = await metaMorphoVault.balanceOf(collateralVault.target);

      await rewardManager.connect(user).compoundRewards(compoundAmount, [dStable.target], user.address);

      const fee = (rewardAmount * BigInt(INITIAL_TREASURY_FEE_BPS)) / 1_000_000n;
      const netReward = rewardAmount - fee;

      expect((await dStable.balanceOf(treasury.address)) - treasuryBalanceBefore).to.equal(fee);
      expect(await dStable.balanceOf(user.address)).to.equal(userBalanceBefore - compoundAmount + netReward);

      const vaultSharesAfter = await metaMorphoVault.balanceOf(collateralVault.target);
      expect(vaultSharesAfter).to.be.gt(vaultSharesBefore);
    });

    it("should revert if compound amount below threshold", async function () {
      await dStable.connect(user).approve(rewardManager.target, ethers.parseEther("5"));

      await expect(
        rewardManager.connect(user).compoundRewards(
          ethers.parseEther("5"), // Below threshold of 10
          [rewardToken.target],
          user.address,
        ),
      ).to.be.revertedWithCustomError(rewardManager, "ExchangeAmountTooLow");
    });

    it("should cap claimed amounts to available balance", async function () {
      const compoundAmount = ethers.parseEther("50");
      await dStable.connect(user).approve(rewardManager.target, compoundAmount);

      // Try to claim more than available (200 when only 100 available)
      await rewardManager.connect(user).compoundRewards(compoundAmount, [rewardToken.target], user.address);

      // Should only distribute what was available (100)
      const fee = (ethers.parseEther("100") * BigInt(INITIAL_TREASURY_FEE_BPS)) / BigInt(1000000);
      expect(await rewardToken.balanceOf(treasury.address)).to.equal(fee);
      expect(await rewardToken.balanceOf(user.address)).to.equal(ethers.parseEther("100") - fee);
    });
  });

  describe("Exchange Asset Processing", function () {
    beforeEach(async function () {
      // Setup vault
      await dStable.connect(user).approve(metaMorphoVault.target, ethers.MaxUint256);
      await metaMorphoVault.connect(user).deposit(ethers.parseEther("1000"), user.address);

      // Add some rewards to claim
      await rewardToken.mint(rewardManager.target, ethers.parseEther("100"));

      await rewardManager.grantRole(REWARDS_MANAGER_ROLE, user.address);
    });

    it("should process exchange asset through adapter", async function () {
      const compoundAmount = ethers.parseEther("50");
      await dStable.connect(user).approve(rewardManager.target, compoundAmount);

      const vaultSharesBefore = await metaMorphoVault.balanceOf(collateralVault.target);

      await rewardManager.connect(user).compoundRewards(compoundAmount, [rewardToken.target], user.address);

      const vaultSharesAfter = await metaMorphoVault.balanceOf(collateralVault.target);
      expect(vaultSharesAfter).to.be.gt(vaultSharesBefore);

      // Verify event
      const filter = rewardManager.filters.ExchangeAssetProcessed();
      const events = await rewardManager.queryFilter(filter);
      expect(events).to.have.lengthOf(1);
      expect(events[0].args.strategyShare).to.equal(metaMorphoVault.target);
      expect(events[0].args.dStableCompoundedAmount).to.equal(compoundAmount);
    });

    it("should handle adapter errors gracefully", async function () {
      // Remove the adapter to simulate an error
      try {
        await router.suspendVaultForRemoval(metaMorphoVault.target);
      } catch (error: unknown) {
        const message = (error as Error).message ?? "";
        if (!message.includes("VaultNotFound")) {
          throw error;
        }
      }
      await router.removeAdapter(metaMorphoVault.target);

      const compoundAmount = ethers.parseEther("50");
      await dStable.connect(user).approve(rewardManager.target, compoundAmount);

      await expect(
        rewardManager.connect(user).compoundRewards(compoundAmount, [rewardToken.target], user.address),
      ).to.be.revertedWithCustomError(rewardManager, "DefaultDepositAssetNotSet");
    });

    it("should clear approvals after processing", async function () {
      const compoundAmount = ethers.parseEther("50");
      await dStable.connect(user).approve(rewardManager.target, compoundAmount);

      await rewardManager.connect(user).compoundRewards(compoundAmount, [rewardToken.target], user.address);

      // Check approval was cleared
      const allowance = await dStable.allowance(rewardManager.target, adapter.target);
      expect(allowance).to.equal(0);
    });
  });

  describe("Emergency Functions", function () {
    beforeEach(async function () {
      await rewardToken.mint(rewardManager.target, ethers.parseEther("100"));
      await dStable.mint(rewardManager.target, ethers.parseEther("50"));
    });

    it("should allow admin to withdraw stuck tokens", async function () {
      const treasuryBalanceBefore = await rewardToken.balanceOf(treasury.address);

      await expect(rewardManager.emergencyWithdraw(rewardToken.target, ethers.parseEther("100")))
        .to.emit(rewardManager, "EmergencyWithdraw")
        .withArgs(rewardToken.target, ethers.parseEther("100"), treasury.address);

      const treasuryBalanceAfter = await rewardToken.balanceOf(treasury.address);
      expect(treasuryBalanceAfter - treasuryBalanceBefore).to.equal(ethers.parseEther("100"));
      expect(await rewardToken.balanceOf(rewardManager.target)).to.equal(0);
    });

    it("should only allow admin to emergency withdraw", async function () {
      await expect(
        rewardManager.connect(user).emergencyWithdraw(rewardToken.target, ethers.parseEther("100")),
      ).to.be.revertedWithCustomError(rewardManager, "AccessControlUnauthorizedAccount");
    });
  });

  describe("View Functions", function () {
    it("should return URD configuration status", async function () {
      expect(await rewardManager.isURDConfigured()).to.be.true;

      await rewardManager.setURD(ethers.ZeroAddress);
      expect(await rewardManager.isURDConfigured()).to.be.false;
    });

    it("should return current skim recipient", async function () {
      await metaMorphoVault.setSkimRecipient(urd.target);
      expect(await rewardManager.currentSkimRecipient()).to.equal(urd.target);

      await metaMorphoVault.setSkimRecipient(rewardManager.target);
      expect(await rewardManager.currentSkimRecipient()).to.equal(rewardManager.target);
    });

    it("should return claimed amounts from URD", async function () {
      // Setup and claim
      await urd.setPendingReward(rewardManager.target, rewardToken.target, ethers.parseEther("100"));
      await rewardToken.mint(urd.target, ethers.parseEther("100"));

      const claimData = [
        {
          rewardToken: rewardToken.target,
          claimableAmount: ethers.parseEther("50"),
          proof: [],
        },
      ];

      await rewardManager.connect(manager).claimRewardsFromURD(claimData);

      const claimed = await rewardManager.getClaimedAmount(rewardToken.target);
      expect(claimed).to.equal(ethers.parseEther("50"));
    });

    it("should return zero claimed amount if URD not set", async function () {
      await rewardManager.setURD(ethers.ZeroAddress);
      const claimed = await rewardManager.getClaimedAmount(rewardToken.target);
      expect(claimed).to.equal(0);
    });
  });

  describe("Integration with RewardClaimable", function () {
    it("should properly inherit treasury management", async function () {
      const newTreasury = ethers.Wallet.createRandom().address;

      await expect(rewardManager.connect(manager).setTreasury(newTreasury))
        .to.emit(rewardManager, "TreasuryUpdated")
        .withArgs(treasury.address, newTreasury);

      expect(await rewardManager.treasury()).to.equal(newTreasury);
    });

    it("should properly inherit fee management", async function () {
      const newFeeBps = 100000; // 10% in this project's BPS system (100000/1000000)

      await expect(rewardManager.connect(manager).setTreasuryFeeBps(newFeeBps))
        .to.emit(rewardManager, "TreasuryFeeBpsUpdated")
        .withArgs(INITIAL_TREASURY_FEE_BPS, newFeeBps);

      expect(await rewardManager.treasuryFeeBps()).to.equal(newFeeBps);

      // 100000/1000000 = 10%, so 10% of 100 = 10
      const expectedFee = (ethers.parseEther("100") * BigInt(newFeeBps)) / BigInt(1000000);
      expect(await rewardManager.getTreasuryFee(ethers.parseEther("100"))).to.equal(expectedFee);
    });

    it("should properly inherit threshold management", async function () {
      const newThreshold = ethers.parseEther("100");

      await expect(rewardManager.connect(manager).setExchangeThreshold(newThreshold))
        .to.emit(rewardManager, "ExchangeThresholdUpdated")
        .withArgs(EXCHANGE_THRESHOLD, newThreshold);

      expect(await rewardManager.exchangeThreshold()).to.equal(newThreshold);
    });
  });

  describe("Edge Cases", function () {
    beforeEach(async function () {
      await rewardManager.grantRole(REWARDS_MANAGER_ROLE, user.address);
    });

    it("should handle zero reward amounts", async function () {
      // No rewards available
      const compoundAmount = ethers.parseEther("50");
      await dStable.connect(user).approve(rewardManager.target, compoundAmount);

      await rewardManager.connect(user).compoundRewards(compoundAmount, [rewardToken.target], user.address);

      // Should not revert, just distribute 0 rewards
      expect(await rewardToken.balanceOf(treasury.address)).to.equal(0);
      expect(await rewardToken.balanceOf(user.address)).to.equal(0);
    });
  });
});
