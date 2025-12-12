import { ethers } from "hardhat";
import { HardhatRuntimeEnvironment } from "hardhat/types";
import { DeployFunction } from "hardhat-deploy/types";

import { getConfig } from "../../config/config";
import { DStakeInstanceConfig } from "../../config/types";

/**
 * Deploys per-instance DStakeIdleVault strategy vaults (ERC4626) that hold idle dStable.
 *
 * Deployment names:
 * - DStakeIdleVault_sdUSD
 * - DStakeIdleVault_sdETH
 *
 * These are intended to be used as the initial/default dSTAKE strategy vault on mainnet
 * (100% allocation), with other strategies optionally whitelisted at 0%.
 *
 * @param hre
 */
const func: DeployFunction = async function (hre: HardhatRuntimeEnvironment) {
  const { deployments, getNamedAccounts } = hre;
  const { deploy } = deployments;
  const { deployer } = await getNamedAccounts();

  const config = await getConfig(hre);

  if (!config.dStake) {
    console.log("No dStake configuration found for this network. Skipping idle vault deployment.");
    return;
  }

  for (const instanceKey in config.dStake) {
    const instanceConfig = config.dStake[instanceKey] as DStakeInstanceConfig;
    const symbol = instanceConfig.symbol;

    if (!symbol) {
      console.warn(`Skipping idle vault for ${instanceKey}: missing symbol.`);
      continue;
    }

    if (!instanceConfig.dStable || instanceConfig.dStable === ethers.ZeroAddress) {
      console.warn(`Skipping idle vault for ${instanceKey}: dStable address not configured.`);
      continue;
    }

    const deploymentName = `DStakeIdleVault_${symbol}`;
    const existing = await deployments.getOrNull(deploymentName);

    if (existing) {
      console.log(`    ${deploymentName} already exists at ${existing.address}. Skipping deployment.`);
      continue;
    }

    const idleCfg = instanceConfig.idleVault;
    const admin =
      idleCfg?.admin && idleCfg.admin !== ethers.ZeroAddress
        ? idleCfg.admin
        : instanceConfig.initialAdmin && instanceConfig.initialAdmin !== ethers.ZeroAddress
          ? instanceConfig.initialAdmin
          : deployer;
    const rewardManager = idleCfg?.rewardManager && idleCfg.rewardManager !== ethers.ZeroAddress ? idleCfg.rewardManager : admin; // reasonable default: same Safe

    const name = idleCfg?.name ?? `dSTAKE Idle Vault ${symbol}`;
    const idleSymbol = idleCfg?.symbol ?? `idle${symbol}`;

    await deploy(deploymentName, {
      from: deployer,
      contract: "DStakeIdleVault",
      args: [instanceConfig.dStable, name, idleSymbol, admin, rewardManager],
      log: true,
      skipIfAlreadyDeployed: true,
    });
  }

  console.log(`🥩 ${__filename.split("/").slice(-2).join("/")}: ✅`);
};

export default func;
func.tags = ["dStakeIdleVaults", "dStake"];
func.dependencies = ["dStable"];
func.id = "deploy_dstake_idle_vaults";
