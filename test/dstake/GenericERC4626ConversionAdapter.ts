import { expect } from "chai";
import { ethers } from "hardhat";

import type { GenericERC4626ConversionAdapter, MockERC20, MockERC4626Simple } from "../../typechain-types";

const INITIAL_SUPPLY = ethers.parseUnits("1000000", 18);

describe("GenericERC4626ConversionAdapter access control", () => {
  async function deployFixture() {
    const [admin, router, caller, collateralVault] = await ethers.getSigners();

    const MockERC20Factory = await ethers.getContractFactory("MockERC20");
    const dStable = (await MockERC20Factory.deploy("dStable", "dSTBL", INITIAL_SUPPLY)) as MockERC20;

    const MockVaultFactory = await ethers.getContractFactory("MockERC4626Simple");
    const vault = (await MockVaultFactory.deploy(await dStable.getAddress())) as MockERC4626Simple;

    const AdapterFactory = await ethers.getContractFactory("GenericERC4626ConversionAdapter");
    const adapter = (await AdapterFactory.deploy(
      await dStable.getAddress(),
      await vault.getAddress(),
      collateralVault.address,
      router.address,
      admin.address,
    )) as GenericERC4626ConversionAdapter;

    const fundingAmount = ethers.parseUnits("1000", 18);
    await dStable.transfer(router.address, fundingAmount);

    return { admin, router, caller, dStable, adapter };
  }

  it("reverts when unauthorized caller tries to deposit or withdraw", async () => {
    const { adapter, caller } = await deployFixture();
    await expect(adapter.connect(caller).depositIntoStrategy(1)).to.be.revertedWithCustomError(adapter, "AccessControlUnauthorizedAccount");
    await expect(adapter.connect(caller).withdrawFromStrategy(1)).to.be.revertedWithCustomError(
      adapter,
      "AccessControlUnauthorizedAccount",
    );
  });

  it("allows router to convert assets", async () => {
    const { adapter, router, dStable } = await deployFixture();
    const amount = ethers.parseUnits("10", 18);
    await dStable.connect(router).approve(await adapter.getAddress(), amount);
    await expect(adapter.connect(router).depositIntoStrategy(amount)).to.not.be.reverted;
  });

  it("allows admin to authorize an additional caller", async () => {
    const { adapter, admin, caller, dStable } = await deployFixture();
    const amount = ethers.parseUnits("5", 18);
    await dStable.connect(admin).transfer(caller.address, amount);
    await dStable.connect(caller).approve(await adapter.getAddress(), amount);
    await expect(adapter.connect(admin).setAuthorizedCaller(caller.address, true))
      .to.emit(adapter, "AuthorizedCallerUpdated")
      .withArgs(caller.address, true);
    await expect(adapter.connect(caller).depositIntoStrategy(amount)).to.not.be.reverted;
  });
});
