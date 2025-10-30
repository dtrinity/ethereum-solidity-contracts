import { HardhatRuntimeEnvironment } from "hardhat/types";
import { DeployFunction } from "hardhat-deploy/types";

import { getConfig } from "../../config/config";
import { USD_ORACLE_AGGREGATOR_ID } from "../../typescript/deploy-ids";
import { ORACLE_AGGREGATOR_BASE_CURRENCY_UNIT } from "../../typescript/oracle_aggregator/constants";

const func: DeployFunction = async function (hre: HardhatRuntimeEnvironment) {
  const { deployer } = await hre.getNamedAccounts();

  const config = await getConfig(hre);

  const oracleConfig = config.oracleAggregators.USD;

  // Deploy the USD-specific OracleAggregatorV1_1
  await hre.deployments.deploy(USD_ORACLE_AGGREGATOR_ID, {
    from: deployer,
    args: [oracleConfig.baseCurrency, ORACLE_AGGREGATOR_BASE_CURRENCY_UNIT],
    contract: "OracleAggregatorV1_1",
    autoMine: true,
    log: false,
  });

  console.log(`🔮 ${__filename.split("/").slice(-2).join("/")}: ✅`);
  return true;
};

func.tags = ["local-setup", "dlend", "usd-oracle", "oracle-aggregator", "usd-oracle-aggregator"];
func.dependencies = [];
func.id = "deploy-usd-oracle-aggregator";

export default func;
