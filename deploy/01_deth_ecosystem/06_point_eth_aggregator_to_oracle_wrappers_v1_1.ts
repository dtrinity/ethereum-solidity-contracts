import { HardhatRuntimeEnvironment } from "hardhat/types";
import { DeployFunction } from "hardhat-deploy/types";

/**
 * Placeholder for wiring ETH oracle aggregator assets to the deployed V1.1 wrappers.
 */
const func: DeployFunction = async function (_hre: HardhatRuntimeEnvironment) {
  console.log(
    `🔮 ${__filename.split("/").slice(-2).join("/")}: TODO - map ETH assets to V1.1 wrappers in OracleAggregatorV1_1`
  );
  return true;
};

func.tags = ["eth-oracle", "oracle-routing"];
func.dependencies = ["setup-eth-oracle-wrappers-v1_1"];
func.id = "point-eth-aggregator-to-wrappers-v1_1";

export default func;
