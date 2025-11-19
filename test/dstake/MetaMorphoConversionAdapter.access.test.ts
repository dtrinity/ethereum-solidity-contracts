import { loadFixture } from "@nomicfoundation/hardhat-network-helpers";
import { expect } from "chai";
import { SignerWithAddress } from "@nomicfoundation/hardhat-ethers/signers";
import { ethers } from "hardhat";

import type { MetaMorphoConversionAdapter } from "../../typechain-types/contracts/vaults/dstake/adapters/MetaMorphoConversionAdapter";
import type { MockMetaMorphoVault } from "../../typechain-types/contracts/testing/morpho/MockMetaMorphoVault";
import type { TestMintableERC20 } from "../../typechain-types/contracts/testing/token/TestMintableERC20";

const parseUnits = (value: string) => ethers.parseUnits(value, 18);

describe("MetaMorphoConversionAdapter – authorized caller gating", function () {
  async function deployAdapterFixture() {
    const [owner, collateralVault, router, stranger]: SignerWithAddress[] = await ethers.getSigners();

    const TokenFactory = await ethers.getContractFactory("TestMintableERC20");
    const dStable = (await TokenFactory.deploy("Mock dStable", "mdSTB", 18)) as TestMintableERC20;

    const VaultFactory = await ethers.getContractFactory("MockMetaMorphoVault");
    const metaMorphoVault = (await VaultFactory.deploy(await dStable.getAddress(), "Meta dStable", "mMeta")) as MockMetaMorphoVault;

    const AdapterFactory = await ethers.getContractFactory("MetaMorphoConversionAdapter");
    const adapter = (await AdapterFactory.deploy(
      await dStable.getAddress(),
      await metaMorphoVault.getAddress(),
      collateralVault.address,
      owner.address,
    )) as MetaMorphoConversionAdapter;

    return { owner, collateralVault, router, stranger, dStable, metaMorphoVault, adapter };
  }

  it("reverts deposits from callers that are not authorized", async function () {
    const { adapter, dStable, router } = await loadFixture(deployAdapterFixture);
    const amount = parseUnits("50");

    await dStable.mint(router.address, amount);
    await dStable.connect(router).approve(await adapter.getAddress(), amount);

    await expect(adapter.connect(router).depositIntoStrategy(amount))
      .to.be.revertedWithCustomError(adapter, "UnauthorizedCaller")
      .withArgs(router.address);
  });

  it("allows admins to authorize router flows for deposits and withdrawals", async function () {
    const { adapter, dStable, metaMorphoVault, owner, collateralVault, router } = await loadFixture(deployAdapterFixture);
    const amount = parseUnits("100");

    await adapter.connect(owner).setAuthorizedCaller(router.address, true);
    await dStable.mint(router.address, amount);
    await dStable.connect(router).approve(await adapter.getAddress(), amount);

    const beforeShares = await metaMorphoVault.balanceOf(collateralVault.address);
    await adapter.connect(router).depositIntoStrategy(amount);
    const mintedShares = (await metaMorphoVault.balanceOf(collateralVault.address)) - beforeShares;
    expect(mintedShares).to.be.gt(0);

    // Seed the vault with extra assets so redemptions can succeed
    await dStable.mint(await metaMorphoVault.getAddress(), parseUnits("1000"));

    await metaMorphoVault.connect(collateralVault).transfer(router.address, mintedShares);
    await metaMorphoVault.connect(router).approve(await adapter.getAddress(), mintedShares);
    const beforeBalance = await dStable.balanceOf(router.address);
    await adapter.connect(router).withdrawFromStrategy(mintedShares);
    expect(await dStable.balanceOf(router.address)).to.be.gt(beforeBalance);
  });

  it("revokes access when callers are removed from the allow list", async function () {
    const { adapter, dStable, owner, router } = await loadFixture(deployAdapterFixture);
    const amount = parseUnits("10");

    await adapter.connect(owner).setAuthorizedCaller(router.address, true);
    await dStable.mint(router.address, amount);
    await dStable.connect(router).approve(await adapter.getAddress(), amount);
    await adapter.connect(router).depositIntoStrategy(amount);

    await adapter.connect(owner).setAuthorizedCaller(router.address, false);
    await dStable.mint(router.address, amount);
    await dStable.connect(router).approve(await adapter.getAddress(), amount);
    await expect(adapter.connect(router).depositIntoStrategy(amount))
      .to.be.revertedWithCustomError(adapter, "UnauthorizedCaller")
      .withArgs(router.address);
  });
});
