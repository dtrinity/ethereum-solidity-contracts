import { HardhatRuntimeEnvironment } from "hardhat/types";
import { DeployFunction } from "hardhat-deploy/types";

import { DUSD_HARD_PEG_ORACLE_WRAPPER_ID } from "../../typescript/deploy-ids";

/**
 * Placeholder script for configuring the dUSD hard peg wrapper using the V1.1 oracle stack.
 * Implementation will be added once the wrapper deployment flow is finalised.
 *
 * @param _hre Hardhat runtime environment (unused placeholder for now).
 */
const func: DeployFunction = async function (_hre: HardhatRuntimeEnvironment) {
  console.log(`🔮 ${__filename.split("/").slice(-2).join("/")}: TODO - wire HardPegOracleWrapperV1_1 once assets and wrappers are defined`);
  return true;
};

func.tags = ["dusd"];
func.dependencies = ["usd-oracle"];
func.id = DUSD_HARD_PEG_ORACLE_WRAPPER_ID;

export default func;
