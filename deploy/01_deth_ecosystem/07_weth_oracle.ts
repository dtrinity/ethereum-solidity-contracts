import { ZeroAddress } from "ethers";
import { HardhatRuntimeEnvironment } from "hardhat/types";
import { DeployFunction } from "hardhat-deploy/types";

import { getConfig } from "../../config/config";
import { ETH_ORACLE_AGGREGATOR_ID, USD_ORACLE_AGGREGATOR_ID, WETH_HARD_PEG_ORACLE_WRAPPER_ID } from "../../typescript/deploy-ids";
import { DEFAULT_ORACLE_HEARTBEAT_SECONDS, ORACLE_AGGREGATOR_BASE_CURRENCY_UNIT } from "../../typescript/oracle_aggregator/constants";

const func: DeployFunction = async function (hre: HardhatRuntimeEnvironment): Promise<boolean> {
  const { deployments, ethers, getNamedAccounts } = hre;
  const { deployer } = await getNamedAccounts();
  const signer = await ethers.getSigner(deployer);

  const config = await getConfig(hre);
  const wethAddress = config.tokenAddresses.WETH;
  const ethBaseCurrency = config.oracleAggregators.ETH.baseCurrency;

  if (!isUsableAddress(wethAddress)) {
    throw new Error(`WETH address missing from configuration: ${wethAddress ?? "undefined"}`);
  }

  if (!isUsableAddress(ethBaseCurrency)) {
    throw new Error(`ETH oracle base currency is invalid: ${ethBaseCurrency ?? "undefined"}`);
  }

  const usdOracleDeployment = await deployments.getOrNull(USD_ORACLE_AGGREGATOR_ID);

  if (!usdOracleDeployment) {
    console.log(`🔁 ${__filename.split("/").slice(-2).join("/")}: ⏭️  (skipping – USD oracle aggregator not deployed in current fixture)`);
    return true;
  }

  const hardPegDeployment = await deployments.deploy(WETH_HARD_PEG_ORACLE_WRAPPER_ID, {
    from: deployer,
    contract: "HardPegOracleWrapperV1_1",
    args: [ethBaseCurrency, ORACLE_AGGREGATOR_BASE_CURRENCY_UNIT, deployer],
    log: true,
    autoMine: true,
  });

  const hardPegWrapper = await ethers.getContractAt("HardPegOracleWrapperV1_1", hardPegDeployment.address, signer);

  await ensurePegConfigured(hardPegWrapper, ethBaseCurrency, ORACLE_AGGREGATOR_BASE_CURRENCY_UNIT);
  await ensurePegConfigured(hardPegWrapper, wethAddress, ORACLE_AGGREGATOR_BASE_CURRENCY_UNIT);

  const ethOracleDeployment = await deployments.get(ETH_ORACLE_AGGREGATOR_ID);
  const ethOracle = await ethers.getContractAt("OracleAggregatorV1_1", ethOracleDeployment.address, signer);
  const oracleManagerRole = await ethOracle.ORACLE_MANAGER_ROLE();

  if (!(await ethOracle.hasRole(oracleManagerRole, deployer))) {
    throw new Error(`Deployer lacks ORACLE_MANAGER_ROLE on ETH oracle aggregator ${ethOracleDeployment.address}`);
  }

  const currentConfig = await ethOracle.getAssetConfig(wethAddress);
  const currentOracle = currentConfig.oracle;

  if (currentOracle.toLowerCase() !== hardPegDeployment.address.toLowerCase()) {
    const tx = await ethOracle.setOracle(wethAddress, hardPegDeployment.address);
    await tx.wait();
    console.log(`  ✅ Routed WETH oracle to HardPeg wrapper ${hardPegDeployment.address}`);
  } else {
    console.log(`  ✅ WETH oracle already points to HardPeg wrapper ${hardPegDeployment.address}`);
  }

  await ensureRiskConfig(ethOracle, wethAddress, currentConfig);

  await (await ethOracle.updateLastGoodPrice(wethAddress)).wait();
  console.log(`  ✅ Seeded last good price for WETH on ETH oracle`);

  const usdOracle = await ethers.getContractAt("OracleAggregatorV1_1", usdOracleDeployment.address, signer);
  const usdConfig = await usdOracle.getAssetConfig(wethAddress);

  if (!usdConfig.risk.exists) {
    throw new Error(
      `WETH is not configured on the USD oracle aggregator ${usdOracleDeployment.address}. Ensure the wrapper setup scripts ran successfully.`,
    );
  }

  console.log(`🔁 ${__filename.split("/").slice(-2).join("/")}: ✅`);
  return true;
};

/**
 *
 * @param wrapper
 * @param asset
 * @param pegValue
 * @param lowerGuard
 * @param upperGuard
 */
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

  const currentPeg = await wrapper.pegConfig(asset);
  const needsUpdate =
    !currentPeg.exists || currentPeg.pricePeg !== pegValue || currentPeg.lowerGuard !== lowerGuard || currentPeg.upperGuard !== upperGuard;

  if (needsUpdate) {
    const tx = await wrapper.configurePeg(asset, pegValue, lowerGuard, upperGuard);
    await tx.wait();
    console.log(`  ✅ Configured hard peg for ${asset} at ${pegValue.toString()}`);
  }
}

/**
 *
 * @param oracle
 * @param asset
 * @param existingConfig
 */
/**
 * Aligns the aggregator risk configuration with sensible defaults for pegged assets.
 *
 * @param oracle Oracle aggregator contract instance
 * @param asset Asset address being configured
 * @param existingConfig Snapshot of the current on-chain configuration
 */
async function ensureRiskConfig(oracle: any, asset: string, existingConfig: any): Promise<void> {
  const targetHeartbeat = DEFAULT_ORACLE_HEARTBEAT_SECONDS;
  const targetMaxDeviation = 100; // 1%

  const currentHeartbeat = existingConfig.risk.exists ? Number(existingConfig.risk.heartbeat) : 0;
  const currentMaxDeviation = existingConfig.risk.exists ? Number(existingConfig.risk.maxDeviationBps) : 0;
  const currentMaxStaleTime = existingConfig.risk.exists ? Number(existingConfig.risk.maxStaleTime ?? 0) : 0;
  const currentMinAnswer = existingConfig.risk.exists ? (existingConfig.risk.minAnswer ?? 0n) : 0n;
  const currentMaxAnswer = existingConfig.risk.exists ? (existingConfig.risk.maxAnswer ?? 0n) : 0n;

  if (currentHeartbeat === targetHeartbeat && currentMaxDeviation === targetMaxDeviation && existingConfig.risk.exists) {
    return;
  }

  const tx = await oracle.updateAssetRiskConfig(
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
 *
 * @param value
 */
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

func.tags = ["deth", "weth-oracle"];
func.dependencies = [
  USD_ORACLE_AGGREGATOR_ID,
  ETH_ORACLE_AGGREGATOR_ID,
  "setup-eth-oracle-wrappers-v1_1",
  "point-eth-aggregator-to-wrappers-v1_1",
];
func.id = WETH_HARD_PEG_ORACLE_WRAPPER_ID;

export default func;
