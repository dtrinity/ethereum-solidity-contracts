import { HardhatRuntimeEnvironment } from "hardhat/types";
import { DeployFunction } from "hardhat-deploy/types";

/**
 * Placeholder for deploying and configuring USD oracle wrappers under the V1.1 stack.
 * TODO: Implement deployment of Chainlink/API3/composite/hard-peg wrappers and seed feeds from config.
 */
const func: DeployFunction = async function (_hre: HardhatRuntimeEnvironment) {
  console.log(
    `🔮 ${__filename.split("/").slice(-2).join("/")}: TODO - deploy/configure USD oracle wrappers for V1.1 stack`
  );
  return true;
};

func.tags = ["usd-oracle", "oracle-wrappers"];
func.dependencies = ["usd-oracle-aggregator"];
func.id = "setup-usd-oracle-wrappers-v1_1";

export default func;
