import { expect } from "chai";
import { ethers } from "hardhat";

import type {
  OracleAggregatorV1_1,
  OracleAggregatorV1_1__factory,
  ChainlinkFeedWrapperV1_1,
  ChainlinkFeedWrapperV1_1__factory,
  MockChainlinkAggregatorV3,
  MockChainlinkAggregatorV3__factory,
  HardPegOracleWrapperV1_1,
  HardPegOracleWrapperV1_1__factory,
} from "../../typechain-types";

describe("FallbackDeviationTrap", () => {
  const BASE_UNIT = 10n ** 8n;
  const HEARTBEAT = 60;
  const MAX_DEVIATION_BPS = 500;
  const PEG_PRICE = 100_000000n;

  let manager: any;
  let guardian: any;

  let aggregator: OracleAggregatorV1_1;
  let primaryWrapper: ChainlinkFeedWrapperV1_1;
  let fallbackWrapper: HardPegOracleWrapperV1_1;
  let mockFeed: MockChainlinkAggregatorV3;
  let asset: string;

  beforeEach(async () => {
    const [deployer, managerSigner, guardianSigner] = await ethers.getSigners();
    manager = managerSigner;
    guardian = guardianSigner;
    asset = ethers.Wallet.createRandom().address;

    const aggregatorFactory = (await ethers.getContractFactory(
      "OracleAggregatorV1_1",
    )) as OracleAggregatorV1_1__factory;
    aggregator = await aggregatorFactory.deploy(
      ethers.ZeroAddress,
      BASE_UNIT,
      [deployer.address],
      [manager.address],
      [guardian.address],
      3600,
    );

    const feedFactory = (await ethers.getContractFactory(
      "MockChainlinkAggregatorV3",
    )) as MockChainlinkAggregatorV3__factory;
    mockFeed = await feedFactory.deploy(8, "PRIMARY");
    await mockFeed.setMock(PEG_PRICE);

    const chainlinkWrapperFactory = (await ethers.getContractFactory(
      "ChainlinkFeedWrapperV1_1",
    )) as ChainlinkFeedWrapperV1_1__factory;
    primaryWrapper = await chainlinkWrapperFactory.deploy(ethers.ZeroAddress, BASE_UNIT, manager.address);
    await primaryWrapper.connect(manager).configureFeed(asset, mockFeed.target, HEARTBEAT, 0, 0, 0, 0);

    const hardPegFactory = (await ethers.getContractFactory(
      "HardPegOracleWrapperV1_1",
    )) as HardPegOracleWrapperV1_1__factory;
    fallbackWrapper = (await hardPegFactory.deploy(ethers.ZeroAddress, BASE_UNIT, manager.address)) as HardPegOracleWrapperV1_1;
    await fallbackWrapper.connect(manager).configurePeg(asset, PEG_PRICE, 99_000000n, 101_000000n);

    await aggregator
      .connect(manager)
      .configureAsset(asset, primaryWrapper.target, fallbackWrapper.target, 0, HEARTBEAT, MAX_DEVIATION_BPS, 0, 0);

    await aggregator.connect(manager).updateLastGoodPrice(asset);
  });

  it("uses the hard peg fallback when deviation thresholds are breached and recovers once the primary stabilises", async () => {
    const initial = await aggregator.getPriceInfo(asset);
    expect(initial.isAlive).to.equal(true);
    expect(initial.price).to.equal(PEG_PRICE);

    await mockFeed.setMock(130_000000n);

    const [fallbackPrices, , usedFallback] = await aggregator.batchRefresh([asset]);
    expect(usedFallback[0]).to.equal(true);
    expect(fallbackPrices[0].price).to.equal(PEG_PRICE);

    const fallbackQuote = await aggregator.getAssetPrice(asset);
    expect(fallbackQuote).to.equal(PEG_PRICE);

    // TODO: Add IssuerV2/RedeemerV2 revert assertions once fallback gating is enforced on issuance flows.

    await mockFeed.setMock(101_000000n);

    const [recoveredPrices, , usedFallbackAfterRecovery] = await aggregator.batchRefresh([asset]);
    expect(usedFallbackAfterRecovery[0]).to.equal(false);
    expect(recoveredPrices[0].price).to.equal(101_000000n);

    const recoveredQuote = await aggregator.getAssetPrice(asset);
    expect(recoveredQuote).to.equal(101_000000n);
  });
});
