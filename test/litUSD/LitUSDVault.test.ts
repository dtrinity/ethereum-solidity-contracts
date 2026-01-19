import { expect } from "chai";
import { ethers } from "hardhat";

const FEED_DECIMALS = 8n;
const LIT_DECIMALS = 18n;
const FEED_UNIT = 10n ** FEED_DECIMALS;
const LIT_UNIT = 10n ** LIT_DECIMALS;
const usd = (amount: bigint) => amount * FEED_UNIT;
const lit = (amount: bigint) => amount * LIT_UNIT;

describe("LitUSDVault", function () {
  async function deployFixture() {
    const [admin, other] = await ethers.getSigners();

    const LitToken = await ethers.getContractFactory("TestERC20");
    const litUSD = await LitToken.deploy("LitUSD", "LIT", 18);

    const Feed = await ethers.getContractFactory("MockChainlinkAggregatorV3");
    const feed = await Feed.deploy(Number(FEED_DECIMALS), "bankUSD");

    const Vault = await ethers.getContractFactory("LitUSDVault");
    const vault = await Vault.deploy(await litUSD.getAddress(), await feed.getAddress(), admin.address, admin.address);

    return { admin, other, litUSD, feed, vault };
  }

  it("computes total reserve in NORMAL state", async function () {
    const { admin, litUSD, feed, vault } = await deployFixture();

    await feed.setMock(usd(1000n));
    await litUSD.connect(admin).transfer(await vault.getAddress(), lit(500n));

    const total = await vault.totalReserve();
    expect(total).to.equal(lit(1500n));
  });

  it("tracks pending withdrawal with frozen PoR snapshot", async function () {
    const { admin, litUSD, feed, vault } = await deployFixture();

    await feed.setMock(usd(1000n));
    await litUSD.connect(admin).transfer(await vault.getAddress(), lit(500n));

    await vault.connect(admin).adminWithdrawUnderlying(admin.address, lit(200n));

    expect(await vault.reserveState()).to.equal(1n);
    expect(await vault.pendingWithdrawnLitUSD()).to.equal(lit(200n));
    expect(await vault.frozenBankUSD()).to.equal(lit(1000n));

    const total = await vault.totalReserve();
    expect(total).to.equal(lit(1500n));

    await expect(vault.connect(admin).adminWithdrawUnderlying(admin.address, lit(1n))).to.be.revertedWithCustomError(
      vault,
      "PendingRedemption",
    );
  });

  it("completes pending redemption when PoR increase clears slippage threshold", async function () {
    const { admin, litUSD, feed, vault } = await deployFixture();

    await feed.setMock(usd(1000n));
    await litUSD.connect(admin).transfer(await vault.getAddress(), lit(500n));
    await vault.connect(admin).adminWithdrawUnderlying(admin.address, lit(200n));

    await feed.setMock(usd(1199n)); // +199 (>= 0.5% slippage)
    await vault.connect(admin).setSlippageBps(50);

    expect(await vault.reserveState()).to.equal(0n);
    expect(await vault.pendingWithdrawnLitUSD()).to.equal(0n);
    expect(await vault.frozenBankUSD()).to.equal(0n);
  });

  it("does not complete when PoR increase is below slippage threshold", async function () {
    const { admin, litUSD, feed, vault } = await deployFixture();

    await feed.setMock(usd(1000n));
    await litUSD.connect(admin).transfer(await vault.getAddress(), lit(500n));
    await vault.connect(admin).adminWithdrawUnderlying(admin.address, lit(200n));

    await feed.setMock(usd(1198n)); // +198 (< 0.5% slippage)
    await vault.connect(admin).setSlippageBps(50);

    expect(await vault.reserveState()).to.equal(1n);
    expect(await vault.pendingWithdrawnLitUSD()).to.equal(lit(200n));
  });

  it("ignores PoR decreases without reverting", async function () {
    const { admin, litUSD, feed, vault } = await deployFixture();

    await feed.setMock(usd(1000n));
    await litUSD.connect(admin).transfer(await vault.getAddress(), lit(500n));
    await vault.connect(admin).adminWithdrawUnderlying(admin.address, lit(200n));

    await feed.setMock(usd(900n));
    await vault.connect(admin).setSlippageBps(50);

    expect(await vault.reserveState()).to.equal(1n);
  });
});
