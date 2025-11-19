import { expect } from "chai";
import { ethers } from "hardhat";

import type { DStakeCollateralVaultV2, MockERC20 } from "../../typechain-types";

describe("DStakeCollateralVaultV2 rescueToken", () => {
  it("allows rescuing dStable balances", async () => {
    const [admin, receiver] = await ethers.getSigners();

    const MockERC20Factory = await ethers.getContractFactory("MockERC20");
    const dStable = (await MockERC20Factory.deploy("dStable", "dSTBL", ethers.parseEther("1000"))) as MockERC20;

    const VaultFactory = await ethers.getContractFactory("DStakeCollateralVaultV2");
    const vault = (await VaultFactory.deploy(admin.address, await dStable.getAddress())) as DStakeCollateralVaultV2;

    const rescueAmount = ethers.parseEther("100");
    await dStable.transfer(await vault.getAddress(), rescueAmount);

    await expect(vault.connect(admin).rescueToken(await dStable.getAddress(), receiver.address, rescueAmount))
      .to.emit(vault, "TokenRescued")
      .withArgs(await dStable.getAddress(), receiver.address, rescueAmount);

    expect(await dStable.balanceOf(receiver.address)).to.equal(rescueAmount);
  });
});
