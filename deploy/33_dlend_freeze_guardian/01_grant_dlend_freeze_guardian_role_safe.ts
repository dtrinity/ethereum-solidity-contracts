import { getAddress } from "ethers";
import { HardhatRuntimeEnvironment } from "hardhat/types";
import { DeployFunction } from "hardhat-deploy/types";

import { getConfig } from "../../config/config";
import { ACL_MANAGER_ID, DLEND_FREEZE_GUARDIAN_ID } from "../../typescript/deploy-ids";
import { isLocalNetwork } from "../../typescript/hardhat/deploy";
import { GovernanceExecutor } from "../../typescript/hardhat/governance";

const func: DeployFunction = async function (hre: HardhatRuntimeEnvironment): Promise<boolean> {
  if (isLocalNetwork(hre.network.name)) {
    console.log("🔁 dlend-freeze-guardian-risk-admin-safe: local network detected - skipping");
    return true;
  }

  const { deployments, ethers } = hre;
  const { deployer } = await hre.getNamedAccounts();
  const signer = await ethers.getSigner(deployer);
  const config = await getConfig(hre);
  const executor = new GovernanceExecutor(hre, signer, config.safeConfig);

  if (!executor.useSafe || !config.safeConfig?.safeAddress) {
    throw new Error("Safe config is required to grant DlendFreezeGuardian RISK_ADMIN_ROLE.");
  }

  await executor.initialize();

  const guardianAddress = getAddress((await deployments.get(DLEND_FREEZE_GUARDIAN_ID)).address);
  const aclManagerDeployment = await deployments.get(ACL_MANAGER_ID);
  const aclManager = await ethers.getContractAt("ACLManager", aclManagerDeployment.address, signer);

  const [hasRiskAdmin, hasPoolAdmin, hasEmergencyAdmin] = await Promise.all([
    aclManager.isRiskAdmin(guardianAddress),
    aclManager.isPoolAdmin(guardianAddress),
    aclManager.isEmergencyAdmin(guardianAddress),
  ]);

  if (hasPoolAdmin || hasEmergencyAdmin) {
    throw new Error(
      [
        "DlendFreezeGuardian must remain freeze-only.",
        `poolAdmin=${hasPoolAdmin}`,
        `emergencyAdmin=${hasEmergencyAdmin}`,
        `guardian=${guardianAddress}`,
      ].join(" "),
    );
  }

  if (hasRiskAdmin) {
    console.log("🔁 dlend-freeze-guardian-risk-admin-safe: guardian already has RISK_ADMIN_ROLE");
    return true;
  }

  const data = aclManager.interface.encodeFunctionData("addRiskAdmin", [guardianAddress]);
  await executor.tryOrQueue(
    async () => {
      throw new Error("Direct execution disabled: queue Safe transaction instead.");
    },
    () => ({ to: aclManagerDeployment.address, value: "0", data }),
  );

  const success = await executor.flush("Ethereum mainnet dLEND freeze guardian: grant RISK_ADMIN_ROLE");

  if (!success) {
    throw new Error("Failed to create Safe batch for DlendFreezeGuardian RISK_ADMIN_ROLE grant.");
  }

  console.log("🔁 dlend-freeze-guardian-risk-admin-safe: ✅");
  return true;
};

func.tags = ["post-deploy", "safe", "dlend", "freeze-guardian", "dlend-freeze-guardian-risk-admin-safe"];
func.dependencies = [DLEND_FREEZE_GUARDIAN_ID, ACL_MANAGER_ID];
func.id = "dlend-freeze-guardian-risk-admin-safe";

export default func;
