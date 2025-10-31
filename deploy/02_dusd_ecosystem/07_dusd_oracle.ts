import { ZeroAddress } from "ethers";
import { HardhatRuntimeEnvironment } from "hardhat/types";
import { DeployFunction } from "hardhat-deploy/types";

import { getConfig } from "../../config/config";
import { DUSD_HARD_PEG_ORACLE_WRAPPER_ID, DUSD_TOKEN_ID, USD_ORACLE_AGGREGATOR_ID } from "../../typescript/deploy-ids";
import { ORACLE_AGGREGATOR_BASE_CURRENCY_UNIT } from "../../typescript/oracle_aggregator/constants";

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
    args: [baseCurrency, ORACLE_AGGREGATOR_BASE_CURRENCY_UNIT, pegValue],
    log: true,
    autoMine: true,
  });

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

  const currentOracle = await oracleAggregator.assetOracles(dusdAddress);

  if (currentOracle.toLowerCase() !== hardPegDeployment.address.toLowerCase()) {
    const tx = await oracleAggregator.setOracle(dusdAddress, hardPegDeployment.address);
    await tx.wait();
    console.log(`  ✅ Routed dUSD oracle to HardPeg wrapper ${hardPegDeployment.address}`);
  } else {
    console.log(`  ✅ dUSD oracle already points to HardPeg wrapper ${hardPegDeployment.address}`);
  }

  console.log(`🔮 ${__filename.split("/").slice(-2).join("/")}: ✅`);
  return true;
};

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
