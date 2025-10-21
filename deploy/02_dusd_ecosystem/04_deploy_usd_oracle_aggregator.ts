import { HardhatRuntimeEnvironment } from "hardhat/types";
import { DeployFunction } from "hardhat-deploy/types";

import { getConfig } from "../../config/config";
import { USD_ORACLE_AGGREGATOR_ID } from "../../typescript/deploy-ids";
import { ORACLE_AGGREGATOR_BASE_CURRENCY_UNIT } from "../../typescript/oracle_aggregator/constants";

const func: DeployFunction = async function (hre: HardhatRuntimeEnvironment) {
  const { deployer } = await hre.getNamedAccounts();

  const config = await getConfig(hre);

  const oracleConfig = config.oracleAggregators.USD;
  const roles = oracleConfig.roles ?? {
    admins: [],
    oracleManagers: [],
    guardians: [],
    globalMaxStaleTime: 0,
  };
  const admins = includeDeployer(roles.admins, deployer);
  const oracleManagers = includeDeployer(roles.oracleManagers, deployer);
  const guardians = includeDeployer(roles.guardians, deployer);

  // Deploy the USD-specific OracleAggregatorV1_1
  await hre.deployments.deploy(USD_ORACLE_AGGREGATOR_ID, {
    from: deployer,
    args: [oracleConfig.baseCurrency, ORACLE_AGGREGATOR_BASE_CURRENCY_UNIT, admins, oracleManagers, guardians, roles.globalMaxStaleTime],
    contract: "OracleAggregatorV1_1",
    autoMine: true,
    log: false,
  });

  console.log(`🔮 ${__filename.split("/").slice(-2).join("/")}: ✅`);
  // Return true to indicate deployment success
  return true;
};

func.tags = ["usd-oracle", "oracle-aggregator", "usd-oracle-aggregator"];
func.dependencies = [];
func.id = "deploy-usd-oracle-aggregator";

export default func;

/**
 *
 * @param addresses
 * @param deployer
 */
/**
 * Ensures the deployer address is included in the provided role list without duplicates.
 *
 * @param addresses Addresses configured in network settings
 * @param deployer Deployer address that must retain rights after deployment
 */
function includeDeployer(addresses: string[] | undefined, deployer: string): string[] {
  const seen = new Set<string>();
  const result: string[] = [];

  for (const address of [deployer, ...(addresses ?? [])]) {
    if (!address) continue;
    const key = address.toLowerCase();
    if (seen.has(key)) continue;
    seen.add(key);
    result.push(address);
  }

  return result;
}
