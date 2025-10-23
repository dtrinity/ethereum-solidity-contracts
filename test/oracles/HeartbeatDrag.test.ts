import { expect } from "chai";
import { ethers } from "hardhat";
import { time } from "@nomicfoundation/hardhat-network-helpers";

import type {
  OracleAggregatorV1_1,
  ChainlinkFeedWrapperV1_1,
  MockChainlinkAggregatorV3,
  OracleAggregatorV1_1__factory,
  ChainlinkFeedWrapperV1_1__factory,
  MockChainlinkAggregatorV3__factory,
} from "../../typechain-types";

describe("Heartbeat drag", () => {
  const BASE_UNIT = 10n ** 8n;
  const HEARTBEAT = 60n;
  const MAX_STALE_TIME = 120n;
  const INITIAL_PRICE = 100n * BASE_UNIT;

  let deployer: any;
  let manager: any;
  let guardian: any;

  let aggregator: OracleAggregatorV1_1;
  let wrapper: ChainlinkFeedWrapperV1_1;
  let feed: MockChainlinkAggregatorV3;
  let asset: string;

  beforeEach(async () => {
    [deployer, manager, guardian] = await ethers.getSigners();
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
    feed = await feedFactory.deploy(8, "MOCK");
    await feed.setMock(INITIAL_PRICE);

    const wrapperFactory = (await ethers.getContractFactory("ChainlinkFeedWrapperV1_1")) as ChainlinkFeedWrapperV1_1__factory;
    wrapper = await wrapperFactory.deploy(ethers.ZeroAddress, BASE_UNIT, manager.address);

    await wrapper
      .connect(manager)
      .configureFeed(asset, feed.target, Number(HEARTBEAT), Number(MAX_STALE_TIME), 0, 0, 0);

    await aggregator.connect(manager).setOracle(asset, wrapper.target);
    await aggregator.connect(manager).updateAssetRiskConfig(asset, Number(MAX_STALE_TIME), Number(HEARTBEAT), 0, 0, 0);
  });

  it("marks primary feed stale after heartbeat drag and recovers once refreshed", async () => {
    const liveInfo = await aggregator.getPriceInfo(asset);
    expect(liveInfo.isAlive).to.equal(true);
    expect(liveInfo.price).to.equal(INITIAL_PRICE);

    await aggregator.connect(manager).updateLastGoodPrice(asset);

    const dragWindow = HEARTBEAT + MAX_STALE_TIME + 1n;
    await time.increase(Number(dragWindow));

    const staleInfo = await aggregator.getPriceInfo(asset);
    expect(staleInfo.isAlive).to.equal(false);
    expect(staleInfo.price).to.equal(INITIAL_PRICE);

    await expect(aggregator.getAssetPrice(asset))
      .to.be.revertedWithCustomError(aggregator, "PriceNotAlive")
      .withArgs(asset);

    await feed.setMock(INITIAL_PRICE);

    const revivedInfo = await aggregator.getPriceInfo(asset);
    expect(revivedInfo.isAlive).to.equal(true);
    expect(revivedInfo.price).to.equal(INITIAL_PRICE);

    // TODO: extend coverage to IssuerV2 and RedeemerV2 interactions once heartbeat drag wiring is available.
  });
});
