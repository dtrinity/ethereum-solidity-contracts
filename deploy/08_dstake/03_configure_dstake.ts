import { ethers } from "hardhat";
import { HardhatRuntimeEnvironment } from "hardhat/types";
import { DeployFunction } from "hardhat-deploy/types";

import { getConfig } from "../../config/config";
import { DStakeInstanceConfig } from "../../config/types";

const func: DeployFunction = async function (hre: HardhatRuntimeEnvironment) {
  const { deployments, getNamedAccounts } = hre;
  const { get } = deployments;
  const { deployer } = await getNamedAccounts();

  // Use deployer for all state-changing transactions. Permission migrations to the
  // designated admin and fee manager addresses will be handled in a separate
  // script executed after configuration.
  const deployerSigner = await ethers.getSigner(deployer);

  const config = await getConfig(hre);

  if (!config.dStake) {
    console.log("No dSTAKE configuration found for this network. Skipping configuration.");
    return;
  }

  // Validate all configs before configuring anything
  for (const instanceKey in config.dStake) {
    const instanceConfig = config.dStake[instanceKey] as DStakeInstanceConfig;

    if (!instanceConfig.dStable || instanceConfig.dStable === ethers.ZeroAddress) {
      throw new Error(`Missing dStable address for dSTAKE instance ${instanceKey}`);
    }

    if (!instanceConfig.symbol) {
      throw new Error(`Missing symbol for dSTAKE instance ${instanceKey}`);
    }

    if (!instanceConfig.name) {
      throw new Error(`Missing name for dSTAKE instance ${instanceKey}`);
    }

    if (!instanceConfig.initialAdmin || instanceConfig.initialAdmin === ethers.ZeroAddress) {
      throw new Error(`Missing initialAdmin for dSTAKE instance ${instanceKey}`);
    }

    if (!instanceConfig.initialFeeManager || instanceConfig.initialFeeManager === ethers.ZeroAddress) {
      throw new Error(`Missing initialFeeManager for dSTAKE instance ${instanceKey}`);
    }

    if (typeof instanceConfig.initialWithdrawalFeeBps !== "number") {
      throw new Error(`Missing initialWithdrawalFeeBps for dSTAKE instance ${instanceKey}`);
    }

    if (!instanceConfig.adapters || !Array.isArray(instanceConfig.adapters)) {
      throw new Error(`Missing adapters array for dSTAKE instance ${instanceKey}`);
    }

    if (!instanceConfig.defaultDepositVaultAsset || instanceConfig.defaultDepositVaultAsset === ethers.ZeroAddress) {
      throw new Error(`Missing defaultDepositVaultAsset for dSTAKE instance ${instanceKey}`);
    }

    if (!instanceConfig.collateralExchangers || !Array.isArray(instanceConfig.collateralExchangers)) {
      throw new Error(`Missing collateralExchangers array for dSTAKE instance ${instanceKey}`);
    }
  }

  // All configs are valid, proceed with configuration
  for (const instanceKey in config.dStake) {
    const instanceConfig = config.dStake[instanceKey] as DStakeInstanceConfig;
    const DStakeTokenDeploymentName = `DStakeToken_${instanceKey}`;
    const collateralVaultDeploymentName = `DStakeCollateralVault_${instanceKey}`;
    const routerDeploymentName = `DStakeRouter_${instanceKey}`;

    const collateralVaultDeployment = await get(collateralVaultDeploymentName);
    const routerDeployment = await get(routerDeploymentName);
    const dstakeTokenDeployment = await get(DStakeTokenDeploymentName);

    // (Permissions remain with the deployer; role migration happens later.)
    // Get Typechain instances
    const dstakeToken = await ethers.getContractAt(
      "DStakeTokenV2",
      dstakeTokenDeployment.address,
      await ethers.getSigner(deployer), // Use deployer as signer for read calls
    );
    const collateralVault = await ethers.getContractAt(
      "DStakeCollateralVaultV2",
      collateralVaultDeployment.address,
      await ethers.getSigner(deployer), // Use deployer as signer for read calls
    );

    // --- Configure DStakeToken ---
    const currentRouter = await dstakeToken.router();
    const currentVault = await dstakeToken.collateralVault();

    if (currentRouter !== routerDeployment.address || currentVault !== collateralVaultDeployment.address) {
      console.log(
        `    ⚙️ Migrating core for ${DStakeTokenDeploymentName} to router ${routerDeployment.address} and vault ${collateralVaultDeployment.address}`,
      );
      await dstakeToken
        .connect(deployerSigner)
        .migrateCore(routerDeployment.address, collateralVaultDeployment.address);
    }
    const currentFee = await dstakeToken.withdrawalFeeBps();

    if (currentFee.toString() !== instanceConfig.initialWithdrawalFeeBps.toString()) {
      console.log(`    ⚙️ Setting withdrawal fee for ${DStakeTokenDeploymentName} to ${instanceConfig.initialWithdrawalFeeBps}`);
      await dstakeToken.connect(deployerSigner).setWithdrawalFee(instanceConfig.initialWithdrawalFeeBps);
    }

    // --- Configure DStakeCollateralVault ---
    const routerContract = await ethers.getContractAt("DStakeRouterV2", routerDeployment.address, deployerSigner);

    const vaultRouter = await collateralVault.router();
    const vaultRouterRole = await collateralVault.ROUTER_ROLE();
    const isRouterRoleGranted = await collateralVault.hasRole(vaultRouterRole, routerDeployment.address);

    if (vaultRouter !== routerDeployment.address || !isRouterRoleGranted) {
      console.log(`    ⚙️ Setting router for ${collateralVaultDeploymentName} to ${routerDeployment.address}`);
      await collateralVault.connect(deployerSigner).setRouter(routerDeployment.address);
    }

    // --- Configure DStakeRouter Adapters ---
    for (const adapterConfig of instanceConfig.adapters) {
      const adapterDeploymentName = `${adapterConfig.adapterContract}_${instanceConfig.symbol}`;
      const adapterDeployment = await get(adapterDeploymentName);
      const strategyShare = adapterConfig.strategyShare;
      const existingAdapter = await routerContract.strategyShareToAdapter(strategyShare);

      if (existingAdapter === ethers.ZeroAddress) {
        await routerContract.addAdapter(strategyShare, adapterDeployment.address);
        console.log(
          `    ➕ Added adapter ${adapterDeploymentName} for strategy share ${strategyShare} to ${routerDeploymentName}`,
        );
      } else if (existingAdapter !== adapterDeployment.address) {
        throw new Error(
          `⚠️ Adapter for strategy share ${strategyShare} in router is already set to ${existingAdapter} but config expects ${adapterDeployment.address}. Manual intervention may be required.`,
        );
      } else {
        console.log(
          `    👍 Adapter ${adapterDeploymentName} for strategy share ${strategyShare} already configured correctly in ${routerDeploymentName}`,
        );
      }
    }

    // --- Configure Router Roles ---
    const strategyRebalancerRole = await routerContract.STRATEGY_REBALANCER_ROLE();

    for (const exchanger of instanceConfig.collateralExchangers) {
      const hasRole = await routerContract.hasRole(strategyRebalancerRole, exchanger);

      if (!hasRole) {
        await routerContract.grantRole(strategyRebalancerRole, exchanger);
        console.log(`    ➕ Granted STRATEGY_REBALANCER_ROLE to ${exchanger} for ${routerDeploymentName}`);
      }
    }

    // --- Configure Default Deposit Strategy ---
    if (instanceConfig.defaultDepositStrategyShare && instanceConfig.defaultDepositStrategyShare !== ethers.ZeroAddress) {
      const currentDefault = await routerContract.defaultDepositStrategyShare();

      if (currentDefault !== instanceConfig.defaultDepositStrategyShare) {
        await routerContract.setDefaultDepositStrategyShare(instanceConfig.defaultDepositStrategyShare);
        console.log(`    ⚙️ Set default deposit strategy share for ${routerDeploymentName}`);
      }
    }
  }

  console.log(`🥩 ${__filename.split("/").slice(-2).join("/")}: ✅`);
  return true;
};

export default func;
func.tags = ["dStakeConfigure", "dStake"];
func.dependencies = ["dStakeCore", "dStakeAdapters"];
func.runAtTheEnd = true;

// Prevent re-execution after successful run.
func.id = "configure_dstake";
