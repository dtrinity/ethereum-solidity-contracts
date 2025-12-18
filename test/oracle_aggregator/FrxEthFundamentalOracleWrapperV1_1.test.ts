import { expect } from "chai";
import { ethers } from "hardhat";

const ONE = 10n ** 18n;

describe("FrxEthFundamentalOracleWrapperV1_1", () => {
  async function deployFixture() {
    const frxEthFactory = await ethers.getContractFactory("MockFrxEth");
    const frxEth = await frxEthFactory.deploy(ONE);

    const routerFactory = await ethers.getContractFactory("MockFraxEtherRouter");
    const router = await routerFactory.deploy();

    const queueFactory = await ethers.getContractFactory("MockFraxRedemptionQueueV2");
    const queue = await queueFactory.deploy();

    const wrapperFactory = await ethers.getContractFactory("FrxEthFundamentalOracleWrapperV1_1");
    const wrapper = await wrapperFactory.deploy(
      ethers.ZeroAddress,
      ONE,
      await frxEth.getAddress(),
      await router.getAddress(),
      await queue.getAddress(),
    );

    return { frxEth, router, queue, wrapper };
  }

  it("returns NAV when below peg and redemptionRate=1", async () => {
    const { frxEth, router, queue, wrapper } = await deployFixture();

    await frxEth.setTotalSupply(1_000_000000000000000000000n); // 1e24
    await router.setEthTotalBalanced(500_000000000000000000000n); // 0.5e24
    await queue.setRedemptionFee(0);

    const [price, alive] = await wrapper.getPriceInfo(await frxEth.getAddress());
    expect(alive).to.equal(true);
    expect(price).to.equal(ONE / 2n); // 0.5e18
  });

  it("caps at 1 when NAV > 1 and redemptionRate=1", async () => {
    const { frxEth, router, queue, wrapper } = await deployFixture();

    await frxEth.setTotalSupply(1_000_000000000000000000000n); // 1e24
    await router.setEthTotalBalanced(2_000_000000000000000000000n); // 2e24
    await queue.setRedemptionFee(0);

    const [price, alive] = await wrapper.getPriceInfo(await frxEth.getAddress());
    expect(alive).to.equal(true);
    expect(price).to.equal(ONE);
  });

  it("caps at redemptionRate when redemptionRate < NAV", async () => {
    const { frxEth, router, queue, wrapper } = await deployFixture();

    await frxEth.setTotalSupply(1_000_000000000000000000000n); // 1e24
    await router.setEthTotalBalanced(2_000_000000000000000000000n); // 2e24 (NAV 2)
    await queue.setRedemptionFee(20_000); // 2% fee => 0.98

    const [price, alive] = await wrapper.getPriceInfo(await frxEth.getAddress());
    expect(alive).to.equal(true);
    expect(price).to.equal((ONE * 98n) / 100n); // 0.98e18
  });

  it("returns dead when fee >= 1e6", async () => {
    const { frxEth, router, queue, wrapper } = await deployFixture();
    await frxEth.setTotalSupply(1n);
    await router.setEthTotalBalanced(1n);
    await queue.setRedemptionFee(1_000_000); // >= 1e6

    const [, alive] = await wrapper.getPriceInfo(await frxEth.getAddress());
    expect(alive).to.equal(false);
  });

  it("returns dead when supply is zero", async () => {
    const { frxEth, router, queue, wrapper } = await deployFixture();
    await frxEth.setTotalSupply(0);
    await router.setEthTotalBalanced(1n);
    await queue.setRedemptionFee(0);

    const [, alive] = await wrapper.getPriceInfo(await frxEth.getAddress());
    expect(alive).to.equal(false);
  });

  it("returns dead when router reverts", async () => {
    const { frxEth, router, queue, wrapper } = await deployFixture();
    await frxEth.setTotalSupply(1n);
    await router.setShouldRevert(true);
    await queue.setRedemptionFee(0);

    const [, alive] = await wrapper.getPriceInfo(await frxEth.getAddress());
    expect(alive).to.equal(false);
  });

  it("returns dead when redemption queue reverts", async () => {
    const { frxEth, router, queue, wrapper } = await deployFixture();
    await frxEth.setTotalSupply(1n);
    await router.setEthTotalBalanced(1n);
    await queue.setShouldRevert(true);

    const [, alive] = await wrapper.getPriceInfo(await frxEth.getAddress());
    expect(alive).to.equal(false);
  });

  it("integrates with OracleAggregatorV1_1", async () => {
    const { frxEth, router, queue, wrapper } = await deployFixture();
    const aggFactory = await ethers.getContractFactory("OracleAggregatorV1_1");
    const aggregator = await aggFactory.deploy(ethers.ZeroAddress, ONE);

    await aggregator.setOracle(await frxEth.getAddress(), await wrapper.getAddress());

    await frxEth.setTotalSupply(1_000_000000000000000000000n); // 1e24
    await router.setEthTotalBalanced(1_000_000000000000000000000n); // NAV 1
    await queue.setRedemptionFee(0);

    const price = await aggregator.getAssetPrice(await frxEth.getAddress());
    expect(price).to.equal(ONE);
  });
});
