import { ZeroAddress } from "ethers";
import { HardhatRuntimeEnvironment } from "hardhat/types";
import { DeployFunction } from "hardhat-deploy/types";

import { getConfig } from "../../config/config";
import {
  ChainlinkFeedAssetConfig,
  ChainlinkRateCompositeAssetConfig,
  HardPegAssetConfig,
  OracleAggregatorConfig,
  OracleWrapperDeploymentConfig,
} from "../../config/types";
import { DETH_TOKEN_ID, DUSD_TOKEN_ID } from "../../typescript/deploy-ids";
import { DEFAULT_ORACLE_HEARTBEAT_SECONDS, ORACLE_AGGREGATOR_BASE_CURRENCY_UNIT } from "../../typescript/oracle_aggregator/constants";

type ChainlinkAssetMap = NonNullable<OracleWrapperDeploymentConfig<ChainlinkFeedAssetConfig>["assets"]>;
type ChainlinkCompositeAssetMap = NonNullable<OracleWrapperDeploymentConfig<ChainlinkRateCompositeAssetConfig>["assets"]>;
type HardPegAssetMap = NonNullable<OracleWrapperDeploymentConfig<HardPegAssetConfig>["assets"]>;

const func: DeployFunction = async function (hre: HardhatRuntimeEnvironment): Promise<boolean> {
  const { deployer } = await hre.getNamedAccounts();
  const signer = await hre.ethers.getSigner(deployer);

  const config = await getConfig(hre);
  const oracleConfig = config.oracleAggregators.USD;

  // Keep the deployer as the initial admin; governance migration happens manually post-deploy.
  await deployChainlinkWrapper(hre, oracleConfig, deployer, signer);
  await deployApi3Wrapper(hre, oracleConfig, deployer);
  await deployCompositeWrapper(hre, oracleConfig, deployer);
  await deployHardPegWrapper(hre, oracleConfig, deployer);

  console.log(`🔮 ${__filename.split("/").slice(-2).join("/")}: ✅`);
  return true;
};

/**
 * Deploys the Chainlink wrapper contract and configures feeds using the deployer as admin.
 *
 * @param hre Hardhat runtime environment
 * @param oracleConfig Oracle configuration for the current network
 * @param deployer Deployer address responsible for managing the wrapper
 * @param signer Ethers signer bound to the deployer
 */
async function deployChainlinkWrapper(
  hre: HardhatRuntimeEnvironment,
  oracleConfig: OracleAggregatorConfig,
  deployer: string,
  signer: any,
): Promise<void> {
  const wrapperConfig = oracleConfig.wrappers?.chainlink;
  const assets = (wrapperConfig?.assets as ChainlinkAssetMap | undefined) || {};

  if (!wrapperConfig || Object.keys(assets).length === 0) {
    return;
  }

  const deployment = await hre.deployments.deploy(wrapperConfig.deploymentId, {
    from: deployer,
    contract: "ChainlinkFeedWrapperV1_1",
    args: [oracleConfig.baseCurrency, ORACLE_AGGREGATOR_BASE_CURRENCY_UNIT, deployer],
    log: true,
    autoMine: true,
  });

  const wrapper = await hre.ethers.getContractAt("ChainlinkFeedWrapperV1_1", deployment.address, signer);

  const feedCache = new Map<string, string>();

  for (const [assetAddress, assetConfig] of Object.entries(assets)) {
    if (!isUsableAddress(assetAddress)) {
      continue;
    }

    const feedAddress = await ensureChainlinkFeed(hre, deployer, assetAddress, assetConfig, feedCache);

    const heartbeatSeconds =
      typeof assetConfig.heartbeat === "number" && assetConfig.heartbeat > 0 ? assetConfig.heartbeat : DEFAULT_ORACLE_HEARTBEAT_SECONDS;

    await (
      await wrapper.configureFeed(
        assetAddress,
        feedAddress,
        heartbeatSeconds,
        assetConfig.maxStaleTime ?? 0,
        assetConfig.maxDeviationBps ?? 0,
        assetConfig.minAnswer ?? 0n,
        assetConfig.maxAnswer ?? 0n,
      )
    ).wait();
  }
}

/**
 * Deploys the API3 wrapper contract with the deployer managing administration.
 *
 * @param hre Hardhat runtime environment
 * @param oracleConfig Oracle configuration for the current network
 * @param deployer Deployer address responsible for managing the wrapper
 */
async function deployApi3Wrapper(hre: HardhatRuntimeEnvironment, oracleConfig: OracleAggregatorConfig, deployer: string): Promise<void> {
  const wrapperConfig = oracleConfig.wrappers?.api3;
  const assets = wrapperConfig?.assets || {};

  if (!wrapperConfig || Object.keys(assets).length === 0) {
    return;
  }

  await hre.deployments.deploy(wrapperConfig.deploymentId, {
    from: deployer,
    contract: "API3WrapperV1_1",
    args: [oracleConfig.baseCurrency, ORACLE_AGGREGATOR_BASE_CURRENCY_UNIT, deployer],
    log: true,
    autoMine: true,
  });

  // TODO: wire API3 asset configuration once feeds are defined in config.
}

/**
 * Deploys the composite wrapper contract while the deployer retains administrative control.
 *
 * @param hre Hardhat runtime environment
 * @param oracleConfig Oracle configuration for the current network
 * @param deployer Deployer address responsible for managing the wrapper
 */
async function deployCompositeWrapper(
  hre: HardhatRuntimeEnvironment,
  oracleConfig: OracleAggregatorConfig,
  deployer: string,
): Promise<void> {
  const wrapperConfig = oracleConfig.wrappers?.rateComposite;
  const assets = (wrapperConfig?.assets as ChainlinkCompositeAssetMap | undefined) || {};

  if (!wrapperConfig || Object.keys(assets).length === 0) {
    return;
  }

  const deployment = await hre.deployments.deploy(wrapperConfig.deploymentId, {
    from: deployer,
    contract: "ChainlinkRateCompositeWrapperV1_1",
    args: [oracleConfig.baseCurrency, ORACLE_AGGREGATOR_BASE_CURRENCY_UNIT, deployer],
    log: true,
    autoMine: true,
  });

  const wrapper = await hre.ethers.getContractAt(
    "ChainlinkRateCompositeWrapperV1_1",
    deployment.address,
    await hre.ethers.getSigner(deployer),
  );

  for (const [assetAddress, assetConfig] of Object.entries(assets)) {
    if (!isUsableAddress(assetAddress)) {
      continue;
    }

    if (!assetConfig.priceFeed || !isUsableAddress(assetConfig.priceFeed)) {
      throw new Error(`Composite asset ${assetAddress} missing priceFeed configuration`);
    }

    const priceFeedDecimals = assetConfig.priceFeedDecimals ?? (await getAggregatorDecimals(hre, assetConfig.priceFeed));
    const priceHeartbeat =
      typeof assetConfig.priceHeartbeat === "number" && assetConfig.priceHeartbeat > 0
        ? assetConfig.priceHeartbeat
        : DEFAULT_ORACLE_HEARTBEAT_SECONDS;

    const { rateProviderAddress, rateDecimals } = await resolveRateProvider(hre, deployer, assetAddress, assetConfig);

    const rateHeartbeat =
      typeof assetConfig.rateHeartbeat === "number" && assetConfig.rateHeartbeat > 0
        ? assetConfig.rateHeartbeat
        : DEFAULT_ORACLE_HEARTBEAT_SECONDS;

    await (
      await wrapper.configureComposite(
        assetAddress,
        assetConfig.priceFeed,
        priceFeedDecimals,
        rateProviderAddress,
        rateDecimals,
        priceHeartbeat,
        rateHeartbeat,
        assetConfig.maxStaleTime ?? 0,
        assetConfig.maxDeviationBps ?? 0,
        assetConfig.minAnswer ?? 0n,
        assetConfig.maxAnswer ?? 0n,
      )
    ).wait();
  }
}

/**
 * Deploys the hard peg wrapper and configures guards for each configured asset.
 *
 * @param hre Hardhat runtime environment
 * @param oracleConfig Oracle configuration for the current network
 * @param deployer Deployer address responsible for managing the wrapper
 */
async function deployHardPegWrapper(hre: HardhatRuntimeEnvironment, oracleConfig: OracleAggregatorConfig, deployer: string): Promise<void> {
  const wrapperConfig = oracleConfig.wrappers?.hardPeg;
  const assets = (wrapperConfig?.assets as HardPegAssetMap | undefined) || {};

  if (!wrapperConfig || Object.keys(assets).length === 0) {
    return;
  }

  const deployment = await hre.deployments.deploy(wrapperConfig.deploymentId, {
    from: deployer,
    contract: "HardPegOracleWrapperV1_1",
    args: [oracleConfig.baseCurrency, ORACLE_AGGREGATOR_BASE_CURRENCY_UNIT, deployer],
    log: true,
    autoMine: true,
  });

  const wrapper = await hre.ethers.getContractAt("HardPegOracleWrapperV1_1", deployment.address, await hre.ethers.getSigner(deployer));

  for (const [assetAddress, assetConfig] of Object.entries(assets)) {
    const isZeroAddress = assetAddress.toLowerCase() === ZeroAddress.toLowerCase();

    if (!isZeroAddress && !isUsableAddress(assetAddress)) {
      continue;
    }

    await (
      await wrapper.configurePeg(assetAddress, assetConfig.pricePeg, assetConfig.lowerGuard ?? 0n, assetConfig.upperGuard ?? 0n)
    ).wait();
  }
}

/**
 * Resolves or deploys the rate provider required for composite feeds.
 *
 * @param hre Hardhat runtime environment
 * @param deployer Deployer address used for mock deployments
 * @param assetAddress Asset identifier being configured
 * @param assetConfig Composite configuration for the asset
 */
async function resolveRateProvider(
  hre: HardhatRuntimeEnvironment,
  deployer: string,
  assetAddress: string,
  assetConfig: ChainlinkRateCompositeAssetConfig,
): Promise<{ rateProviderAddress: string; rateDecimals: number }> {
  if (assetConfig.rateProvider && isUsableAddress(assetConfig.rateProvider)) {
    return {
      rateProviderAddress: assetConfig.rateProvider,
      rateDecimals: assetConfig.rateDecimals ?? 18,
    };
  }

  const deploymentId = assetConfig.rateProviderDeploymentId ?? `MockRateProvider_${assetAddress}`;
  const deployment = await hre.deployments.deploy(deploymentId, {
    from: deployer,
    contract: "MockRateProvider",
    args: [],
    log: false,
    autoMine: true,
  });

  const rateProviderAddress = deployment.address;
  const rateDecimals = assetConfig.rateDecimals ?? 18;

  let rateValue: bigint;
  let updatedAt: bigint;

  if (assetConfig.rateFeed && isUsableAddress(assetConfig.rateFeed)) {
    const { answer, updatedAt: feedUpdatedAt, decimals } = await getLatestAnswer(hre, assetConfig.rateFeed);

    rateValue = scaleValue(answer, assetConfig.rateFeedDecimals ?? decimals, rateDecimals);
    updatedAt = feedUpdatedAt;
  } else if (assetConfig.mockRate) {
    const raw = hre.ethers.parseUnits(assetConfig.mockRate.value, assetConfig.mockRate.decimals);
    rateValue = scaleValue(BigInt(raw.toString()), assetConfig.mockRate.decimals, rateDecimals);
    const latestBlock = await hre.ethers.provider.getBlock("latest");
    const baseTimestamp = BigInt(latestBlock?.timestamp ?? Math.floor(Date.now() / 1000));
    const offset = BigInt(assetConfig.mockRate.updatedAtOffsetSeconds ?? 0);
    updatedAt = baseTimestamp + offset;
  } else {
    throw new Error(`Composite asset ${assetAddress} missing rateFeed or mockRate configuration`);
  }

  if (rateValue <= 0n) {
    throw new Error(`Composite asset ${assetAddress} produced non-positive rate value`);
  }

  if (updatedAt === 0n) {
    const latestBlock = await hre.ethers.provider.getBlock("latest");
    updatedAt = BigInt(latestBlock?.timestamp ?? Math.floor(Date.now() / 1000));
  }

  const signer = await hre.ethers.getSigner(deployer);
  const rateProvider = await hre.ethers.getContractAt("MockRateProvider", rateProviderAddress, signer);
  await (await rateProvider.setRate(rateValue, updatedAt)).wait();

  return {
    rateProviderAddress,
    rateDecimals,
  };
}

/**
 * Fetches the decimals configured for an on-chain Chainlink-style feed.
 *
 * @param hre Hardhat runtime environment
 * @param feedAddress Address of the feed
 */
async function getAggregatorDecimals(hre: HardhatRuntimeEnvironment, feedAddress: string): Promise<number> {
  const feed = await hre.ethers.getContractAt("AggregatorV3Interface", feedAddress);
  return Number(await feed.decimals());
}

/**
 * Retrieves the latest answer and timestamp from a Chainlink-style feed.
 *
 * @param hre Hardhat runtime environment
 * @param feedAddress Address of the feed
 */
async function getLatestAnswer(
  hre: HardhatRuntimeEnvironment,
  feedAddress: string,
): Promise<{ answer: bigint; updatedAt: bigint; decimals: number }> {
  const feed = await hre.ethers.getContractAt("AggregatorV3Interface", feedAddress);
  const decimals = Number(await feed.decimals());
  const latest = await feed.latestRoundData();
  return {
    answer: BigInt(latest.answer),
    updatedAt: BigInt(latest.updatedAt),
    decimals,
  };
}

/**
 * Scales a value from one decimal precision to another.
 *
 * @param value Numeric value expressed with `fromDecimals`
 * @param fromDecimals Current decimal precision
 * @param toDecimals Target decimal precision
 */
function scaleValue(value: bigint, fromDecimals: number, toDecimals: number): bigint {
  if (fromDecimals === toDecimals) {
    return value;
  }

  if (fromDecimals < toDecimals) {
    const factor = 10n ** BigInt(toDecimals - fromDecimals);
    return value * factor;
  }
  const divisor = 10n ** BigInt(fromDecimals - toDecimals);
  return value / divisor;
}

/**
 * Resolves the Chainlink feed for an asset, deploying a mock feed when configured to do so.
 *
 * @param hre Hardhat runtime environment
 * @param deployer Deployer address used for mock deployment
 * @param assetAddress Asset identifier being configured
 * @param assetConfig Chainlink configuration for the asset
 * @param cache Cache of previously deployed mocks
 */
async function ensureChainlinkFeed(
  hre: HardhatRuntimeEnvironment,
  deployer: string,
  assetAddress: string,
  assetConfig: ChainlinkFeedAssetConfig,
  cache: Map<string, string>,
): Promise<string> {
  if (assetConfig.feed && isUsableAddress(assetConfig.feed)) {
    return assetConfig.feed;
  }

  if (!assetConfig.mock) {
    throw new Error(`Chainlink asset ${assetAddress} missing mock configuration`);
  }

  const mockId = assetConfig.mock.id ?? `chainlink-${assetAddress}`;
  const cacheKey = `chainlink:${mockId}`;

  if (cache.has(cacheKey)) {
    return cache.get(cacheKey)!;
  }

  const deploymentName = `MockChainlinkAggregatorV3_${mockId}`;
  const description = assetConfig.mock.description ?? mockId;

  const deployment = await hre.deployments.deploy(deploymentName, {
    from: deployer,
    contract: "MockChainlinkAggregatorV3",
    args: [assetConfig.mock.decimals, description],
    log: false,
    autoMine: true,
  });

  const feed = await hre.ethers.getContractAt("MockChainlinkAggregatorV3", deployment.address, await hre.ethers.getSigner(deployer));

  const answer = hre.ethers.parseUnits(assetConfig.mock.value, assetConfig.mock.decimals);

  if (assetConfig.mock.timestampOffsetSeconds !== undefined) {
    const timestamp = BigInt(Math.floor(Date.now() / 1000) + assetConfig.mock.timestampOffsetSeconds);
    await (await feed.setMockWithTimestamp(answer, timestamp)).wait();
  } else {
    await (await feed.setMock(answer)).wait();
  }

  cache.set(cacheKey, deployment.address);
  return deployment.address;
}

/**
 * Checks whether the supplied string is a valid non-zero Ethereum address.
 *
 * @param value Value to validate
 */
function isUsableAddress(value: string | undefined): value is string {
  if (!value) {
    return false;
  }
  const normalized = value.toLowerCase();
  const isHexAddress = normalized.startsWith("0x") && normalized.length === 42;

  if (!isHexAddress) {
    return false;
  }
  return normalized !== ZeroAddress.toLowerCase();
}

func.tags = ["local-setup", "dlend", "usd-oracle", "oracle-wrappers"];
func.dependencies = [DUSD_TOKEN_ID, DETH_TOKEN_ID];
func.id = "setup-usd-oracle-wrappers-v1_1";

export default func;
