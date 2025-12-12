import { ethers } from "hardhat";
import { HardhatRuntimeEnvironment } from "hardhat/types";
import { DeployFunction } from "hardhat-deploy/types";

import { getConfig } from "../../config/config";
import { DStakeInstanceConfig } from "../../config/types";
import { DStakeRouterV2__factory as DStakeRouterV2Factory } from "../../typechain-types/factories/contracts/vaults/dstake/DStakeRouterV2.sol";
import { DSTAKE_COLLATERAL_VAULT_ID_PREFIX, DSTAKE_ROUTER_ID_PREFIX, DSTAKE_TOKEN_ID_PREFIX } from "../../typescript/deploy-ids";
// Assuming these IDs exist

const func: DeployFunction = async function (hre: HardhatRuntimeEnvironment) {
  const { deployments, getNamedAccounts } = hre;
  const { deploy } = deployments;
  const { deployer } = await getNamedAccounts();

  const config = await getConfig(hre);

  if (!config.dStake) {
    console.log("No dStake configuration found for this network. Skipping core deployment.");
    return;
  }

  // All configs are valid, proceed with deployment
  for (const instanceKey in config.dStake) {
    const instanceConfig = config.dStake[instanceKey] as DStakeInstanceConfig;
    const symbol = instanceConfig.symbol;

    if (!symbol) {
      console.warn(`Skipping dSTAKE instance ${instanceKey}: missing symbol configuration.`);
      continue;
    }

    if (!instanceConfig.dStable || instanceConfig.dStable === ethers.ZeroAddress) {
      console.warn(`Skipping dSTAKE instance ${instanceKey}: dStable address not configured yet.`);
      continue;
    }

    if (!instanceConfig.name) {
      console.warn(`Skipping dSTAKE instance ${instanceKey}: missing token name.`);
      continue;
    }

    if (!Array.isArray(instanceConfig.adapters) || instanceConfig.adapters.length === 0) {
      console.warn(`Skipping dSTAKE instance ${instanceKey}: no adapters configured.`);
      continue;
    }
    const DStakeTokenDeploymentName = `${DSTAKE_TOKEN_ID_PREFIX}_${symbol}`;
    const collateralVaultDeploymentName = `${DSTAKE_COLLATERAL_VAULT_ID_PREFIX}_${symbol}`;
    const routerDeploymentName = `${DSTAKE_ROUTER_ID_PREFIX}_${symbol}`;

    // If dSTAKE core already exists on this network, skip re-deployment (idempotent on mainnet)
    const existingTokenImpl = await deployments.getOrNull(`${DStakeTokenDeploymentName}_Implementation`);
    const existingVault = await deployments.getOrNull(collateralVaultDeploymentName);
    const existingRouter = await deployments.getOrNull(routerDeploymentName);

    if (existingTokenImpl || existingVault || existingRouter) {
      console.log(`dSTAKE core for ${instanceKey} already deployed. Skipping core deployment.`);
      continue;
    }

    const DStakeTokenDeployment = await deploy(DStakeTokenDeploymentName, {
      from: deployer,
      contract: "DStakeTokenV2",
      proxy: {
        // IMPORTANT:
        // hardhat-deploy uses a shared ProxyAdmin deployment ("DefaultProxyAdmin") for transparent proxies.
        // Setting `owner` here will make hardhat-deploy attempt to change DefaultProxyAdmin ownership,
        // which fails unless you explicitly call `transferOwnership` on that contract.
        //
        // We intentionally DO NOT set `owner` here to avoid any admin/owner changes during deployment.
        // AccessControl role handoff is handled later in 03_configure_dstake.ts.
        proxyContract: "OpenZeppelinTransparentProxy",
        execute: {
          init: {
            methodName: "initialize",
            args: [
              instanceConfig.dStable,
              instanceConfig.name,
              instanceConfig.symbol,
              // Initialize AccessControl to the deployer so we can finish wiring (migrateCore, fees) in 03_configure_dstake.
              // Role migration to governance addresses happens via separate Safe transactions after deployment.
              deployer, // initialAdmin (remains with deployer until migrated)
              deployer, // initialFeeManager (remains with deployer until migrated)
            ],
          },
        },
      },
      log: false,
    });

    const collateralVaultDeployment = await deploy(collateralVaultDeploymentName, {
      from: deployer,
      contract: "DStakeCollateralVaultV2",
      args: [DStakeTokenDeployment.address, instanceConfig.dStable],
      log: false,
    });

    await deploy(routerDeploymentName, {
      from: deployer,
      contract: "DStakeRouterV2",
      args: [DStakeTokenDeployment.address, collateralVaultDeployment.address],
      log: false,
    });

    const governanceModuleDeploymentName = `${routerDeploymentName}_GovernanceModule`;
    const governanceModuleDeployment = await deploy(governanceModuleDeploymentName, {
      from: deployer,
      contract: "DStakeRouterV2GovernanceModule",
      args: [DStakeTokenDeployment.address, collateralVaultDeployment.address],
      log: false,
    });

    const rebalanceModuleDeploymentName = `${routerDeploymentName}_RebalanceModule`;
    const rebalanceModuleDeployment = await deploy(rebalanceModuleDeploymentName, {
      from: deployer,
      contract: "DStakeRouterV2RebalanceModule",
      args: [DStakeTokenDeployment.address, collateralVaultDeployment.address],
      log: false,
    });

    // Wire modules via direct calls to avoid hardhat-deploy ABI dedupe warnings.
    const deployerSigner = await ethers.getSigner(deployer);
    const router = DStakeRouterV2Factory.connect((await deployments.get(routerDeploymentName)).address, deployerSigner);
    await router.setGovernanceModule(governanceModuleDeployment.address);
    await router.setRebalanceModule(rebalanceModuleDeployment.address);

    // NOTE: Governance permissions will be granted in the post-deployment
    // role-migration script. No additional role grants are necessary here.
  }

  console.log(`🥩 ${__filename.split("/").slice(-2).join("/")}: ✅`);
};

export default func;
func.tags = ["dStakeCore", "dStake"];
// Depends on adapters being deployed if adapters need to be configured *during* core deployment (unlikely)
// Primarily depends on the underlying dStable tokens being deployed.
func.dependencies = ["dStable", "dUSD-aTokenWrapper", "dETH-aTokenWrapper"]; // Ensure dUSD/dETH wrappers ready

// Mark script as executed so it won't run again.
func.id = "deploy_dstake_core";

// Hard stop early when dSTAKE core is already present (prevents admin-owner reconciliation on existing proxies)
func.skip = async (hre: HardhatRuntimeEnvironment): Promise<boolean> => {
  const { deployments } = hre;
  const config = await getConfig(hre);
  if (!config.dStake) return true;

  for (const instanceKey in config.dStake) {
    const symbol = (config.dStake[instanceKey] as DStakeInstanceConfig).symbol;
    const name = `${DSTAKE_TOKEN_ID_PREFIX}_${symbol}`;
    const proxy = await deployments.getOrNull(name);
    const impl = await deployments.getOrNull(`${name}_Implementation`);
    const vault = await deployments.getOrNull(`${DSTAKE_COLLATERAL_VAULT_ID_PREFIX}_${symbol}`);
    const router = await deployments.getOrNull(`${DSTAKE_ROUTER_ID_PREFIX}_${symbol}`);

    // If any required piece is missing, allow the script to run
    if (!proxy || !impl || !vault || !router) {
      return false;
    }
  }
  // All instances fully deployed → skip script entirely
  return true;
};
