import { HardhatRuntimeEnvironment } from "hardhat/types";
import { DeployFunction } from "hardhat-deploy/types";

import { isMainnet } from "../typescript/hardhat/deploy";

/**
 * Placeholder for provisioning mock oracle feeds compatible with the V1.1 stack.
 */
const func: DeployFunction = async function (hre: HardhatRuntimeEnvironment) {
  if (isMainnet(hre.network.name)) {
    throw new Error("WARNING - mock oracle setup should not run on mainnet");
  }

  console.log(
    `🔮 ${__filename.split("/").slice(-2).join("/")}: TODO - supply mock feeds for V1.1 wrappers`
  );
  return true;
};

func.tags = ["local-setup", "oracle"];
func.dependencies = ["tokens"];
func.id = "local_oracle_setup";

export default func;
