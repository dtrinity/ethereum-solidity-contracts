import { SignerWithAddress } from "@nomicfoundation/hardhat-ethers/signers";
import { expect } from "chai";
import hre, { ethers } from "hardhat";

import { EmissionManager, RewardsController } from "../../typechain-types";
import { EMISSION_MANAGER_ID } from "../../typescript/deploy-ids";
import { dLendFixture, DLendFixtureResult } from "./fixtures";

describe("RewardsController blacklist", () => {
  let fixture: DLendFixtureResult;
  let rewardsController: RewardsController;
  let emissionManager: EmissionManager;
  let deployerSigner: SignerWithAddress;
  let user1Signer: SignerWithAddress;

  beforeEach(async () => {
    const { deployer, user1 } = await hre.getNamedAccounts();
    deployerSigner = await hre.ethers.getSigner(deployer);
    user1Signer = await hre.ethers.getSigner(user1);

    fixture = await dLendFixture();

    const incentivesId = ethers.keccak256(ethers.toUtf8Bytes("INCENTIVES_CONTROLLER"));
    const rewardsControllerAddress = await fixture.contracts.poolAddressesProvider.getAddressFromID(incentivesId);
    rewardsController = await ethers.getContractAt("RewardsController", rewardsControllerAddress);

    const emissionManagerDeployment = await hre.deployments.get(EMISSION_MANAGER_ID);
    emissionManager = await ethers.getContractAt("EmissionManager", emissionManagerDeployment.address);
  });

  it("allows the owner to blacklist and block reward claims", async () => {
    await expect(emissionManager.connect(deployerSigner).setUserBlacklist(user1Signer.address, true))
      .to.emit(rewardsController, "UserBlacklistUpdated")
      .withArgs(user1Signer.address, true);

    expect(await rewardsController.isUserBlacklisted(user1Signer.address)).to.equal(true);

    await expect(rewardsController.connect(user1Signer).claimRewards([], 1n, user1Signer.address, ethers.ZeroAddress)).to.be.revertedWith(
      "USER_BLACKLISTED",
    );

    await expect(rewardsController.connect(user1Signer).claimAllRewards([], user1Signer.address)).to.be.revertedWith("USER_BLACKLISTED");

    await expect(emissionManager.connect(deployerSigner).setUserBlacklist(user1Signer.address, false))
      .to.emit(rewardsController, "UserBlacklistUpdated")
      .withArgs(user1Signer.address, false);

    expect(await rewardsController.isUserBlacklisted(user1Signer.address)).to.equal(false);

    await expect(rewardsController.connect(user1Signer).claimRewards([], 0n, user1Signer.address, ethers.ZeroAddress)).to.not.be.reverted;
  });

  it("prevents non-owners from changing blacklist status", async () => {
    await expect(emissionManager.connect(user1Signer).setUserBlacklist(user1Signer.address, true)).to.be.revertedWith(
      "Ownable: caller is not the owner",
    );
  });
});
