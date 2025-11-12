import { expect } from "chai";
import { ethers } from "hardhat";

import type { GenericERC4626ConversionAdapter, MockERC20, MockERC4626Simple } from "../../typechain-types";

describe("GenericERC4626ConversionAdapter allowance hygiene", () => {
  it("resets vault allowance after deposits", async () => {
    const [admin, router, collateralVault] = await ethers.getSigners();

    const MockERC20Factory = await ethers.getContractFactory("MockERC20");
    const dStable = (await MockERC20Factory.deploy("dStable", "dSTBL", ethers.parseEther("1000"))) as MockERC20;

    const MockVaultFactory = await ethers.getContractFactory("MockERC4626Simple");
    const vault = (await MockVaultFactory.deploy(await dStable.getAddress())) as MockERC4626Simple;

    const AdapterFactory = await ethers.getContractFactory("GenericERC4626ConversionAdapter");
    const adapter = (await AdapterFactory.deploy(
      await dStable.getAddress(),
      await vault.getAddress(),
      collateralVault.address,
    )) as GenericERC4626ConversionAdapter;

    const depositAmount = ethers.parseEther("10");
    await dStable.transfer(router.address, depositAmount);
    await dStable.connect(router).approve(await adapter.getAddress(), depositAmount);

    await adapter.connect(router).depositIntoStrategy(depositAmount);

    const remainingAllowance = await dStable.allowance(await adapter.getAddress(), await vault.getAddress());
    expect(remainingAllowance).to.equal(0n);
  });
});
