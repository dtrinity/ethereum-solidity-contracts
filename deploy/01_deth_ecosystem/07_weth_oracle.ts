import { DeployFunction } from "hardhat-deploy/types";

import { WETH_HARD_PEG_ORACLE_WRAPPER_ID } from "../../typescript/deploy-ids";

const func: DeployFunction = async function () {
  console.log(`🔁 ${__filename.split("/").slice(-2).join("/")}: handled via V1.1 oracle configuration – skipping legacy script`);
  return true;
};

func.tags = ["deth", "weth-oracle"];
func.dependencies = ["setup-eth-oracle-wrappers-v1_1", "point-eth-aggregator-to-wrappers-v1_1"];
func.id = WETH_HARD_PEG_ORACLE_WRAPPER_ID;

export default func;
