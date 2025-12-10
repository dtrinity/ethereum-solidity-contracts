import { ZeroAddress } from "ethers";
import { HardhatRuntimeEnvironment } from "hardhat/types";
import { DeployFunction } from "hardhat-deploy/types";

import { getConfig } from "../../config/config";
import { Config } from "../../config/types";
import type { OracleAggregatorV1_1 as OracleAggregatorV11 } from "../../typechain-types";
import {
  DETH_TOKEN_ID,
  DUSD_TOKEN_ID,
  USD_API3_COMPOSITE_WRAPPER_WITH_THRESHOLDING_ID,
  USD_API3_ORACLE_WRAPPER_ID,
  USD_API3_WRAPPER_WITH_THRESHOLDING_ID,
  USD_CHAINLINK_ERC4626_WRAPPER_ID,
  USD_ORACLE_AGGREGATOR_ID,
  USD_REDSTONE_COMPOSITE_WRAPPER_WITH_THRESHOLDING_ID,
  USD_REDSTONE_ORACLE_WRAPPER_ID,
  USD_REDSTONE_WRAPPER_WITH_THRESHOLDING_ID,
} from "../../typescript/deploy-ids";

type Api3AssetsConfig = Config["oracleAggregators"][string]["api3OracleAssets"];
type RedstoneAssetsConfig = Config["oracleAggregators"][string]["redstoneOracleAssets"];
type ChainlinkErc4626AssetsConfig = Config["oracleAggregators"][string]["chainlinkErc4626OracleAssets"];

const func: DeployFunction = async function (hre: HardhatRuntimeEnvironment): Promise<boolean> {
  const { deployer } = await hre.getNamedAccounts();
  const signer = await hre.ethers.getSigner(deployer);

  const config = await getConfig(hre);
  const oracleConfig = config.oracleAggregators.USD;

  const aggregatorDeployment = await hre.deployments.get(USD_ORACLE_AGGREGATOR_ID);
  const aggregator = (await hre.ethers.getContractAt("OracleAggregatorV1_1", aggregatorDeployment.address, signer)) as OracleAggregatorV11;

  const api3Assets = oracleConfig.api3OracleAssets;
  const redstoneAssets = oracleConfig.redstoneOracleAssets;
  const chainlinkErc4626Assets = oracleConfig.chainlinkErc4626OracleAssets;

  if (!hasAnyConfiguredAsset(api3Assets, redstoneAssets, chainlinkErc4626Assets)) {
    console.log(`🔁 ${__filename.split("/").slice(-2).join("/")}: no USD oracle assets configured – skipping`);
    return true;
  }

  await routeApi3Assets(hre, aggregator, api3Assets);
  await routeRedstoneAssets(hre, aggregator, redstoneAssets);
  await routeChainlinkErc4626Assets(hre, aggregator, chainlinkErc4626Assets);

  console.log(`🔁 ${__filename.split("/").slice(-2).join("/")}: ✅`);
  return true;
};

/**
 *
 *Routes every API3-backed asset to the appropriate wrapper address on the aggregator.
 *
 * @param hre Hardhat runtime used for deployment lookups.
 * @param aggregator Oracle aggregator instance to configure.
 * @param assets Configuration for all API3 feeds supported by the network.
 */
async function routeApi3Assets(hre: HardhatRuntimeEnvironment, aggregator: OracleAggregatorV11, assets: Api3AssetsConfig): Promise<void> {
  if (!assets) {
    return;
  }

  const plain = assets.plainApi3OracleWrappers ?? {};

  if (Object.keys(plain).length > 0) {
    const wrapperAddress = await resolveDeploymentAddress(hre, USD_API3_ORACLE_WRAPPER_ID);

    for (const assetAddress of Object.keys(plain)) {
      await ensureOracleMapping(aggregator, assetAddress, wrapperAddress);
    }
  }

  const thresholded = assets.api3OracleWrappersWithThresholding ?? {};

  if (Object.keys(thresholded).length > 0) {
    const wrapperAddress = await resolveDeploymentAddress(hre, USD_API3_WRAPPER_WITH_THRESHOLDING_ID);

    for (const assetAddress of Object.keys(thresholded)) {
      await ensureOracleMapping(aggregator, assetAddress, wrapperAddress);
    }
  }

  const composite = assets.compositeApi3OracleWrappersWithThresholding ?? {};

  if (Object.keys(composite).length > 0) {
    const wrapperAddress = await resolveDeploymentAddress(hre, USD_API3_COMPOSITE_WRAPPER_WITH_THRESHOLDING_ID);

    for (const feedConfig of Object.values(composite)) {
      const feedAsset = (feedConfig as { feedAsset: string }).feedAsset;
      await ensureOracleMapping(aggregator, feedAsset, wrapperAddress);
    }
  }
}

async function routeChainlinkErc4626Assets(
  hre: HardhatRuntimeEnvironment,
  aggregator: OracleAggregatorV11,
  assets?: ChainlinkErc4626AssetsConfig,
): Promise<void> {
  if (!assets || Object.keys(assets).length === 0) {
    return;
  }

  const wrapperAddress = await resolveDeploymentAddress(hre, USD_CHAINLINK_ERC4626_WRAPPER_ID);

  for (const asset of Object.keys(assets)) {
    await ensureOracleMapping(aggregator, asset, wrapperAddress);
  }
}

/**
 *
 *Routes every Redstone-backed asset to the appropriate wrapper address on the aggregator.
 *
 * @param hre Hardhat runtime used for deployment lookups.
 * @param aggregator Oracle aggregator instance to configure.
 * @param assets Configuration for all Redstone feeds supported by the network.
 */
async function routeRedstoneAssets(
  hre: HardhatRuntimeEnvironment,
  aggregator: OracleAggregatorV11,
  assets: RedstoneAssetsConfig,
): Promise<void> {
  if (!assets) {
    return;
  }

  const plain = assets.plainRedstoneOracleWrappers ?? {};

  if (Object.keys(plain).length > 0) {
    const wrapperAddress = await resolveDeploymentAddress(hre, USD_REDSTONE_ORACLE_WRAPPER_ID);

    for (const assetAddress of Object.keys(plain)) {
      await ensureOracleMapping(aggregator, assetAddress, wrapperAddress);
    }
  }

  const thresholded = assets.redstoneOracleWrappersWithThresholding ?? {};

  if (Object.keys(thresholded).length > 0) {
    const wrapperAddress = await resolveDeploymentAddress(hre, USD_REDSTONE_WRAPPER_WITH_THRESHOLDING_ID);

    for (const assetAddress of Object.keys(thresholded)) {
      await ensureOracleMapping(aggregator, assetAddress, wrapperAddress);
    }
  }

  const composite = assets.compositeRedstoneOracleWrappersWithThresholding ?? {};

  if (Object.keys(composite).length > 0) {
    const wrapperAddress = await resolveDeploymentAddress(hre, USD_REDSTONE_COMPOSITE_WRAPPER_WITH_THRESHOLDING_ID);

    for (const feedConfig of Object.values(composite)) {
      const feedAsset = (feedConfig as { feedAsset: string }).feedAsset;
      await ensureOracleMapping(aggregator, feedAsset, wrapperAddress);
    }
  }
}

/**
 *
 *Resolves a deployment id to the live contract address.
 *
 * @param hre Hardhat runtime used to query hardhat-deploy artifacts.
 * @param deploymentId Identifier of the deployment to resolve.
 */
async function resolveDeploymentAddress(hre: HardhatRuntimeEnvironment, deploymentId: string): Promise<string> {
  const deployment = await hre.deployments.get(deploymentId);
  return deployment.address;
}

/**
 *
 *Ensures an asset points to the desired wrapper on the aggregator, updating it if needed.
 *
 * @param aggregator Oracle aggregator instance to mutate.
 * @param assetAddress Collateral address whose oracle should be configured.
 * @param wrapperAddress Wrapper contract that should serve the price.
 */
async function ensureOracleMapping(aggregator: OracleAggregatorV11, assetAddress: string, wrapperAddress: string): Promise<void> {
  if (!isUsableAddress(assetAddress)) {
    return;
  }

  const current = await aggregator.assetOracles(assetAddress);

  if (current.toLowerCase() === wrapperAddress.toLowerCase()) {
    return;
  }

  await (await aggregator.setOracle(assetAddress, wrapperAddress)).wait();
  console.log(`   ✅ Routed ${assetAddress} to wrapper ${wrapperAddress}`);
}

/**
 * Determines if a provided value is a usable, non-zero Ethereum address.
 *
 * @param value String candidate to validate.
 */
function isUsableAddress(value: string | undefined): value is string {
  if (!value) {
    return false;
  }
  const normalized = value.toLowerCase();
  const isHexAddress = normalized.startsWith("0x") && normalized.length === 42;
  return isHexAddress && normalized !== ZeroAddress.toLowerCase();
}

/**
 * Checks whether any API3 or Redstone assets are configured for deployment.
 *
 * @param api3Assets API3 asset configuration block.
 * @param redstoneAssets Redstone asset configuration block.
 */
function hasAnyConfiguredAsset(
  api3Assets?: Api3AssetsConfig,
  redstoneAssets?: RedstoneAssetsConfig,
  chainlinkErc4626Assets?: ChainlinkErc4626AssetsConfig,
): boolean {
  const counts = [
    Object.keys(api3Assets?.plainApi3OracleWrappers ?? {}).length,
    Object.keys(api3Assets?.api3OracleWrappersWithThresholding ?? {}).length,
    Object.keys(api3Assets?.compositeApi3OracleWrappersWithThresholding ?? {}).length,
    Object.keys(redstoneAssets?.plainRedstoneOracleWrappers ?? {}).length,
    Object.keys(redstoneAssets?.redstoneOracleWrappersWithThresholding ?? {}).length,
    Object.keys(redstoneAssets?.compositeRedstoneOracleWrappersWithThresholding ?? {}).length,
    Object.keys(chainlinkErc4626Assets ?? {}).length,
  ];
  return counts.some((count) => count > 0);
}

func.tags = ["local-setup", "dlend", "usd-oracle", "oracle-routing"];
func.dependencies = [
  "deploy-usd-oracle-aggregator",
  "setup-usd-oracle-wrappers-v1_1",
  DUSD_TOKEN_ID,
  DETH_TOKEN_ID,
  USD_API3_ORACLE_WRAPPER_ID,
  USD_API3_WRAPPER_WITH_THRESHOLDING_ID,
  USD_API3_COMPOSITE_WRAPPER_WITH_THRESHOLDING_ID,
  USD_CHAINLINK_ERC4626_WRAPPER_ID,
  USD_REDSTONE_ORACLE_WRAPPER_ID,
  USD_REDSTONE_WRAPPER_WITH_THRESHOLDING_ID,
  USD_REDSTONE_COMPOSITE_WRAPPER_WITH_THRESHOLDING_ID,
];
func.id = "point-usd-aggregator-to-wrappers-v1_1";

export default func;
