import { HardhatRuntimeEnvironment } from "hardhat/types";
import { DeployFunction } from "hardhat-deploy/types";

import { USD_ORACLE_AGGREGATOR_ID } from "../../typescript/deploy-ids";

/**
 * Placeholder script for wiring the USD oracle aggregator's base currency feed in the V1.1 stack.
 */
const func: DeployFunction = async function (_hre: HardhatRuntimeEnvironment) {
  console.log(
    `🔮 ${__filename.split("/").slice(-2).join("/")}: TODO - point USD aggregator base currency once wrappers are configured`
  );
  return true;
};

func.tags = ["dusd"];
func.dependencies = [USD_ORACLE_AGGREGATOR_ID];
func.id = "point-usd-oracle-aggregator-for-usd";

export default func;
