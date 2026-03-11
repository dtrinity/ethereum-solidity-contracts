import { HardhatRuntimeEnvironment } from "hardhat/types";
import { DeployFunction } from "hardhat-deploy/types";

import { getConfig } from "../../config/config";
import { POOL_ADDRESSES_PROVIDER_ID, RESERVES_SETUP_HELPER_ID } from "../../typescript/deploy-ids";
import { isLocalNetwork } from "../../typescript/hardhat/deploy";
import { GovernanceExecutor } from "../../typescript/hardhat/governance";
import { getRoleAccess } from "../_shared/safe-role";

const func: DeployFunction = async function (hre: HardhatRuntimeEnvironment): Promise<boolean> {
  if (isLocalNetwork(hre.network.name)) {
    console.log("🔁 setup-ethereum-mainnet-collateral-reserves-revoke-risk-admin-safe: local network detected – skipping");
    return true;
  }

  const { deployments, ethers } = hre;
  const { deployer } = await hre.getNamedAccounts();
  const signer = await ethers.getSigner(deployer);
  const config = await getConfig(hre);

  const executor = new GovernanceExecutor(hre, signer, config.safeConfig);

  if (!executor.useSafe) {
    throw new Error("Safe config is required for collateral reserve rollout role revoke. Provide config.safeConfig and enable Safe mode.");
  }

  await executor.initialize();

  const managerAddress = config.safeConfig!.safeAddress;
  const addressProviderDeployment = await deployments.get(POOL_ADDRESSES_PROVIDER_ID);
  const addressProvider = await ethers.getContractAt("PoolAddressesProvider", addressProviderDeployment.address, signer);
  const aclManagerAddress = await addressProvider.getACLManager();
  const aclManager = await ethers.getContractAt("ACLManager", aclManagerAddress, signer);
  const reservesSetupHelperDeployment = await deployments.get(RESERVES_SETUP_HELPER_ID);
  const reservesSetupHelperAddress = reservesSetupHelperDeployment.address;

  const riskAdminRole = await aclManager.RISK_ADMIN_ROLE();
  const riskAdminAccess = await getRoleAccess(aclManager, riskAdminRole, managerAddress);

  if (!riskAdminAccess.canGrantRole) {
    throw new Error(
      [
        `[role-check] ${managerAddress} cannot revoke RISK_ADMIN_ROLE via ACLManager (${aclManagerAddress}).`,
        `Missing admin role ${riskAdminAccess.adminRole}.`,
      ].join(" "),
    );
  }

  const revokeRiskAdminData = aclManager.interface.encodeFunctionData("removeRiskAdmin", [reservesSetupHelperAddress]);
  await executor.tryOrQueue(
    async () => {
      throw new Error("Direct execution disabled: queue Safe transaction instead.");
    },
    () => ({ to: aclManagerAddress, value: "0", data: revokeRiskAdminData }),
  );

  const success = await executor.flush("Ethereum mainnet dLEND collateral reserves risk-admin revoke");

  if (!success) {
    throw new Error("Failed to create Safe batch for collateral reserves risk-admin revoke.");
  }
  console.log("🔁 setup-ethereum-mainnet-collateral-reserves-revoke-risk-admin-safe: ✅");
  return true;
};

func.tags = ["post-deploy", "dlend", "reserve-rollout", "safe", "setup-ethereum-mainnet-collateral-reserves-revoke-risk-admin-safe"];
func.dependencies = [
  "setup-ethereum-mainnet-new-listings-preflight",
  "setup-ethereum-mainnet-new-listings-role-grants-safe",
  "setup-ethereum-mainnet-collateral-reserves-config-safe",
  POOL_ADDRESSES_PROVIDER_ID,
  RESERVES_SETUP_HELPER_ID,
];
func.id = "setup-ethereum-mainnet-collateral-reserves-revoke-risk-admin-safe-v3";

export default func;
