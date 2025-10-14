import { HardhatRuntimeEnvironment } from "hardhat/types";
import { DeployFunction } from "hardhat-deploy/types";

/**
 * Placeholder for deploying and configuring ETH oracle wrappers under the V1.1 stack.
 */
const func: DeployFunction = async function (_hre: HardhatRuntimeEnvironment) {
  console.log(
    `🔮 ${__filename.split("/").slice(-2).join("/")}: TODO - deploy/configure ETH oracle wrappers for V1.1 stack`
  );
  return true;
};

func.tags = ["eth-oracle", "oracle-wrappers"];
func.dependencies = ["eth-oracle-aggregator"];
func.id = "setup-eth-oracle-wrappers-v1_1";

export default func;
