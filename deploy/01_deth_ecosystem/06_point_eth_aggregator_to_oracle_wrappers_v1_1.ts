import { ZeroAddress } from "ethers";
import { HardhatRuntimeEnvironment } from "hardhat/types";
import { DeployFunction } from "hardhat-deploy/types";

import { getConfig } from "../../config/config";
import { Config } from "../../config/types";
import type { OracleAggregatorV1_1 as OracleAggregatorV11 } from "../../typechain-types";
import {
  DETH_TOKEN_ID,
  ETH_API3_COMPOSITE_WRAPPER_WITH_THRESHOLDING_ID,
  ETH_API3_ORACLE_WRAPPER_ID,
  ETH_API3_WRAPPER_WITH_THRESHOLDING_ID,
  ETH_ERC4626_ORACLE_WRAPPER_ID,
  ETH_ORACLE_AGGREGATOR_ID,
  ETH_REDSTONE_COMPOSITE_WRAPPER_WITH_THRESHOLDING_ID,
  ETH_REDSTONE_ORACLE_WRAPPER_ID,
  ETH_REDSTONE_WRAPPER_WITH_THRESHOLDING_ID,
} from "../../typescript/deploy-ids";

type Api3AssetsConfig = Config["oracleAggregators"][string]["api3OracleAssets"];
type RedstoneAssetsConfig = Config["oracleAggregators"][string]["redstoneOracleAssets"];
type Erc4626OracleAssetsConfig = Config["oracleAggregators"][string]["erc4626OracleAssets"];

const func: DeployFunction = async function (hre: HardhatRuntimeEnvironment): Promise<boolean> {
  const { deployer } = await hre.getNamedAccounts();
  const signer = await hre.ethers.getSigner(deployer);

  const config = await getConfig(hre);
  const oracleConfig = config.oracleAggregators.ETH;

  const aggregatorDeployment = await hre.deployments.get(ETH_ORACLE_AGGREGATOR_ID);
  const aggregator = (await hre.ethers.getContractAt("OracleAggregatorV1_1", aggregatorDeployment.address, signer)) as OracleAggregatorV11;

  const api3Assets = oracleConfig.api3OracleAssets;
  const redstoneAssets = oracleConfig.redstoneOracleAssets;
  const erc4626OracleAssets = oracleConfig.erc4626OracleAssets;

  if (!hasAnyConfiguredAsset(api3Assets, redstoneAssets, erc4626OracleAssets)) {
    console.log(`🔁 ${__filename.split("/").slice(-2).join("/")}: no ETH oracle assets configured – skipping`);
    return true;
  }

  await routeApi3Assets(hre, aggregator, api3Assets);
  await routeRedstoneAssets(hre, aggregator, redstoneAssets);
  await routeErc4626OracleAssets(hre, aggregator, erc4626OracleAssets);

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
    const wrapperAddress = await resolveDeploymentAddress(hre, ETH_API3_ORACLE_WRAPPER_ID);

    for (const assetAddress of Object.keys(plain)) {
      await ensureOracleMapping(aggregator, assetAddress, wrapperAddress);
    }
  }

  const thresholded = assets.api3OracleWrappersWithThresholding ?? {};

  if (Object.keys(thresholded).length > 0) {
    const wrapperAddress = await resolveDeploymentAddress(hre, ETH_API3_WRAPPER_WITH_THRESHOLDING_ID);

    for (const assetAddress of Object.keys(thresholded)) {
      await ensureOracleMapping(aggregator, assetAddress, wrapperAddress);
    }
  }

  const composite = assets.compositeApi3OracleWrappersWithThresholding ?? {};

  if (Object.keys(composite).length > 0) {
    const wrapperAddress = await resolveDeploymentAddress(hre, ETH_API3_COMPOSITE_WRAPPER_WITH_THRESHOLDING_ID);

    for (const feedConfig of Object.values(composite)) {
      const feedAsset = (feedConfig as { feedAsset: string }).feedAsset;
      await ensureOracleMapping(aggregator, feedAsset, wrapperAddress);
    }
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
    const wrapperAddress = await resolveDeploymentAddress(hre, ETH_REDSTONE_ORACLE_WRAPPER_ID);

    for (const assetAddress of Object.keys(plain)) {
      await ensureOracleMapping(aggregator, assetAddress, wrapperAddress);
    }
  }

  const thresholded = assets.redstoneOracleWrappersWithThresholding ?? {};

  if (Object.keys(thresholded).length > 0) {
    const wrapperAddress = await resolveDeploymentAddress(hre, ETH_REDSTONE_WRAPPER_WITH_THRESHOLDING_ID);

    for (const assetAddress of Object.keys(thresholded)) {
      await ensureOracleMapping(aggregator, assetAddress, wrapperAddress);
    }
  }

  const composite = assets.compositeRedstoneOracleWrappersWithThresholding ?? {};

  if (Object.keys(composite).length > 0) {
    const wrapperAddress = await resolveDeploymentAddress(hre, ETH_REDSTONE_COMPOSITE_WRAPPER_WITH_THRESHOLDING_ID);

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
 * Routes every ERC4626 oracle asset to the appropriate wrapper address on the aggregator.
 *
 * @param hre Hardhat runtime used for deployment lookups.
 * @param aggregator Oracle aggregator instance to configure.
 * @param assets Configuration for all ERC4626 assets supported by the network.
 */
async function routeErc4626OracleAssets(
  hre: HardhatRuntimeEnvironment,
  aggregator: OracleAggregatorV11,
  assets?: Erc4626OracleAssetsConfig,
): Promise<void> {
  if (!assets || Object.keys(assets).length === 0) {
    return;
  }

  const wrapperAddress = await resolveDeploymentAddress(hre, ETH_ERC4626_ORACLE_WRAPPER_ID);

  for (const assetAddress of Object.keys(assets)) {
    await ensureOracleMapping(aggregator, assetAddress, wrapperAddress);
  }
}

/**
 * Checks whether any API3, Redstone, or ERC4626 assets are configured for deployment.
 *
 * @param api3Assets API3 asset configuration block.
 * @param redstoneAssets Redstone asset configuration block.
 * @param erc4626OracleAssets ERC4626 oracle asset configuration block.
 */
function hasAnyConfiguredAsset(
  api3Assets?: Api3AssetsConfig,
  redstoneAssets?: RedstoneAssetsConfig,
  erc4626OracleAssets?: Erc4626OracleAssetsConfig,
): boolean {
  const counts = [
    Object.keys(api3Assets?.plainApi3OracleWrappers ?? {}).length,
    Object.keys(api3Assets?.api3OracleWrappersWithThresholding ?? {}).length,
    Object.keys(api3Assets?.compositeApi3OracleWrappersWithThresholding ?? {}).length,
    Object.keys(redstoneAssets?.plainRedstoneOracleWrappers ?? {}).length,
    Object.keys(redstoneAssets?.redstoneOracleWrappersWithThresholding ?? {}).length,
    Object.keys(redstoneAssets?.compositeRedstoneOracleWrappersWithThresholding ?? {}).length,
    Object.keys(erc4626OracleAssets ?? {}).length,
  ];
  return counts.some((count) => count > 0);
}

func.tags = ["local-setup", "dlend", "eth-oracle", "oracle-routing"];
func.dependencies = [
  ETH_ORACLE_AGGREGATOR_ID,
  "setup-eth-oracle-wrappers-v1_1",
  "deploy-eth-erc4626-wrapper",
  DETH_TOKEN_ID,
  ETH_API3_ORACLE_WRAPPER_ID,
  ETH_API3_WRAPPER_WITH_THRESHOLDING_ID,
  ETH_API3_COMPOSITE_WRAPPER_WITH_THRESHOLDING_ID,
  ETH_ERC4626_ORACLE_WRAPPER_ID,
  ETH_REDSTONE_ORACLE_WRAPPER_ID,
  ETH_REDSTONE_WRAPPER_WITH_THRESHOLDING_ID,
  ETH_REDSTONE_COMPOSITE_WRAPPER_WITH_THRESHOLDING_ID,
];
func.id = "point-eth-aggregator-to-wrappers-v1_1";

export default func;
