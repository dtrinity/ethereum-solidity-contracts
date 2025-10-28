import { ZeroAddress } from "ethers";
import { HardhatRuntimeEnvironment } from "hardhat/types";
import { DeployFunction } from "hardhat-deploy/types";

import { getConfig } from "../../config/config";
import { ChainlinkFeedAssetConfig, HardPegAssetConfig, OracleAggregatorConfig, OracleWrapperDeploymentConfig } from "../../config/types";
import { DETH_TOKEN_ID } from "../../typescript/deploy-ids";
import { DEFAULT_ORACLE_HEARTBEAT_SECONDS, ORACLE_AGGREGATOR_BASE_CURRENCY_UNIT } from "../../typescript/oracle_aggregator/constants";

type ChainlinkAssetMap = NonNullable<OracleWrapperDeploymentConfig<ChainlinkFeedAssetConfig>["assets"]>;
type HardPegAssetMap = NonNullable<OracleWrapperDeploymentConfig<HardPegAssetConfig>["assets"]>;

const func: DeployFunction = async function (hre: HardhatRuntimeEnvironment): Promise<boolean> {
  const { deployer } = await hre.getNamedAccounts();
  const signer = await hre.ethers.getSigner(deployer);

  const config = await getConfig(hre);
  const oracleConfig = config.oracleAggregators.ETH;

  // Keep the deployer as the initial admin; governance migration happens manually post-deploy.
  await deployChainlinkWrapper(hre, oracleConfig, deployer, signer);
  await deployApi3Wrapper(hre, oracleConfig, deployer);
  await deployCompositeWrapper(hre, oracleConfig, deployer);
  await deployHardPegWrapper(hre, oracleConfig, deployer);

  console.log(`🔮 ${__filename.split("/").slice(-2).join("/")}: ✅`);
  return true;
};

/**
 * Deploys the Chainlink wrapper contract and configures feeds with the deployer retaining admin control.
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

  const baseCurrency = oracleConfig.baseCurrency || ZeroAddress;

  const deployment = await hre.deployments.deploy(wrapperConfig.deploymentId, {
    from: deployer,
    contract: "ChainlinkFeedWrapperV1_1",
    args: [baseCurrency, ORACLE_AGGREGATOR_BASE_CURRENCY_UNIT, deployer],
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
 * Deploys the API3 wrapper contract and leaves the deployer as the temporary admin.
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

  const baseCurrency = oracleConfig.baseCurrency || ZeroAddress;

  await hre.deployments.deploy(wrapperConfig.deploymentId, {
    from: deployer,
    contract: "API3WrapperV1_1",
    args: [baseCurrency, ORACLE_AGGREGATOR_BASE_CURRENCY_UNIT, deployer],
    log: true,
    autoMine: true,
  });

  // TODO: populate API3 proxy configuration when assets are defined.
}

/**
 * Deploys the composite wrapper contract with the deployer controlling administration.
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
  const assets = wrapperConfig?.assets || {};

  if (!wrapperConfig || Object.keys(assets).length === 0) {
    return;
  }

  const baseCurrency = oracleConfig.baseCurrency || ZeroAddress;

  await hre.deployments.deploy(wrapperConfig.deploymentId, {
    from: deployer,
    contract: "ChainlinkRateCompositeWrapperV1_1",
    args: [baseCurrency, ORACLE_AGGREGATOR_BASE_CURRENCY_UNIT, deployer],
    log: true,
    autoMine: true,
  });

  // TODO: wire composite feeds once configuration is provided.
}

/**
 * Deploys the hard peg wrapper and configures static prices for supported assets.
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

  const baseCurrency = oracleConfig.baseCurrency || ZeroAddress;

  const deployment = await hre.deployments.deploy(wrapperConfig.deploymentId, {
    from: deployer,
    contract: "HardPegOracleWrapperV1_1",
    args: [baseCurrency, ORACLE_AGGREGATOR_BASE_CURRENCY_UNIT, deployer],
    log: true,
    autoMine: true,
  });

  const wrapper = await hre.ethers.getContractAt("HardPegOracleWrapperV1_1", deployment.address, await hre.ethers.getSigner(deployer));

  for (const [assetAddress, assetConfig] of Object.entries(assets)) {
    if (!isUsableAddress(assetAddress)) {
      continue;
    }

    await (
      await wrapper.configurePeg(assetAddress, assetConfig.pricePeg, assetConfig.lowerGuard ?? 0n, assetConfig.upperGuard ?? 0n)
    ).wait();
  }
}

/**
 * Resolves the Chainlink feed address for an asset, deploying a mock when requested.
 *
 * @param hre Hardhat runtime environment
 * @param deployer Deployer address used for deploying mocks
 * @param assetAddress Asset identifier being configured
 * @param assetConfig Chainlink feed configuration for the asset
 * @param cache Cache of previously deployed mocks to avoid duplicates
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
 * Checks whether a provided string is a valid non-zero Ethereum address.
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

func.tags = ["local-setup", "dlend", "eth-oracle", "oracle-wrappers"];
func.dependencies = [DETH_TOKEN_ID];
func.id = "setup-eth-oracle-wrappers-v1_1";

export default func;
