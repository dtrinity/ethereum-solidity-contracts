import { ZeroAddress } from "ethers";
import { HardhatRuntimeEnvironment } from "hardhat/types";
import { DeployFunction } from "hardhat-deploy/types";

import { getConfig } from "../../config/config";
import { Config } from "../../config/types";
import type { OracleAggregatorV1_1 } from "../../typechain-types";
import {
  DETH_TOKEN_ID,
  DUSD_TOKEN_ID,
  USD_API3_COMPOSITE_WRAPPER_WITH_THRESHOLDING_ID,
  USD_API3_ORACLE_WRAPPER_ID,
  USD_API3_WRAPPER_WITH_THRESHOLDING_ID,
  USD_ORACLE_AGGREGATOR_ID,
  USD_REDSTONE_COMPOSITE_WRAPPER_WITH_THRESHOLDING_ID,
  USD_REDSTONE_ORACLE_WRAPPER_ID,
  USD_REDSTONE_WRAPPER_WITH_THRESHOLDING_ID,
} from "../../typescript/deploy-ids";

type Api3AssetsConfig = Config["oracleAggregators"][string]["api3OracleAssets"];
type RedstoneAssetsConfig = Config["oracleAggregators"][string]["redstoneOracleAssets"];

const func: DeployFunction = async function (hre: HardhatRuntimeEnvironment): Promise<boolean> {
  const { deployer } = await hre.getNamedAccounts();
  const signer = await hre.ethers.getSigner(deployer);

  const config = await getConfig(hre);
  const oracleConfig = config.oracleAggregators.USD;

  const aggregatorDeployment = await hre.deployments.get(USD_ORACLE_AGGREGATOR_ID);
  const aggregator = (await hre.ethers.getContractAt("OracleAggregatorV1_1", aggregatorDeployment.address, signer)) as OracleAggregatorV1_1;

  const api3Assets = oracleConfig.api3OracleAssets;
  const redstoneAssets = oracleConfig.redstoneOracleAssets;

  if (!hasAnyConfiguredAsset(api3Assets, redstoneAssets)) {
    console.log(`🔁 ${__filename.split("/").slice(-2).join("/")}: no USD oracle assets configured – skipping`);
    return true;
  }

  await routeApi3Assets(hre, aggregator, api3Assets);
  await routeRedstoneAssets(hre, aggregator, redstoneAssets);

  console.log(`🔁 ${__filename.split("/").slice(-2).join("/")}: ✅`);
  return true;
};

/**
 *
 * @param hre
 * @param aggregator
 * @param assets
 */
async function routeApi3Assets(hre: HardhatRuntimeEnvironment, aggregator: OracleAggregatorV1_1, assets: Api3AssetsConfig): Promise<void> {
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

/**
 *
 * @param hre
 * @param aggregator
 * @param assets
 */
async function routeRedstoneAssets(
  hre: HardhatRuntimeEnvironment,
  aggregator: OracleAggregatorV1_1,
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
 * @param hre
 * @param deploymentId
 */
async function resolveDeploymentAddress(hre: HardhatRuntimeEnvironment, deploymentId: string): Promise<string> {
  const deployment = await hre.deployments.get(deploymentId);
  return deployment.address;
}

/**
 *
 * @param aggregator
 * @param assetAddress
 * @param wrapperAddress
 */
async function ensureOracleMapping(aggregator: OracleAggregatorV1_1, assetAddress: string, wrapperAddress: string): Promise<void> {
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
 *
 * @param value
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
 *
 * @param api3Assets
 * @param redstoneAssets
 */
function hasAnyConfiguredAsset(api3Assets?: Api3AssetsConfig, redstoneAssets?: RedstoneAssetsConfig): boolean {
  const counts = [
    Object.keys(api3Assets?.plainApi3OracleWrappers ?? {}).length,
    Object.keys(api3Assets?.api3OracleWrappersWithThresholding ?? {}).length,
    Object.keys(api3Assets?.compositeApi3OracleWrappersWithThresholding ?? {}).length,
    Object.keys(redstoneAssets?.plainRedstoneOracleWrappers ?? {}).length,
    Object.keys(redstoneAssets?.redstoneOracleWrappersWithThresholding ?? {}).length,
    Object.keys(redstoneAssets?.compositeRedstoneOracleWrappersWithThresholding ?? {}).length,
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
  USD_REDSTONE_ORACLE_WRAPPER_ID,
  USD_REDSTONE_WRAPPER_WITH_THRESHOLDING_ID,
  USD_REDSTONE_COMPOSITE_WRAPPER_WITH_THRESHOLDING_ID,
];
func.id = "point-usd-aggregator-to-wrappers-v1_1";

export default func;
