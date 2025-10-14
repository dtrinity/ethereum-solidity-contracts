import { HardhatRuntimeEnvironment } from "hardhat/types";
import { DeployFunction } from "hardhat-deploy/types";

import { getConfig } from "../../config/config";
import { ETH_ORACLE_AGGREGATOR_ID } from "../../typescript/deploy-ids";
import { ORACLE_AGGREGATOR_BASE_CURRENCY_UNIT } from "../../typescript/oracle_aggregator/constants";

const func: DeployFunction = async function (hre: HardhatRuntimeEnvironment) {
  const { deployer } = await hre.getNamedAccounts();

  const config = await getConfig(hre);

  const oracleConfig = config.oracleAggregators.ETH;

  await hre.deployments.deploy(ETH_ORACLE_AGGREGATOR_ID, {
    from: deployer,
    args: [
      oracleConfig.baseCurrency,
      ORACLE_AGGREGATOR_BASE_CURRENCY_UNIT,
      oracleConfig.roles.admins,
      oracleConfig.roles.oracleManagers,
      oracleConfig.roles.guardians,
      oracleConfig.roles.globalMaxStaleTime,
    ],
    contract: "OracleAggregatorV1_1",
    autoMine: true,
    log: false,
  });

  console.log(`🔮 ${__filename.split("/").slice(-2).join("/")}: ✅`);
  // Return true to indicate deployment success
  return true;
};

func.tags = ["deth", "eth-oracle", "oracle-aggregator", "eth-oracle-aggregator"];
func.dependencies = [];
func.id = ETH_ORACLE_AGGREGATOR_ID;

export default func;
