import { HardhatRuntimeEnvironment } from "hardhat/types";
import { DeployFunction } from "hardhat-deploy/types";

import { getConfig } from "../../config/config";
import { DStakeInstanceConfig } from "../../config/types";
import { DSTAKE_ROUTER_ID_PREFIX } from "../../typescript/deploy-ids";
import { isLocalNetwork } from "../../typescript/hardhat/deploy";
import { GovernanceExecutor } from "../../typescript/hardhat/governance";
import { ensureRoleGrantedToManager } from "../_shared/safe-role";

const func: DeployFunction = async function (hre: HardhatRuntimeEnvironment): Promise<boolean> {
  const runOnLocal = process.env.RUN_ON_LOCAL?.toLowerCase() === "true";

  if (isLocalNetwork(hre.network.name) && !runOnLocal) {
    console.log("🔁 setup-ethereum-mainnet-dstake-dlend-role-grants-safe: local network detected – skipping");
    return true;
  }

  const { deployments, ethers } = hre;
  const { deployer } = await hre.getNamedAccounts();
  const signer = await ethers.getSigner(deployer);
  const config = await getConfig(hre);

  if (!config.dStake) {
    console.log("🔁 setup-ethereum-mainnet-dstake-dlend-role-grants-safe: no dSTAKE config – skipping");
    return true;
  }

  const executor = new GovernanceExecutor(hre, signer, config.safeConfig);

  if (!executor.useSafe || !config.safeConfig?.safeAddress) {
    throw new Error("Safe config is required for dSTAKE dLEND role grants on mainnet.");
  }

  await executor.initialize();
  const managerAddress = config.safeConfig.safeAddress;

  for (const instanceKey in config.dStake) {
    const instanceConfig = config.dStake[instanceKey] as DStakeInstanceConfig;
    const symbol = instanceConfig.symbol;

    if (!symbol) {
      throw new Error(`Missing dSTAKE symbol for instance ${instanceKey}`);
    }

    const routerDeploymentName = `${DSTAKE_ROUTER_ID_PREFIX}_${symbol}`;
    const routerDeployment = await deployments.get(routerDeploymentName);
    const router = await ethers.getContractAt("DStakeRouterV2", routerDeployment.address, signer);
    const accessControlledRouter = router as any;

    const [adapterManagerRole, vaultManagerRole, configManagerRole, rebalancerRole] = await Promise.all([
      router.ADAPTER_MANAGER_ROLE(),
      router.VAULT_MANAGER_ROLE(),
      router.CONFIG_MANAGER_ROLE(),
      router.STRATEGY_REBALANCER_ROLE(),
    ]);

    await ensureRoleGrantedToManager({
      executor,
      contract: accessControlledRouter,
      contractAddress: routerDeployment.address,
      managerAddress,
      role: adapterManagerRole,
      roleLabel: "ADAPTER_MANAGER_ROLE",
      contractLabel: routerDeploymentName,
    });
    await ensureRoleGrantedToManager({
      executor,
      contract: accessControlledRouter,
      contractAddress: routerDeployment.address,
      managerAddress,
      role: vaultManagerRole,
      roleLabel: "VAULT_MANAGER_ROLE",
      contractLabel: routerDeploymentName,
    });
    await ensureRoleGrantedToManager({
      executor,
      contract: accessControlledRouter,
      contractAddress: routerDeployment.address,
      managerAddress,
      role: configManagerRole,
      roleLabel: "CONFIG_MANAGER_ROLE",
      contractLabel: routerDeploymentName,
    });
    await ensureRoleGrantedToManager({
      executor,
      contract: accessControlledRouter,
      contractAddress: routerDeployment.address,
      managerAddress,
      role: rebalancerRole,
      roleLabel: "STRATEGY_REBALANCER_ROLE",
      contractLabel: routerDeploymentName,
    });
  }

  const success = await executor.flush("Ethereum mainnet dSTAKE dLEND router role grants");

  if (!success) {
    throw new Error("Failed to flush dSTAKE dLEND router role grants Safe batch");
  }

  console.log("🔁 setup-ethereum-mainnet-dstake-dlend-role-grants-safe: ✅");
  return true;
};

func.tags = ["post-deploy", "safe", "dstake", "dlend", "setup-ethereum-mainnet-dstake-dlend-role-grants-safe"];
func.dependencies = ["dStakeConfigure"];
func.id = "setup-ethereum-mainnet-dstake-dlend-role-grants-safe";

export default func;
