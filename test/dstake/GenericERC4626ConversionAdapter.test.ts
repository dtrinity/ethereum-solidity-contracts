import { loadFixture } from "@nomicfoundation/hardhat-network-helpers";
import { expect } from "chai";
import { SignerWithAddress } from "@nomicfoundation/hardhat-ethers/signers";
import { ethers } from "hardhat";

import type { GenericERC4626ConversionAdapter } from "../../typechain-types/contracts/vaults/dstake/adapters/GenericERC4626ConversionAdapter";
import type { MockERC20 } from "../../typechain-types/contracts/testing/token/MockERC20";
import type { MockERC4626Simple } from "../../typechain-types/contracts/testing/dstake/MockERC4626Simple";

const parseUnits = (value: string) => ethers.parseUnits(value, 18);

describe("GenericERC4626ConversionAdapter – emergency withdraw", function () {
  async function deployAdapterFixture() {
    const [deployer, collateralVault, stranger]: SignerWithAddress[] = await ethers.getSigners();

    const tokenFactory = await ethers.getContractFactory("MockERC20");
    const dStable = (await tokenFactory.deploy("Mock dStable", "mdSTB", parseUnits("1000000"))) as MockERC20;

    const vaultFactory = await ethers.getContractFactory("MockERC4626Simple");
    const vault = (await vaultFactory.deploy(await dStable.getAddress())) as MockERC4626Simple;

    const adapterFactory = await ethers.getContractFactory("GenericERC4626ConversionAdapter");
    const adapter = (await adapterFactory.deploy(
      await dStable.getAddress(),
      await vault.getAddress(),
      collateralVault.address,
    )) as GenericERC4626ConversionAdapter;

    return { adapter, dStable, vault, deployer, collateralVault, stranger };
  }

  it("sweeps stranded dStable to the collateral vault", async function () {
    const { adapter, dStable, deployer, collateralVault } = await loadFixture(deployAdapterFixture);
    const amount = parseUnits("250");

    await dStable.connect(deployer).transfer(await adapter.getAddress(), amount);
    const before = await dStable.balanceOf(collateralVault.address);

    await expect(adapter.connect(deployer).emergencyWithdraw(await dStable.getAddress(), amount))
      .to.emit(adapter, "EmergencyWithdraw")
      .withArgs(await dStable.getAddress(), amount, collateralVault.address);

    expect(await dStable.balanceOf(collateralVault.address)).to.equal(before + amount);
    expect(await dStable.balanceOf(await adapter.getAddress())).to.equal(0);
  });

  it("sweeps stranded ERC4626 shares without touching adapter accounting", async function () {
    const { adapter, dStable, vault, deployer, collateralVault } = await loadFixture(deployAdapterFixture);
    const depositAmount = parseUnits("100");

    await dStable.connect(deployer).approve(await vault.getAddress(), depositAmount);
    await vault.connect(deployer).deposit(depositAmount, deployer.address);
    const mintedShares = await vault.balanceOf(deployer.address);
    await vault.connect(deployer).transfer(await adapter.getAddress(), mintedShares);

    const beforeShares = await vault.balanceOf(collateralVault.address);
    await adapter.connect(deployer).emergencyWithdraw(await vault.getAddress(), mintedShares);

    expect(await vault.balanceOf(collateralVault.address)).to.equal(beforeShares + mintedShares);
    expect(await vault.balanceOf(await adapter.getAddress())).to.equal(0);
  });

  it("reverts when a caller without admin role attempts an emergency sweep", async function () {
    const { adapter, stranger } = await loadFixture(deployAdapterFixture);

    await expect(
      adapter.connect(stranger).emergencyWithdraw(await adapter.dStable(), 1),
    ).to.be.revertedWithCustomError(adapter, "AccessControlUnauthorizedAccount");
  });
});
