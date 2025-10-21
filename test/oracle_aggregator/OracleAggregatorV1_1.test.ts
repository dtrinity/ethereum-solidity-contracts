import { expect } from "chai";
import { ethers } from "hardhat";
import { time } from "@nomicfoundation/hardhat-network-helpers";

import type {
  OracleAggregatorV1_1,
  ChainlinkFeedWrapperV1_1,
  MockChainlinkAggregatorV3,
  ChainlinkFeedWrapperV1_1__factory,
  OracleAggregatorV1_1__factory,
  MockChainlinkAggregatorV3__factory,
  ChainlinkRateCompositeWrapperV1_1,
  MockRateProvider,
  API3WrapperV1_1,
  MockApi3Proxy,
  HardPegOracleWrapperV1_1,
} from "../../typechain-types";

describe("OracleAggregatorV1_1", () => {
  const BASE_UNIT = 10n ** 8n;
  const HEARTBEAT = 60n;

  let deployer: any;
  let manager: any;
  let guardian: any;
  let other: any;

  let aggregator: OracleAggregatorV1_1;
  let wrapper: ChainlinkFeedWrapperV1_1;
  let mockFeed: MockChainlinkAggregatorV3;
  let asset: string;

  beforeEach(async () => {
    [deployer, manager, guardian, other] = await ethers.getSigners();
    asset = ethers.Wallet.createRandom().address;

    const aggregatorFactory = (await ethers.getContractFactory("OracleAggregatorV1_1")) as OracleAggregatorV1_1__factory;
    aggregator = await aggregatorFactory.deploy(
      ethers.ZeroAddress,
      BASE_UNIT,
      [deployer.address],
      [manager.address],
      [guardian.address],
      3600,
    );

    const feedFactory = (await ethers.getContractFactory("MockChainlinkAggregatorV3")) as MockChainlinkAggregatorV3__factory;
    mockFeed = await feedFactory.deploy(8, "MOCK");
    await mockFeed.setMock(100n * BASE_UNIT);

    const wrapperFactory = (await ethers.getContractFactory("ChainlinkFeedWrapperV1_1")) as ChainlinkFeedWrapperV1_1__factory;
    wrapper = await wrapperFactory.deploy(ethers.ZeroAddress, BASE_UNIT, manager.address);

    await wrapper.connect(manager).configureFeed(asset, mockFeed.target, Number(HEARTBEAT), 0, 0, 0, 0);

    await aggregator.connect(manager).setOracle(asset, wrapper.target);
  });

  async function storeLastGoodPrice() {
    await aggregator.connect(manager).updateLastGoodPrice(asset);
    return aggregator.getPriceInfo(asset);
  }

  it("returns live price when feed healthy", async () => {
    const info = await aggregator.getPriceInfo(asset);
    expect(info.price).to.equal(100n * BASE_UNIT);
    expect(info.isAlive).to.equal(true);
  });

  it("falls back to last good price when feed becomes stale", async () => {
    const stored = await storeLastGoodPrice();
    const current = await time.latest();
    await mockFeed.setMockWithTimestamp(101n * BASE_UNIT, BigInt(current - 2 * 3600));

    const info = await aggregator.getPriceInfo(asset);
    expect(info.price).to.equal(stored.price);
    expect(info.isAlive).to.equal(false);
    await expect(aggregator.getAssetPrice(asset)).to.be.revertedWithCustomError(aggregator, "PriceNotAlive").withArgs(asset);
  });

  it("applies deviation gating", async () => {
    await storeLastGoodPrice();
    await aggregator.connect(manager).updateAssetRiskConfig(asset, 0, 0, 500, 0, 0);
    await mockFeed.setMock(130n * BASE_UNIT);

    const info = await aggregator.getPriceInfo(asset);
    expect(info.isAlive).to.equal(false);
    expect(info.price).to.equal(100n * BASE_UNIT);
  });

  it("uses fallback oracle when primary feed invalid", async () => {
    const fallbackFeedFactory = (await ethers.getContractFactory("MockChainlinkAggregatorV3")) as MockChainlinkAggregatorV3__factory;
    const fallbackFeed = await fallbackFeedFactory.deploy(8, "FALLBACK");
    await fallbackFeed.setMock(95n * BASE_UNIT);

    const fallbackWrapperFactory = (await ethers.getContractFactory("ChainlinkFeedWrapperV1_1")) as ChainlinkFeedWrapperV1_1__factory;
    const fallbackWrapper = await fallbackWrapperFactory.deploy(ethers.ZeroAddress, BASE_UNIT, manager.address);
    await fallbackWrapper.connect(manager).configureFeed(asset, fallbackFeed.target, Number(HEARTBEAT), 0, 0, 0, 0);

    await aggregator.connect(manager).setFallbackOracle(asset, fallbackWrapper.target);
    await mockFeed.setMock(0);

    const info = await aggregator.getPriceInfo(asset);
    expect(info.isAlive).to.equal(true);
    expect(info.price).to.equal(95n * BASE_UNIT);
  });

  it("supports guardian freeze, manual price push, and unfreeze", async () => {
    const stored = await storeLastGoodPrice();
    await aggregator.connect(guardian).pauseAsset(asset);

    const frozenInfo = await aggregator.getPriceInfo(asset);
    expect(frozenInfo.price).to.equal(stored.price);
    expect(frozenInfo.isAlive).to.equal(false);

    const now = await time.latest();
    await aggregator.connect(guardian).pushFrozenPrice(asset, 120n * BASE_UNIT, now);
    const manualInfo = await aggregator.getPriceInfo(asset);
    expect(manualInfo.price).to.equal(120n * BASE_UNIT);
    expect(manualInfo.isAlive).to.equal(false);

    await aggregator.connect(guardian).unpauseAsset(asset);
    await mockFeed.setMock(105n * BASE_UNIT);
    const liveInfo = await aggregator.getPriceInfo(asset);
    expect(liveInfo.price).to.equal(105n * BASE_UNIT);
    expect(liveInfo.isAlive).to.equal(true);
  });

  it("rejects fallback matching primary", async () => {
    await expect(aggregator.connect(manager).setFallbackOracle(asset, wrapper.target))
      .to.be.revertedWithCustomError(aggregator, "FallbackMatchesPrimary")
      .withArgs(asset, wrapper.target);

    const otherAsset = ethers.Wallet.createRandom().address;
    await expect(aggregator.connect(manager).configureAsset(otherAsset, wrapper.target, wrapper.target, 0, 0, 0, 0, 0))
      .to.be.revertedWithCustomError(aggregator, "FallbackMatchesPrimary")
      .withArgs(otherAsset, wrapper.target);
  });

  it("rejects zero oracle address", async () => {
    await expect(aggregator.connect(manager).setOracle(asset, ethers.ZeroAddress))
      .to.be.revertedWithCustomError(aggregator, "ZeroAddress")
      .withArgs("oracle");
  });

  it("honours heartbeat override", async () => {
    await storeLastGoodPrice();
    await aggregator.connect(manager).updateAssetRiskConfig(asset, 10, 30, 0, 0, 0);

    const current = await time.latest();
    await mockFeed.setMockWithTimestamp(110n * BASE_UNIT, BigInt(current - 100));
    const info = await aggregator.getPriceInfo(asset);
    expect(info.isAlive).to.equal(false);
    expect(info.price).to.equal(100n * BASE_UNIT);
  });

  it("supports batchRefresh", async () => {
    const [prices, isFrozen, usedFallback] = await aggregator.batchRefresh([asset]);
    expect(prices[0].price).to.equal(100n * BASE_UNIT);
    expect(prices[0].isAlive).to.equal(true);
    expect(isFrozen[0]).to.equal(false);
    expect(usedFallback[0]).to.equal(false);
  });
});

describe("Oracle wrappers", () => {
  const BASE_UNIT = 10n ** 8n;

  it("Chainlink wrapper detects invalid price", async () => {
    const [owner] = await ethers.getSigners();
    const feedFactory = (await ethers.getContractFactory("MockChainlinkAggregatorV3")) as MockChainlinkAggregatorV3__factory;
    const feed = await feedFactory.deploy(8, "CHAINLINK");
    await feed.setMock(0);

    const wrapperFactory = (await ethers.getContractFactory("ChainlinkFeedWrapperV1_1")) as ChainlinkFeedWrapperV1_1__factory;
    const wrapper = await wrapperFactory.deploy(ethers.ZeroAddress, BASE_UNIT, owner.address);
    const asset = ethers.Wallet.createRandom().address;
    await wrapper.connect(owner).configureFeed(asset, feed.target, 60, 0, 0, 0, 0);

    const priceInfo = await wrapper.getPriceInfo(asset);
    expect(priceInfo.isAlive).to.equal(false);
  });

  it("API3 wrapper normalises values", async () => {
    const [owner] = await ethers.getSigners();
    const proxyFactory = await ethers.getContractFactory("MockApi3Proxy");
    const proxy = (await proxyFactory.deploy()) as MockApi3Proxy;
    const current = await time.latest();
    await proxy.setValue(150n * 10n ** 18n, current);

    const wrapperFactory = await ethers.getContractFactory("API3WrapperV1_1");
    const wrapper = (await wrapperFactory.deploy(ethers.ZeroAddress, BASE_UNIT, owner.address)) as API3WrapperV1_1;
    const asset = ethers.Wallet.createRandom().address;
    await wrapper.connect(owner).configureProxy(asset, proxy.target, 18, 0, 0, 0, 0, 0);

    const info = await wrapper.getPriceInfo(asset);
    expect(info.isAlive).to.equal(true);
    expect(info.price).to.equal(150n * BASE_UNIT);
  });

  it("Hard peg wrapper enforces guard rails", async () => {
    const [owner] = await ethers.getSigners();
    const wrapperFactory = await ethers.getContractFactory("HardPegOracleWrapperV1_1");
    const wrapper = (await wrapperFactory.deploy(ethers.ZeroAddress, BASE_UNIT, owner.address)) as HardPegOracleWrapperV1_1;
    const asset = ethers.Wallet.createRandom().address;
    await wrapper.connect(owner).configurePeg(asset, 1n * BASE_UNIT, 90_000000n, 110_000000n);

    const info = await wrapper.getPriceInfo(asset);
    expect(info.isAlive).to.equal(true);
    expect(info.price).to.equal(1n * BASE_UNIT);

    await wrapper.connect(owner).updatePeg(asset, 101_000000n);
    const updated = await wrapper.getPriceInfo(asset);
    expect(updated.price).to.equal(101_000000n);
  });

  it("Composite wrapper multiplies feed and rate", async () => {
    const [owner] = await ethers.getSigners();
    const priceFeedFactory = (await ethers.getContractFactory("MockChainlinkAggregatorV3")) as MockChainlinkAggregatorV3__factory;
    const priceFeed = await priceFeedFactory.deploy(8, "PRICE");
    await priceFeed.setMock(50n * BASE_UNIT);

    const rateProviderFactory = await ethers.getContractFactory("MockRateProvider");
    const rateProvider = (await rateProviderFactory.deploy()) as MockRateProvider;
    const current = await time.latest();
    await rateProvider.setRate(2n * 10n ** 18n, current);

    const wrapperFactory = await ethers.getContractFactory("ChainlinkRateCompositeWrapperV1_1");
    const wrapper = (await wrapperFactory.deploy(ethers.ZeroAddress, BASE_UNIT, owner.address)) as ChainlinkRateCompositeWrapperV1_1;
    const asset = ethers.Wallet.createRandom().address;
    await wrapper.connect(owner).configureComposite(asset, priceFeed.target, 8, rateProvider.target, 18, 60, 60, 0, 0, 0, 0);

    const info = await wrapper.getPriceInfo(asset);
    expect(info.isAlive).to.equal(true);
    expect(info.price).to.equal(100n * BASE_UNIT);
  });
});
