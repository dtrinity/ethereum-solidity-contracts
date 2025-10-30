import { expect } from "chai";
import { ethers } from "hardhat";
import { time } from "@nomicfoundation/hardhat-network-helpers";

import type {
  OracleAggregatorV1_1,
  OracleAggregatorV1_1__factory,
  HardPegOracleWrapperV1_1,
  HardPegOracleWrapperV1_1__factory,
  MockOracleAggregator,
  MockOracleAggregator__factory,
  API3WrapperV1_1,
  API3WrapperV1_1__factory,
  MockApi3Proxy,
  MockApi3Proxy__factory,
  RedstoneChainlinkWrapperV1_1,
  RedstoneChainlinkWrapperV1_1__factory,
  MockRedstoneChainlinkOracleAlwaysAlive,
  MockRedstoneChainlinkOracleAlwaysAlive__factory,
} from "../../typechain-types";

const BASE_UNIT = 10n ** 8n;

describe("OracleAggregatorV1_1", () => {
  let deployer: any;
  let manager: any;
  let other: any;
  let aggregator: OracleAggregatorV1_1;

  beforeEach(async () => {
    [deployer, manager, other] = await ethers.getSigners();
    const factory = (await ethers.getContractFactory("OracleAggregatorV1_1", deployer)) as OracleAggregatorV1_1__factory;
    aggregator = await factory.deploy(ethers.ZeroAddress, BASE_UNIT);
    await aggregator.grantRole(await aggregator.ORACLE_MANAGER_ROLE(), manager.address);
  });

  it("routes prices from configured wrapper", async () => {
    const wrapperFactory = (await ethers.getContractFactory("HardPegOracleWrapperV1_1", manager)) as HardPegOracleWrapperV1_1__factory;
    const wrapper = await wrapperFactory.deploy(ethers.ZeroAddress, BASE_UNIT, BASE_UNIT);

    const asset = ethers.Wallet.createRandom().address;
    await expect(aggregator.connect(manager).setOracle(asset, await wrapper.getAddress())).to.emit(aggregator, "OracleUpdated");

    const [price, isAlive] = await aggregator.getPriceInfo(asset);
    expect(price).to.equal(BASE_UNIT);
    expect(isAlive).to.equal(true);
    expect(await aggregator.getAssetPrice(asset)).to.equal(BASE_UNIT);
  });

  it("rejects zero oracle address", async () => {
    const asset = ethers.Wallet.createRandom().address;
    await expect(aggregator.connect(manager).setOracle(asset, ethers.ZeroAddress))
      .to.be.revertedWithCustomError(aggregator, "ZeroAddress")
      .withArgs("oracle");
  });

  it("rejects non-contract oracle", async () => {
    const asset = ethers.Wallet.createRandom().address;
    await expect(aggregator.connect(manager).setOracle(asset, other.address)).to.be.revertedWithCustomError(
      aggregator,
      "OracleNotContract",
    );
  });

  it("rejects incompatible base currency", async () => {
    const wrapperFactory = (await ethers.getContractFactory("HardPegOracleWrapperV1_1", manager)) as HardPegOracleWrapperV1_1__factory;
    const wrapper = await wrapperFactory.deploy(ethers.Wallet.createRandom().address, BASE_UNIT, BASE_UNIT);

    const asset = ethers.Wallet.createRandom().address;
    await expect(aggregator.connect(manager).setOracle(asset, await wrapper.getAddress()))
      .to.be.revertedWithCustomError(aggregator, "UnexpectedBaseCurrency")
      .withArgs(asset, await wrapper.getAddress(), ethers.ZeroAddress, await wrapper.BASE_CURRENCY());
  });

  it("rejects incompatible base unit", async () => {
    const wrapperFactory = (await ethers.getContractFactory("HardPegOracleWrapperV1_1", manager)) as HardPegOracleWrapperV1_1__factory;
    const wrapper = await wrapperFactory.deploy(ethers.ZeroAddress, 10n ** 18n, 10n ** 18n);

    const asset = ethers.Wallet.createRandom().address;
    await expect(aggregator.connect(manager).setOracle(asset, await wrapper.getAddress()))
      .to.be.revertedWithCustomError(aggregator, "UnexpectedBaseUnit")
      .withArgs(asset, await wrapper.getAddress(), BASE_UNIT, await wrapper.BASE_CURRENCY_UNIT());
  });

  it("reverts when downstream wrapper reports non-live price", async () => {
    const mockFactory = (await ethers.getContractFactory("MockOracleAggregator", manager)) as MockOracleAggregator__factory;
    const mock = await mockFactory.deploy(ethers.ZeroAddress, BASE_UNIT);
    const asset = ethers.Wallet.createRandom().address;
    await mock.setPrice(asset, BASE_UNIT, false);

    await aggregator.connect(manager).setOracle(asset, await mock.getAddress());
    await expect(aggregator.getAssetPrice(asset)).to.be.revertedWithCustomError(aggregator, "PriceNotAlive").withArgs(asset);
  });

  it("supports removing an oracle", async () => {
    const wrapperFactory = (await ethers.getContractFactory("HardPegOracleWrapperV1_1", manager)) as HardPegOracleWrapperV1_1__factory;
    const wrapper = await wrapperFactory.deploy(ethers.ZeroAddress, BASE_UNIT, BASE_UNIT);
    const asset = ethers.Wallet.createRandom().address;

    await aggregator.connect(manager).setOracle(asset, await wrapper.getAddress());
    await aggregator.connect(manager).removeOracle(asset);

    await expect(aggregator.getPriceInfo(asset)).to.be.revertedWithCustomError(aggregator, "OracleNotSet").withArgs(asset);
  });
});

describe("API3WrapperV1_1", () => {
  let wrapper: API3WrapperV1_1;
  let proxy: MockApi3Proxy;

  beforeEach(async () => {
    const wrapperFactory = (await ethers.getContractFactory("API3WrapperV1_1")) as API3WrapperV1_1__factory;
    wrapper = await wrapperFactory.deploy(ethers.ZeroAddress, BASE_UNIT);

    const proxyFactory = (await ethers.getContractFactory("MockApi3Proxy")) as MockApi3Proxy__factory;
    proxy = await proxyFactory.deploy();
    await wrapper.setProxy(ethers.ZeroAddress, await proxy.getAddress());
  });

  it("normalises API3 price data", async () => {
    const now = await time.latest();
    await proxy.setValue(1_500_000000000000000n, BigInt(now));

    const [price, isAlive] = await wrapper.getPriceInfo(ethers.ZeroAddress);
    expect(price).to.equal(150_000000n);
    expect(isAlive).to.equal(true);
  });

  it("marks feed stale when heartbeat exceeded", async () => {
    const stale = BigInt(24 * 60 * 60 + 30 * 60 + 1);
    const now = await time.latest();
    await proxy.setValue(1_000_000000000000000n, BigInt(now) - stale);

    const [, isAlive] = await wrapper.getPriceInfo(ethers.ZeroAddress);
    expect(isAlive).to.equal(false);
  });
});

describe("RedstoneChainlinkWrapperV1_1", () => {
  it("converts Chainlink-style price feeds", async () => {
    const wrapperFactory = (await ethers.getContractFactory("RedstoneChainlinkWrapperV1_1")) as RedstoneChainlinkWrapperV1_1__factory;
    const wrapper = await wrapperFactory.deploy(ethers.ZeroAddress, BASE_UNIT);

    const feedFactory = (await ethers.getContractFactory(
      "MockRedstoneChainlinkOracleAlwaysAlive",
    )) as MockRedstoneChainlinkOracleAlwaysAlive__factory;
    const feed = await feedFactory.deploy();
    await feed.setMock(123_45678900n);

    const asset = ethers.Wallet.createRandom().address;
    await wrapper.setFeed(asset, await feed.getAddress());

    const [price, isAlive] = await wrapper.getPriceInfo(asset);
    expect(price).to.equal(123_45678900n);
    expect(isAlive).to.equal(true);
  });
});

describe("HardPegOracleWrapperV1_1", () => {
  it("always returns the configured peg", async () => {
    const wrapperFactory = (await ethers.getContractFactory("HardPegOracleWrapperV1_1")) as HardPegOracleWrapperV1_1__factory;
    const wrapper = await wrapperFactory.deploy(ethers.ZeroAddress, BASE_UNIT, BASE_UNIT);

    const [price, isAlive] = await wrapper.getPriceInfo(ethers.ZeroAddress);
    expect(price).to.equal(BASE_UNIT);
    expect(isAlive).to.equal(true);
  });
});
