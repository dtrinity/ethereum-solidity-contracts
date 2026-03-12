import { Signer } from "ethers";
import { HardhatRuntimeEnvironment } from "hardhat/types";
import { DeployFunction } from "hardhat-deploy/types";

import { getConfig } from "../../config/config";
import { DStakeInstanceConfig } from "../../config/types";
import { DSTAKE_COLLATERAL_VAULT_ID_PREFIX, DSTAKE_ROUTER_ID_PREFIX, DSTAKE_TOKEN_ID_PREFIX } from "../../typescript/deploy-ids";
import { isLocalNetwork } from "../../typescript/hardhat/deploy";
import { GovernanceExecutor } from "../../typescript/hardhat/governance";
import { ensureRoleGrantedToManager } from "../_shared/safe-role";

/**
 * Ensures the given account has the specified role on the contract by having the deployer grant it (used when Safe batch is not needed).
 *
 * @param params - Options for the role grant.
 * @param params.contract - Access-controlled contract instance.
 * @param params.role - Role bytes32 to grant.
 * @param params.roleLabel - Human-readable role name for logging.
 * @param params.account - Address to grant the role to.
 * @param params.signer - Signer that must hold the role's admin (e.g. deployer).
 * @param params.contractLabel - Human-readable contract name for logging.
 */
async function ensureRoleGrantedByDeployer(params: {
  contract: any;
  role: string;
  roleLabel: string;
  account: string;
  signer: Signer;
  contractLabel: string;
}): Promise<void> {
  const { contract, role, roleLabel, account, signer, contractLabel } = params;
  const signerAddress = await signer.getAddress();

  const alreadyHasRole = await contract.hasRole(role, account);
  if (alreadyHasRole) return;

  const adminRole = await contract.getRoleAdmin(role);
  const signerCanGrant = await contract.hasRole(adminRole, signerAddress);

  if (!signerCanGrant) {
    throw new Error(`Deployer ${signerAddress} cannot grant ${roleLabel} on ${contractLabel}: missing admin role ${adminRole}`);
  }

  const tx = await contract.connect(signer).grantRole(role, account);
  await tx.wait();
  console.log(`    🔑 Granted ${roleLabel} to ${account} on ${contractLabel}`);
}

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

    const [adapterManagerRole, vaultManagerRole, configManagerRole, rebalancerRole, pauserRole, defaultAdminRole] = await Promise.all([
      router.ADAPTER_MANAGER_ROLE(),
      router.VAULT_MANAGER_ROLE(),
      router.CONFIG_MANAGER_ROLE(),
      router.STRATEGY_REBALANCER_ROLE(),
      router.PAUSER_ROLE(),
      router.DEFAULT_ADMIN_ROLE(),
    ]);

    // Ensure Safe has DEFAULT_ADMIN_ROLE first, otherwise it cannot grant other roles to itself
    await ensureRoleGrantedByDeployer({
      contract: router,
      role: defaultAdminRole,
      roleLabel: "DEFAULT_ADMIN_ROLE",
      account: managerAddress,
      signer: signer,
      contractLabel: routerDeploymentName,
    });

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
    await ensureRoleGrantedToManager({
      executor,
      contract: accessControlledRouter,
      contractAddress: routerDeployment.address,
      managerAddress,
      role: pauserRole,
      roleLabel: "PAUSER_ROLE",
      contractLabel: routerDeploymentName,
    });

    for (const adapterConfig of instanceConfig.adapters) {
      const adapterDeploymentName = `${adapterConfig.adapterContract}_${instanceConfig.symbol}`;
      const adapterDeployment = await deployments.getOrNull(adapterDeploymentName);

      if (adapterDeployment) {
        const adapter = await ethers.getContractAt("GenericERC4626ConversionAdapter", adapterDeployment.address, signer);
        const adapterAdminRole = await adapter.DEFAULT_ADMIN_ROLE();

        await ensureRoleGrantedByDeployer({
          contract: adapter,
          role: adapterAdminRole,
          roleLabel: "DEFAULT_ADMIN_ROLE",
          account: managerAddress,
          signer: signer,
          contractLabel: adapterDeploymentName,
        });
      }
    }

    // Ensure Safe has roles on Token and Collateral Vault
    const tokenDeploymentName = `${DSTAKE_TOKEN_ID_PREFIX}_${symbol}`;
    const tokenDeployment = await deployments.getOrNull(tokenDeploymentName);

    if (tokenDeployment) {
      const token = await ethers.getContractAt("DStakeTokenV2", tokenDeployment.address, signer);
      await ensureRoleGrantedByDeployer({
        contract: token,
        role: await token.DEFAULT_ADMIN_ROLE(),
        roleLabel: "DEFAULT_ADMIN_ROLE",
        account: managerAddress,
        signer: signer,
        contractLabel: tokenDeploymentName,
      });
      await ensureRoleGrantedByDeployer({
        contract: token,
        role: await token.FEE_MANAGER_ROLE(),
        roleLabel: "FEE_MANAGER_ROLE",
        account: managerAddress,
        signer: signer,
        contractLabel: tokenDeploymentName,
      });
    }

    const vaultDeploymentName = `${DSTAKE_COLLATERAL_VAULT_ID_PREFIX}_${symbol}`;
    const vaultDeployment = await deployments.getOrNull(vaultDeploymentName);

    if (vaultDeployment) {
      const vault = await ethers.getContractAt("DStakeCollateralVaultV2", vaultDeployment.address, signer);
      await ensureRoleGrantedByDeployer({
        contract: vault,
        role: await vault.DEFAULT_ADMIN_ROLE(),
        roleLabel: "DEFAULT_ADMIN_ROLE",
        account: managerAddress,
        signer: signer,
        contractLabel: vaultDeploymentName,
      });
    }
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
