import { SignerWithAddress } from "@nomicfoundation/hardhat-ethers/signers";
import { expect } from "chai";
import hre, { ethers } from "hardhat";

import { DlendFreezeGuardian } from "../../typechain-types";
import { dLendFixture, DLendFixtureResult } from "./fixtures";

describe("DlendFreezeGuardian", () => {
  let deployerSigner: SignerWithAddress;
  let freezeMultisigSigner: SignerWithAddress;
  let userSigner: SignerWithAddress;
  let fixture: DLendFixtureResult;
  let guardian: DlendFreezeGuardian;
  let collateralAsset: string;

  beforeEach(async () => {
    const { deployer, user1, user2 } = await hre.getNamedAccounts();
    deployerSigner = await ethers.getSigner(deployer);
    freezeMultisigSigner = await ethers.getSigner(user1);
    userSigner = await ethers.getSigner(user2);

    fixture = await dLendFixture();

    for (const [asset, reserveInfo] of Object.entries(fixture.assets)) {
      if (!reserveInfo.isDStable && reserveInfo.ltv > 0n) {
        collateralAsset = asset;
        break;
      }
    }

    if (!collateralAsset) {
      throw new Error("Expected at least one collateral reserve in the local fixture.");
    }

    const guardianFactory = await ethers.getContractFactory("DlendFreezeGuardian", deployerSigner);
    guardian = await guardianFactory.deploy(await fixture.contracts.poolAddressesProvider.getAddress(), freezeMultisigSigner.address);
    await guardian.waitForDeployment();

    const aclManager = await ethers.getContractAt(
      "ACLManager",
      await fixture.contracts.poolAddressesProvider.getACLManager(),
      deployerSigner,
    );
    await aclManager.addRiskAdmin(await guardian.getAddress());
  });

  it("allows the owner multisig to freeze a reserve", async () => {
    await expect(guardian.connect(freezeMultisigSigner).freezeReserve(collateralAsset))
      .to.emit(guardian, "ReserveFreezeRequested")
      .withArgs(collateralAsset, freezeMultisigSigner.address);

    const config = await fixture.contracts.dataProvider.getReserveConfigurationData(collateralAsset);
    expect(config.isFrozen).to.equal(true);
    expect(config.isPaused).to.equal(false);
  });

  it("allows the owner multisig to freeze reserves in batch", async () => {
    const assets = Object.entries(fixture.assets)
      .filter(([, reserveInfo]) => !reserveInfo.isDStable)
      .slice(0, 2)
      .map(([asset]) => asset);

    expect(assets.length).to.be.greaterThan(0);

    await guardian.connect(freezeMultisigSigner).freezeReserves(assets);

    for (const asset of assets) {
      const config = await fixture.contracts.dataProvider.getReserveConfigurationData(asset);
      expect(config.isFrozen).to.equal(true);
      expect(config.isPaused).to.equal(false);
    }
  });

  it("rejects non-owner freeze attempts", async () => {
    await expect(guardian.connect(userSigner).freezeReserve(collateralAsset))
      .to.be.revertedWithCustomError(guardian, "OwnableUnauthorizedAccount")
      .withArgs(userSigner.address);
  });

  it("has no pause execution surface and only needs risk admin permissions", async () => {
    const guardianAddress = await guardian.getAddress();
    const aclManager = await ethers.getContractAt(
      "ACLManager",
      await fixture.contracts.poolAddressesProvider.getACLManager(),
      deployerSigner,
    );

    expect(await aclManager.isRiskAdmin(guardianAddress)).to.equal(true);
    expect(await aclManager.isPoolAdmin(guardianAddress)).to.equal(false);
    expect(await aclManager.isEmergencyAdmin(guardianAddress)).to.equal(false);

    const pauseData = fixture.contracts.poolConfigurator.interface.encodeFunctionData("setReservePause", [collateralAsset, true]);
    await expect(freezeMultisigSigner.sendTransaction({ to: guardianAddress, data: pauseData })).to.be.revertedWithoutReason();

    const config = await fixture.contracts.dataProvider.getReserveConfigurationData(collateralAsset);
    expect(config.isPaused).to.equal(false);
  });

  it("rejects zero addresses", async () => {
    await expect(guardian.connect(freezeMultisigSigner).freezeReserve(ethers.ZeroAddress))
      .to.be.revertedWithCustomError(guardian, "ZeroAddress");
  });
});
