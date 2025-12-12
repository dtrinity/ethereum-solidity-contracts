import { ethers } from "hardhat";
import { HardhatRuntimeEnvironment } from "hardhat/types";
import { DeployFunction } from "hardhat-deploy/types";

import { getConfig } from "../../config/config";
import { DStakeInstanceConfig } from "../../config/types";
import { DStakeRouterV2__factory as DStakeRouterV2Factory } from "../../typechain-types/factories/contracts/vaults/dstake/DStakeRouterV2.sol";
import { DSTAKE_COLLATERAL_VAULT_ID_PREFIX, DSTAKE_ROUTER_ID_PREFIX, DSTAKE_TOKEN_ID_PREFIX } from "../../typescript/deploy-ids";

/**
 * Deploys (and wires) missing router delegatecall modules for dSTAKE.
 *
 * Why this exists:
 * - `01_deploy_dstake_core.ts` intentionally skips if core already exists, so older deployments can miss newer modules.
 * - This script is safe to run repeatedly: it only deploys missing module deployments and wires modules if unset/mismatched.
 *
 * @param hre The Hardhat Runtime Environment
 */
const func: DeployFunction = async function (hre: HardhatRuntimeEnvironment) {
  const { deployments, getNamedAccounts } = hre;
  const { deploy } = deployments;
  const { deployer } = await getNamedAccounts();
  const deployerSigner = await ethers.getSigner(deployer);

  const config = await getConfig(hre);

  if (!config.dStake) {
    console.log("No dSTAKE configuration found for this network. Skipping module deployment.");
    return;
  }

  let processedInstances = 0;

  for (const instanceKey in config.dStake) {
    const instanceConfig = config.dStake[instanceKey] as DStakeInstanceConfig;
    const symbol = instanceConfig.symbol;
    if (!symbol) continue;
    processedInstances++;

    const tokenDeploymentName = `${DSTAKE_TOKEN_ID_PREFIX}_${symbol}`;
    const collateralVaultDeploymentName = `${DSTAKE_COLLATERAL_VAULT_ID_PREFIX}_${symbol}`;
    const routerDeploymentName = `${DSTAKE_ROUTER_ID_PREFIX}_${symbol}`;

    const routerDeployment = await deployments.getOrNull(routerDeploymentName);
    const tokenDeployment = await deployments.getOrNull(tokenDeploymentName);
    const collateralVaultDeployment = await deployments.getOrNull(collateralVaultDeploymentName);

    if (!routerDeployment || !tokenDeployment || !collateralVaultDeployment) {
      throw new Error(
        `Missing deployments for ${instanceKey} while deploying router modules. Expected ${routerDeploymentName}, ${tokenDeploymentName}, ${collateralVaultDeploymentName}`,
      );
    }

    const governanceModuleDeploymentName = `${routerDeploymentName}_GovernanceModule`;
    const rebalanceModuleDeploymentName = `${routerDeploymentName}_RebalanceModule`;

    const governanceModuleDeployment =
      (await deployments.getOrNull(governanceModuleDeploymentName)) ??
      (await deploy(governanceModuleDeploymentName, {
        from: deployer,
        contract: "DStakeRouterV2GovernanceModule",
        args: [tokenDeployment.address, collateralVaultDeployment.address],
        log: false,
      }));

    const rebalanceModuleDeployment =
      (await deployments.getOrNull(rebalanceModuleDeploymentName)) ??
      (await deploy(rebalanceModuleDeploymentName, {
        from: deployer,
        contract: "DStakeRouterV2RebalanceModule",
        args: [tokenDeployment.address, collateralVaultDeployment.address],
        log: false,
      }));

    if (!governanceModuleDeployment?.address || governanceModuleDeployment.address === ethers.ZeroAddress) {
      throw new Error(`Failed to deploy ${governanceModuleDeploymentName}`);
    }

    if (!rebalanceModuleDeployment?.address || rebalanceModuleDeployment.address === ethers.ZeroAddress) {
      throw new Error(`Failed to deploy ${rebalanceModuleDeploymentName}`);
    }

    const router = DStakeRouterV2Factory.connect(routerDeployment.address, deployerSigner);

    // Wiring requires router DEFAULT_ADMIN_ROLE. If you already migrated admin away from deployer,
    // you must wire via the admin (e.g., Safe) instead.
    const defaultAdminRole = await router.DEFAULT_ADMIN_ROLE();
    const deployerIsAdmin = await router.hasRole(defaultAdminRole, deployer);

    if (!deployerIsAdmin) {
      throw new Error(
        `Deployer ${deployer} lacks DEFAULT_ADMIN_ROLE on ${routerDeploymentName}; cannot wire modules. Wire via admin, or temporarily grant admin back to deployer.`,
      );
    }

    const currentGovernance = await router.governanceModule();

    if (currentGovernance !== governanceModuleDeployment.address) {
      console.log(`    ⚙️ Wiring governance module for ${routerDeploymentName} to ${governanceModuleDeployment.address}`);
      // Use direct call (avoids hardhat-deploy ABI dedupe warnings on older deployment JSONs)
      await router.connect(deployerSigner).setGovernanceModule(governanceModuleDeployment.address);
    }

    const currentRebalance = await router.rebalanceModule();

    if (currentRebalance !== rebalanceModuleDeployment.address) {
      console.log(`    ⚙️ Wiring rebalance module for ${routerDeploymentName} to ${rebalanceModuleDeployment.address}`);
      // Use direct call (avoids hardhat-deploy ABI dedupe warnings on older deployment JSONs)
      await router.connect(deployerSigner).setRebalanceModule(rebalanceModuleDeployment.address);
    }
  }

  console.log(`🥩 ${__filename.split("/").slice(-2).join("/")}: ✅`);

  if (processedInstances > 0) {
    // Mark as fully executed (one-shot) for this network once all instances are wired.
    return true;
  }
  return;
};

export default func;
func.tags = ["dStakeModules", "dStake"];
func.dependencies = ["dStakeCore"];
func.runAtTheEnd = true;
func.id = "deploy_dstake_router_modules";
