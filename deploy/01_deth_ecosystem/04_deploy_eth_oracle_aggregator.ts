import { HardhatRuntimeEnvironment } from "hardhat/types";
import { DeployFunction } from "hardhat-deploy/types";

import { getConfig } from "../../config/config";
import { ETH_ORACLE_AGGREGATOR_ID } from "../../typescript/deploy-ids";

const func: DeployFunction = async function (hre: HardhatRuntimeEnvironment) {
  const { deployer } = await hre.getNamedAccounts();

  const config = await getConfig(hre);

  await hre.deployments.deploy(ETH_ORACLE_AGGREGATOR_ID, {
    from: deployer,
    args: [
      config.oracleAggregators.ETH.baseCurrency, // WETH token as base currency for ETH
      BigInt(10) ** BigInt(config.oracleAggregators.ETH.priceDecimals),
    ],
    contract: "OracleAggregator",
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
