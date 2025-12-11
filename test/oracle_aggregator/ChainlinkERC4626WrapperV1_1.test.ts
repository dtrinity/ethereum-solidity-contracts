import { expect } from "chai";
import { ethers } from "hardhat";

import type {
  ChainlinkERC4626WrapperV1_1,
  ChainlinkERC4626WrapperV1_1__factory,
  MockRedstoneChainlinkOracleAlwaysAlive,
  MockRedstoneChainlinkOracleAlwaysAlive__factory,
  MockERC4626Vault,
  MockERC4626Vault__factory,
  OracleAggregatorV1_1,
  OracleAggregatorV1_1__factory,
  TestERC20,
  TestERC20__factory,
} from "../../typechain-types";

const BASE_UNIT = 10n ** 8n;

describe("ChainlinkERC4626WrapperV1_1", () => {
  let underlying: TestERC20;
  let vault: MockERC4626Vault;
  let feed: MockRedstoneChainlinkOracleAlwaysAlive;
  let wrapper: ChainlinkERC4626WrapperV1_1;

  beforeEach(async () => {
    const tokenFactory = (await ethers.getContractFactory("TestERC20")) as TestERC20__factory;
    underlying = await tokenFactory.deploy("Frax USD", "frxUSD", 18);

    const vaultFactory = (await ethers.getContractFactory("MockERC4626Vault")) as MockERC4626Vault__factory;
    vault = await vaultFactory.deploy("Staked Frax USD", "sfrxUSD", await underlying.getAddress(), 18, ethers.parseUnits("1.05", 18));

    const feedFactory = (await ethers.getContractFactory(
      "MockRedstoneChainlinkOracleAlwaysAlive",
    )) as MockRedstoneChainlinkOracleAlwaysAlive__factory;
    feed = await feedFactory.deploy();
    await feed.setMock(ethers.parseUnits("1", 8));

    const wrapperFactory = (await ethers.getContractFactory("ChainlinkERC4626WrapperV1_1")) as ChainlinkERC4626WrapperV1_1__factory;
    wrapper = await wrapperFactory.deploy(ethers.ZeroAddress, BASE_UNIT);

    await wrapper.setERC4626Feed(await vault.getAddress(), await vault.getAddress(), await feed.getAddress());
  });

  it("returns vault share price composed from Chainlink and convertToAssets", async () => {
    const [price, isAlive] = await wrapper.getPriceInfo(await vault.getAddress());
    expect(price).to.equal(105_000000n);
    expect(isAlive).to.equal(true);
  });

  it("marks price dead when vault conversion returns zero", async () => {
    await vault.setAssetsPerShare(0);
    const [, isAlive] = await wrapper.getPriceInfo(await vault.getAddress());
    expect(isAlive).to.equal(false);
  });

  it("integrates with OracleAggregatorV1_1", async () => {
    const aggregatorFactory = (await ethers.getContractFactory("OracleAggregatorV1_1")) as OracleAggregatorV1_1__factory;
    const aggregator = await aggregatorFactory.deploy(ethers.ZeroAddress, BASE_UNIT);
    await aggregator.setOracle(await vault.getAddress(), await wrapper.getAddress());

    expect(await aggregator.getAssetPrice(await vault.getAddress())).to.equal(105_000000n);
  });
});
