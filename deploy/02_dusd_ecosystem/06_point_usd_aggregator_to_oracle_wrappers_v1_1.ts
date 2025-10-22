import { ZeroAddress } from "ethers";
import { HardhatRuntimeEnvironment } from "hardhat/types";
import { DeployFunction } from "hardhat-deploy/types";

import { getConfig } from "../../config/config";
import { DETH_TOKEN_ID, DUSD_TOKEN_ID, USD_ORACLE_AGGREGATOR_ID } from "../../typescript/deploy-ids";
import { DEFAULT_ORACLE_HEARTBEAT_SECONDS } from "../../typescript/oracle_aggregator/constants";

const func: DeployFunction = async function (hre: HardhatRuntimeEnvironment): Promise<boolean> {
  const { deployer } = await hre.getNamedAccounts();
  const signer = await hre.ethers.getSigner(deployer);

  const config = await getConfig(hre);
  const oracleConfig = config.oracleAggregators.USD;
  const assets = oracleConfig.assets || {};

  if (Object.keys(assets).length === 0) {
    console.log(`🔁 ${__filename.split("/").slice(-2).join("/")}: no USD oracle assets configured – skipping`);
    return true;
  }

  const aggregatorDeployment = await hre.deployments.get(USD_ORACLE_AGGREGATOR_ID);
  const aggregator = await hre.ethers.getContractAt("OracleAggregatorV1_1", aggregatorDeployment.address, signer);

  for (const [assetAddress, routing] of Object.entries(assets)) {
    const isZeroAddress = assetAddress.toLowerCase() === ZeroAddress.toLowerCase();

    if (!isZeroAddress && !isUsableAddress(assetAddress)) {
      continue;
    }

    const primaryWrapperAddress = await resolveWrapperAddress(hre, routing.primaryWrapperId);
    const fallbackWrapperAddress = routing.fallbackWrapperId ? await resolveWrapperAddress(hre, routing.fallbackWrapperId) : ZeroAddress;

    const heartbeatOverrideSeconds =
      typeof routing.risk?.heartbeatOverride === "number" && routing.risk.heartbeatOverride > 0
        ? routing.risk.heartbeatOverride
        : DEFAULT_ORACLE_HEARTBEAT_SECONDS;

    await (
      await aggregator.configureAsset(
        assetAddress,
        primaryWrapperAddress,
        fallbackWrapperAddress,
        routing.risk?.maxStaleTime ?? 0,
        heartbeatOverrideSeconds,
        routing.risk?.maxDeviationBps ?? 0,
        routing.risk?.minAnswer ?? 0n,
        routing.risk?.maxAnswer ?? 0n,
      )
    ).wait();

    try {
      await (await aggregator.updateLastGoodPrice(assetAddress)).wait();
    } catch (error) {
      console.warn(`   ⚠️  Unable to prime last good price for ${assetAddress}: ${(error as Error).message}`);
    }
  }

  console.log(`🔁 ${__filename.split("/").slice(-2).join("/")}: ✅`);
  return true;
};

/**
 * Resolves a deployment id to its deployed address.
 *
 * @param hre Hardhat runtime environment
 * @param deploymentId Deployment identifier to resolve
 */
async function resolveWrapperAddress(hre: HardhatRuntimeEnvironment, deploymentId: string): Promise<string> {
  if (!deploymentId) {
    throw new Error("Wrapper deployment id missing in oracle configuration");
  }
  const deployment = await hre.deployments.get(deploymentId);
  return deployment.address;
}

/**
 * Checks whether a provided string is a valid non-zero Ethereum address.
 *
 * @param value Address candidate to validate
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

func.tags = ["local-setup", "dlend", "usd-oracle", "oracle-routing"];
func.dependencies = ["deploy-usd-oracle-aggregator", "setup-usd-oracle-wrappers-v1_1", DUSD_TOKEN_ID, DETH_TOKEN_ID];
func.id = "point-usd-aggregator-to-wrappers-v1_1";

export default func;
