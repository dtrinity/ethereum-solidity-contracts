import { HardhatRuntimeEnvironment } from "hardhat/types";
import { DeployFunction } from "hardhat-deploy/types";

import { getConfig } from "../../config/config";
import { DStakeInstanceConfig } from "../../config/types";
import { DSTAKE_COLLATERAL_VAULT_ID_PREFIX, DSTAKE_ROUTER_ID_PREFIX, DSTAKE_TOKEN_ID_PREFIX } from "../../typescript/deploy-ids";
import { isLocalNetwork } from "../../typescript/hardhat/deploy";
import { GovernanceExecutor } from "../../typescript/hardhat/governance";
import { ensureRoleRevokedFromAccount } from "../_shared/safe-role";

const func: DeployFunction = async function (hre: HardhatRuntimeEnvironment): Promise<boolean> {
  const runOnLocal = process.env.RUN_ON_LOCAL?.toLowerCase() === "true";

  if (isLocalNetwork(hre.network.name) && !runOnLocal) {
    console.log("🔁 setup-ethereum-mainnet-dstake-dlend-revoke-roles-safe: local network detected – skipping");
    return true;
  }

  const { deployments, ethers } = hre;
  const { deployer } = await hre.getNamedAccounts();
  const signer = await ethers.getSigner(deployer);
  const config = await getConfig(hre);

  if (!config.dStake) {
    console.log("🔁 setup-ethereum-mainnet-dstake-dlend-revoke-roles-safe: no dSTAKE config – skipping");
    return true;
  }

  const executor = new GovernanceExecutor(hre, signer, config.safeConfig);

  if (!executor.useSafe || !config.safeConfig?.safeAddress) {
    throw new Error("Safe config is required for dSTAKE dLEND role revokes on mainnet.");
  }

  await executor.initialize();
  const managerAddress = config.safeConfig.safeAddress;

  for (const instanceKey in config.dStake) {
    const instanceConfig = config.dStake[instanceKey] as DStakeInstanceConfig;
    const symbol = instanceConfig.symbol;

    if (!symbol) {
      throw new Error(`Missing dSTAKE symbol for instance ${instanceKey}`);
    }

    // 1. Revoke deployer roles from DStakeRouterV2
    const routerDeploymentName = `${DSTAKE_ROUTER_ID_PREFIX}_${symbol}`;
    const routerDeployment = await deployments.get(routerDeploymentName);
    const router = await ethers.getContractAt("DStakeRouterV2", routerDeployment.address, signer);
    const accessControlledRouter = router as any;

    const [adapterManagerRole, vaultManagerRole, configManagerRole, rebalancerRole, pauserRole, defaultAdminRole] = await Promise.all([
      router.ADAPTER_MANAGER_ROLE(),
      router.VAULT_MANAGER_ROLE(),
      router.CONFIG_MANAGER_ROLE(),
      router.STRATEGY_REBALANCER_ROLE(),
      router.PAUSER_ROLE(),
      router.DEFAULT_ADMIN_ROLE(),
    ]);

    await ensureRoleRevokedFromAccount({
      executor,
      contract: accessControlledRouter,
      contractAddress: routerDeployment.address,
      managerAddress,
      account: deployer,
      role: adapterManagerRole,
      roleLabel: "ADAPTER_MANAGER_ROLE",
      contractLabel: routerDeploymentName,
    });
    await ensureRoleRevokedFromAccount({
      executor,
      contract: accessControlledRouter,
      contractAddress: routerDeployment.address,
      managerAddress,
      account: deployer,
      role: vaultManagerRole,
      roleLabel: "VAULT_MANAGER_ROLE",
      contractLabel: routerDeploymentName,
    });
    await ensureRoleRevokedFromAccount({
      executor,
      contract: accessControlledRouter,
      contractAddress: routerDeployment.address,
      managerAddress,
      account: deployer,
      role: configManagerRole,
      roleLabel: "CONFIG_MANAGER_ROLE",
      contractLabel: routerDeploymentName,
    });
    await ensureRoleRevokedFromAccount({
      executor,
      contract: accessControlledRouter,
      contractAddress: routerDeployment.address,
      managerAddress,
      account: deployer,
      role: rebalancerRole,
      roleLabel: "STRATEGY_REBALANCER_ROLE",
      contractLabel: routerDeploymentName,
    });
    await ensureRoleRevokedFromAccount({
      executor,
      contract: accessControlledRouter,
      contractAddress: routerDeployment.address,
      managerAddress,
      account: deployer,
      role: pauserRole,
      roleLabel: "PAUSER_ROLE",
      contractLabel: routerDeploymentName,
    });
    await ensureRoleRevokedFromAccount({
      executor,
      contract: accessControlledRouter,
      contractAddress: routerDeployment.address,
      managerAddress,
      account: deployer,
      role: defaultAdminRole,
      roleLabel: "DEFAULT_ADMIN_ROLE",
      contractLabel: routerDeploymentName,
    });

    // 2. Revoke deployer roles from DStakeRewardManagerDLend
    if (instanceConfig.dLendRewardManager) {
      const rewardManagerDeploymentName = `DStakeRewardManagerDLend_${instanceKey}`;
      const rewardManagerDeployment = await deployments.getOrNull(rewardManagerDeploymentName);

      if (rewardManagerDeployment) {
        const rewardManager = await ethers.getContractAt("DStakeRewardManagerDLend", rewardManagerDeployment.address, signer);
        const accessControlledRewardManager = rewardManager as any;

        const [rmDefaultAdminRole, rmRewardsManagerRole] = await Promise.all([
          rewardManager.DEFAULT_ADMIN_ROLE(),
          rewardManager.REWARDS_MANAGER_ROLE(),
        ]);

        await ensureRoleRevokedFromAccount({
          executor,
          contract: accessControlledRewardManager,
          contractAddress: rewardManagerDeployment.address,
          managerAddress,
          account: deployer,
          role: rmRewardsManagerRole,
          roleLabel: "REWARDS_MANAGER_ROLE",
          contractLabel: rewardManagerDeploymentName,
        });
        await ensureRoleRevokedFromAccount({
          executor,
          contract: accessControlledRewardManager,
          contractAddress: rewardManagerDeployment.address,
          managerAddress,
          account: deployer,
          role: rmDefaultAdminRole,
          roleLabel: "DEFAULT_ADMIN_ROLE",
          contractLabel: rewardManagerDeploymentName,
        });
      }
    }

    // 3. Revoke deployer roles from Adapters
    for (const adapterConfig of instanceConfig.adapters) {
      const adapterDeploymentName = `${adapterConfig.adapterContract}_${instanceConfig.symbol}`;
      const adapterDeployment = await deployments.getOrNull(adapterDeploymentName);

      if (adapterDeployment) {
        const adapter = await ethers.getContractAt("GenericERC4626ConversionAdapter", adapterDeployment.address, signer);
        const accessControlledAdapter = adapter as any;
        const adapterAdminRole = await adapter.DEFAULT_ADMIN_ROLE();

        await ensureRoleRevokedFromAccount({
          executor,
          contract: accessControlledAdapter,
          contractAddress: adapterDeployment.address,
          managerAddress,
          account: deployer,
          role: adapterAdminRole,
          roleLabel: "DEFAULT_ADMIN_ROLE",
          contractLabel: adapterDeploymentName,
        });
      }
    }

    // 4. Revoke deployer roles from Token and Collateral Vault
    const tokenDeploymentName = `${DSTAKE_TOKEN_ID_PREFIX}_${symbol}`;
    const tokenDeployment = await deployments.getOrNull(tokenDeploymentName);

    if (tokenDeployment) {
      const token = await ethers.getContractAt("DStakeTokenV2", tokenDeployment.address, signer);
      const accessControlledToken = token as any;
      await ensureRoleRevokedFromAccount({
        executor,
        contract: accessControlledToken,
        contractAddress: tokenDeployment.address,
        managerAddress,
        account: deployer,
        role: await token.FEE_MANAGER_ROLE(),
        roleLabel: "FEE_MANAGER_ROLE",
        contractLabel: tokenDeploymentName,
      });
      await ensureRoleRevokedFromAccount({
        executor,
        contract: accessControlledToken,
        contractAddress: tokenDeployment.address,
        managerAddress,
        account: deployer,
        role: await token.DEFAULT_ADMIN_ROLE(),
        roleLabel: "DEFAULT_ADMIN_ROLE",
        contractLabel: tokenDeploymentName,
      });
    }

    const vaultDeploymentName = `${DSTAKE_COLLATERAL_VAULT_ID_PREFIX}_${symbol}`;
    const vaultDeployment = await deployments.getOrNull(vaultDeploymentName);

    if (vaultDeployment) {
      const vault = await ethers.getContractAt("DStakeCollateralVaultV2", vaultDeployment.address, signer);
      const accessControlledVault = vault as any;
      await ensureRoleRevokedFromAccount({
        executor,
        contract: accessControlledVault,
        contractAddress: vaultDeployment.address,
        managerAddress,
        account: deployer,
        role: await vault.DEFAULT_ADMIN_ROLE(),
        roleLabel: "DEFAULT_ADMIN_ROLE",
        contractLabel: vaultDeploymentName,
      });
    }
  }

  const success = await executor.flush("Ethereum mainnet dSTAKE dLEND deployer role revokes");

  if (!success) {
    throw new Error("Failed to flush dSTAKE dLEND deployer role revokes Safe batch");
  }

  console.log("🔁 setup-ethereum-mainnet-dstake-dlend-revoke-roles-safe: ✅");
  return true;
};

func.tags = ["post-deploy", "safe", "dstake", "dlend", "setup-ethereum-mainnet-dstake-dlend-revoke-roles-safe"];
func.dependencies = ["setup-ethereum-mainnet-dstake-dlend-safe"];
func.id = "setup-ethereum-mainnet-dstake-dlend-revoke-roles-safe";

export default func;
