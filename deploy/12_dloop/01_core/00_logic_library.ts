import { HardhatRuntimeEnvironment } from "hardhat/types";
import { DeployFunction } from "hardhat-deploy/types";

import {
  DLOOP_CORE_LOGIC_ID,
} from "../../../typescript/deploy-ids";

const func: DeployFunction = async function (hre: HardhatRuntimeEnvironment) {
  const { deployer } = await hre.getNamedAccounts();

  // Deploy DLoopCoreLogic library
  await hre.deployments.deploy(DLOOP_CORE_LOGIC_ID, {
    from: deployer,
    args: [],
    contract: "contracts/vaults/dloop/core/DLoopCoreLogic.sol:DLoopCoreLogic",
    autoMine: true,
    log: true,
  });

  console.log(`🔗 ${__filename.split("/").slice(-2).join("/")}: ✅ DLoopCoreLogic library deployed`);

  // Return true to indicate deployment success
  return true;
};

func.id = "dLoop:CoreLogicLibrary";
func.tags = ["dloop", "dloop-core", "library"];

export default func;