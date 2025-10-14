import { HardhatRuntimeEnvironment } from "hardhat/types";
import { DeployFunction } from "hardhat-deploy/types";

/**
 * Placeholder for wiring USD oracle aggregator assets to the deployed V1.1 wrappers.
 */
const func: DeployFunction = async function (_hre: HardhatRuntimeEnvironment) {
  console.log(
    `🔮 ${__filename.split("/").slice(-2).join("/")}: TODO - map USD assets to V1.1 wrappers in OracleAggregatorV1_1`
  );
  return true;
};

func.tags = ["usd-oracle", "oracle-routing"];
func.dependencies = ["setup-usd-oracle-wrappers-v1_1"];
func.id = "point-usd-aggregator-to-wrappers-v1_1";

export default func;
