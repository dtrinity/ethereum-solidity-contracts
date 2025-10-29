import { ZeroAddress } from "ethers";
import { HardhatRuntimeEnvironment } from "hardhat/types";
import { DeployFunction } from "hardhat-deploy/types";

import { getConfig } from "../../config/config";
import { DUSD_HARD_PEG_ORACLE_WRAPPER_ID, DUSD_TOKEN_ID, USD_ORACLE_AGGREGATOR_ID } from "../../typescript/deploy-ids";
import { DEFAULT_ORACLE_HEARTBEAT_SECONDS, ORACLE_AGGREGATOR_BASE_CURRENCY_UNIT } from "../../typescript/oracle_aggregator/constants";

const func: DeployFunction = async function (hre: HardhatRuntimeEnvironment): Promise<boolean> {
  const { deployments, ethers, getNamedAccounts } = hre;
  const { deploy } = deployments;
  const { deployer } = await getNamedAccounts();
  const signer = await ethers.getSigner(deployer);

  const config = await getConfig(hre);
  const dusdAddress = config.tokenAddresses.dUSD;
  const baseCurrency = config.oracleAggregators.USD.baseCurrency ?? ZeroAddress;
  const pegValue = config.oracleAggregators.USD.hardDStablePeg ?? ORACLE_AGGREGATOR_BASE_CURRENCY_UNIT;

  if (!isUsableAddress(dusdAddress)) {
    console.log(
      `🔮 ${__filename.split("/").slice(-2).join("/")}: skipping – dUSD address unavailable in configuration (${dusdAddress ?? "undefined"})`,
    );
    return true;
  }

  const hardPegDeployment = await deploy(DUSD_HARD_PEG_ORACLE_WRAPPER_ID, {
    from: deployer,
    contract: "HardPegOracleWrapperV1_1",
    args: [baseCurrency, ORACLE_AGGREGATOR_BASE_CURRENCY_UNIT, deployer],
    log: true,
    autoMine: true,
  });

  const hardPegWrapper = await ethers.getContractAt("HardPegOracleWrapperV1_1", hardPegDeployment.address, signer);

  await ensurePegConfigured(hardPegWrapper, baseCurrency, pegValue);
  await ensurePegConfigured(hardPegWrapper, dusdAddress, pegValue);

  const oracleDeployment = await deployments.get(USD_ORACLE_AGGREGATOR_ID);
  const oracleAggregator = await ethers.getContractAt("OracleAggregatorV1_1", oracleDeployment.address, signer);

  const oracleManagerRole = await oracleAggregator.ORACLE_MANAGER_ROLE();
  const deployerHasRole = await oracleAggregator.hasRole(oracleManagerRole, deployer);

  if (!deployerHasRole) {
    console.log(
      `  ⚠️  Deployer lacks ORACLE_MANAGER_ROLE on USD oracle aggregator. ` +
        `Grant the role or configure ${dusdAddress} manually on ${hardPegDeployment.address}.`,
    );
    return true;
  }

  const assetConfig = await oracleAggregator.getAssetConfig(dusdAddress);
  const currentOracle = assetConfig.oracle;

  if (currentOracle.toLowerCase() !== hardPegDeployment.address.toLowerCase()) {
    const tx = await oracleAggregator.setOracle(dusdAddress, hardPegDeployment.address);
    await tx.wait();
    console.log(`  ✅ Routed dUSD oracle to HardPeg wrapper ${hardPegDeployment.address}`);
  } else {
    console.log(`  ✅ dUSD oracle already points to HardPeg wrapper ${hardPegDeployment.address}`);
  }

  await ensureRiskConfig(oracleAggregator, dusdAddress, assetConfig);

  try {
    await (await oracleAggregator.updateLastGoodPrice(dusdAddress)).wait();
  } catch (error) {
    console.warn(`   ⚠️  Unable to prime last good price for dUSD: ${(error as Error).message}`);
  }

  console.log(`🔮 ${__filename.split("/").slice(-2).join("/")}: ✅`);
  return true;
};

/**
 * Ensures the hard peg wrapper stores the expected configuration for a specific asset.
 *
 * @param wrapper Hard peg wrapper contract instance
 * @param asset Asset address to configure
 * @param pegValue Target peg expressed in base currency units
 * @param lowerGuard Optional lower guard rail defining minimum allowed peg
 * @param upperGuard Optional upper guard rail defining maximum allowed peg
 */
async function ensurePegConfigured(
  wrapper: any,
  asset: string,
  pegValue: bigint,
  lowerGuard: bigint = 0n,
  upperGuard: bigint = 0n,
): Promise<void> {
  if (!isUsableAddress(asset) && asset !== ZeroAddress) {
    return;
  }

  let currentPeg;

  try {
    currentPeg = await wrapper.pegConfig(asset);
  } catch {
    currentPeg = undefined;
  }

  const needsUpdate =
    !currentPeg ||
    !currentPeg.exists ||
    currentPeg.pricePeg !== pegValue ||
    currentPeg.lowerGuard !== lowerGuard ||
    currentPeg.upperGuard !== upperGuard;

  if (needsUpdate) {
    const tx = await wrapper.configurePeg(asset, pegValue, lowerGuard, upperGuard);
    await tx.wait();
    console.log(`  ✅ Configured hard peg for ${asset} at ${pegValue.toString()}`);
  }
}

/**
 * Aligns the aggregator risk configuration with sensible defaults for pegged assets.
 *
 * @param oracleAggregator Oracle aggregator contract instance
 * @param asset Asset address being configured
 * @param existingConfig Snapshot of the current on-chain configuration
 */
async function ensureRiskConfig(oracleAggregator: any, asset: string, existingConfig: any): Promise<void> {
  const targetHeartbeat = DEFAULT_ORACLE_HEARTBEAT_SECONDS;
  const targetMaxDeviation = 50;

  const currentHeartbeat = existingConfig.risk.exists ? Number(existingConfig.risk.heartbeat) : 0;
  const currentMaxDeviation = existingConfig.risk.exists ? Number(existingConfig.risk.maxDeviationBps) : 0;
  const currentMaxStaleTime = existingConfig.risk.exists ? Number(existingConfig.risk.maxStaleTime) : 0;
  const currentMinAnswer = existingConfig.risk.exists ? existingConfig.risk.minAnswer : 0n;
  const currentMaxAnswer = existingConfig.risk.exists ? existingConfig.risk.maxAnswer : 0n;

  if (currentHeartbeat === targetHeartbeat && currentMaxDeviation === targetMaxDeviation) {
    return;
  }

  const tx = await oracleAggregator.updateAssetRiskConfig(
    asset,
    currentMaxStaleTime,
    targetHeartbeat,
    targetMaxDeviation,
    currentMinAnswer,
    currentMaxAnswer,
  );
  await tx.wait();
  console.log(`  ✅ Updated risk config for ${asset} (heartbeat=${targetHeartbeat}s, maxDeviation=${targetMaxDeviation}bps)`);
}

/**
 * Determines whether the provided value is a usable non-zero Ethereum address.
 *
 * @param value Value under test
 * @returns True when the value resembles a non-zero address, false otherwise
 */
function isUsableAddress(value: string | undefined): value is string {
  if (!value) {
    return false;
  }
  const normalized = value.toLowerCase();
  return normalized.startsWith("0x") && normalized.length === 42 && normalized !== ZeroAddress.toLowerCase();
}

func.tags = ["dusd", "oracle-hard-peg"];
func.dependencies = [
  "deploy-usd-oracle-aggregator",
  "setup-usd-oracle-wrappers-v1_1",
  "point-usd-aggregator-to-wrappers-v1_1",
  DUSD_TOKEN_ID,
];
func.id = DUSD_HARD_PEG_ORACLE_WRAPPER_ID;

export default func;
