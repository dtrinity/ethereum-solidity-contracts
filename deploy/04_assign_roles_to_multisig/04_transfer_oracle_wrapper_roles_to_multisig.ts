import { HardhatRuntimeEnvironment } from "hardhat/types";
import { DeployFunction } from "hardhat-deploy/types";

import { isMainnet } from "../../typescript/hardhat/deploy";

/**
 * Placeholder for transferring V1.1 oracle wrapper roles to governance.
 * This script intentionally no-ops until the new wrapper deployment flow is implemented.
 *
 * @param hre Hardhat runtime environment used to detect the active network.
 */
const func: DeployFunction = async function (hre: HardhatRuntimeEnvironment) {
  if (!isMainnet(hre.network.name)) {
    console.log(`\n🔑 ${__filename.split("/").slice(-2).join("/")}: Skipping non-mainnet network`);
    return true;
  }

  console.log(
    `\n🔑 ${__filename.split("/").slice(-2).join("/")}: TODO - configure role transfers for V1.1 oracle wrappers once deployment scripts are in place`,
  );
  return true;
};

func.id = "transfer_oracle_wrapper_roles_to_multisig";
func.tags = ["governance", "roles"];
func.dependencies = ["usd-oracle", "s-oracle"];

export default func;
