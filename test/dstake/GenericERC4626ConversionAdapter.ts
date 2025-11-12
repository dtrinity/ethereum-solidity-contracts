import { expect } from "chai";
import { ethers } from "hardhat";

import type { GenericERC4626ConversionAdapter, MockERC20, MockERC4626Simple } from "../../typechain-types";

const INITIAL_SUPPLY = ethers.parseUnits("1000", 18);

describe("GenericERC4626ConversionAdapter", () => {
  async function deployAdapterFixture() {
    const [admin, user, receiver] = await ethers.getSigners();

    const MockERC20Factory = await ethers.getContractFactory("MockERC20");
    const dStable = (await MockERC20Factory.deploy("dStable", "dSTBL", INITIAL_SUPPLY)) as MockERC20;

    const MockVaultFactory = await ethers.getContractFactory("MockERC4626Simple");
    const vault = (await MockVaultFactory.deploy(await dStable.getAddress())) as MockERC4626Simple;

    const AdapterFactory = await ethers.getContractFactory("GenericERC4626ConversionAdapter");
    const adapter = (await AdapterFactory.deploy(
      await dStable.getAddress(),
      await vault.getAddress(),
      admin.address,
      admin.address,
    )) as GenericERC4626ConversionAdapter;

    return { admin, user, receiver, dStable, adapter };
  }

  describe("emergencyWithdraw", () => {
    it("only allows admins to pull ERC20 tokens", async () => {
      const { admin, user, receiver, dStable, adapter } = await deployAdapterFixture();
      const stuckAmount = ethers.parseUnits("10", 18);

      await dStable.transfer(await adapter.getAddress(), stuckAmount);

      await expect(
        adapter.connect(user).emergencyWithdraw(await dStable.getAddress(), receiver.address, stuckAmount),
      ).to.be.revertedWithCustomError(adapter, "AccessControlUnauthorizedAccount");

      await expect(adapter.connect(admin).emergencyWithdraw(await dStable.getAddress(), receiver.address, stuckAmount))
        .to.emit(adapter, "EmergencyWithdrawal")
        .withArgs(await dStable.getAddress(), receiver.address, stuckAmount);

      expect(await dStable.balanceOf(receiver.address)).to.equal(stuckAmount);
      expect(await dStable.balanceOf(await adapter.getAddress())).to.equal(0n);
    });

    it("pulls native ETH balances", async () => {
      const { admin, receiver, adapter } = await deployAdapterFixture();
      const stuckEth = ethers.parseEther("1");

      await admin.sendTransaction({ to: await adapter.getAddress(), value: stuckEth });
      const receiverBalanceBefore = await ethers.provider.getBalance(receiver.address);

      await adapter.connect(admin).emergencyWithdraw(ethers.ZeroAddress, receiver.address, stuckEth);

      const receiverBalanceAfter = await ethers.provider.getBalance(receiver.address);
      expect(receiverBalanceAfter - receiverBalanceBefore).to.equal(stuckEth);
    });
  });
});
