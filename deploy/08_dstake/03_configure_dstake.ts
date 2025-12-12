import { ethers } from "hardhat";
import { HardhatRuntimeEnvironment } from "hardhat/types";
import { DeployFunction } from "hardhat-deploy/types";

import { getConfig } from "../../config/config";
import { DStakeInstanceConfig } from "../../config/types";
import { DStakeTokenV2__factory as DStakeTokenV2Factory } from "../../typechain-types/factories/contracts/vaults/dstake";
import { DStakeCollateralVaultV2__factory as DStakeCollateralVaultV2Factory } from "../../typechain-types/factories/contracts/vaults/dstake/DStakeCollateralVaultV2.sol";
import { DStakeRouterV2__factory as DStakeRouterV2Factory } from "../../typechain-types/factories/contracts/vaults/dstake/DStakeRouterV2.sol";
import {
  DETH_A_TOKEN_WRAPPER_ID,
  DSTAKE_COLLATERAL_VAULT_ID_PREFIX,
  DSTAKE_ROUTER_ID_PREFIX,
  DSTAKE_TOKEN_ID_PREFIX,
  DUSD_A_TOKEN_WRAPPER_ID,
} from "../../typescript/deploy-ids";

const func: DeployFunction = async function (hre: HardhatRuntimeEnvironment) {
  const { deployments, getNamedAccounts } = hre;
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

  // Collect manual steps for cases where deployer does not have permissions (e.g. partially-migrated deployments).
  const manualActions: string[] = [];

  // All configs are valid, proceed with configuration
  for (const instanceKey in config.dStake) {
    const instanceConfig = config.dStake[instanceKey] as DStakeInstanceConfig;
    const symbol = instanceConfig.symbol;

    if (!symbol) {
      console.warn(`Skipping configuration for dSTAKE instance ${instanceKey}: missing symbol.`);
      continue;
    }

    if (!instanceConfig.dStable || instanceConfig.dStable === ethers.ZeroAddress) {
      console.warn(`Skipping configuration for dSTAKE instance ${instanceKey}: dStable address not configured.`);
      continue;
    }

    if (!instanceConfig.name) {
      console.warn(`Skipping configuration for dSTAKE instance ${instanceKey}: missing token name.`);
      continue;
    }

    if (!instanceConfig.initialAdmin || instanceConfig.initialAdmin === ethers.ZeroAddress) {
      console.warn(`Skipping configuration for dSTAKE instance ${instanceKey}: missing initialAdmin.`);
      continue;
    }

    if (!instanceConfig.initialFeeManager || instanceConfig.initialFeeManager === ethers.ZeroAddress) {
      console.warn(`Skipping configuration for dSTAKE instance ${instanceKey}: missing initialFeeManager.`);
      continue;
    }

    if (!Array.isArray(instanceConfig.adapters) || instanceConfig.adapters.length === 0) {
      console.warn(`Skipping configuration for dSTAKE instance ${instanceKey}: no adapters configured.`);
      continue;
    }

    if (!Array.isArray(instanceConfig.collateralExchangers) || instanceConfig.collateralExchangers.length === 0) {
      console.warn(`Skipping configuration for dSTAKE instance ${instanceKey}: no collateral exchangers configured.`);
      continue;
    }
    const DStakeTokenDeploymentName = `${DSTAKE_TOKEN_ID_PREFIX}_${symbol}`;
    const collateralVaultDeploymentName = `${DSTAKE_COLLATERAL_VAULT_ID_PREFIX}_${symbol}`;
    const routerDeploymentName = `${DSTAKE_ROUTER_ID_PREFIX}_${symbol}`;

    const collateralVaultDeployment = await deployments.get(collateralVaultDeploymentName);
    const routerDeployment = await deployments.get(routerDeploymentName);
    const dstakeTokenDeployment = await deployments.get(DStakeTokenDeploymentName);

    // (Permissions remain with the deployer; role migration happens later.)
    // Get Typechain instances
    const dstakeToken = DStakeTokenV2Factory.connect(dstakeTokenDeployment.address, deployerSigner);
    const collateralVault = DStakeCollateralVaultV2Factory.connect(collateralVaultDeployment.address, deployerSigner);

    // --- Configure DStakeToken ---
    const currentRouter = await dstakeToken.router();
    const currentVault = await dstakeToken.collateralVault();

    if (currentRouter !== routerDeployment.address || currentVault !== collateralVaultDeployment.address) {
      console.log(
        `    ⚙️ Migrating core for ${DStakeTokenDeploymentName} to router ${routerDeployment.address} and vault ${collateralVaultDeployment.address}`,
      );
      await dstakeToken.connect(deployerSigner).migrateCore(routerDeployment.address, collateralVaultDeployment.address);
    }
    const currentFee = await dstakeToken.withdrawalFeeBps();

    if (currentFee.toString() !== instanceConfig.initialWithdrawalFeeBps.toString()) {
      console.log(`    ⚙️ Setting withdrawal fee for ${DStakeTokenDeploymentName} to ${instanceConfig.initialWithdrawalFeeBps}`);
      await dstakeToken.connect(deployerSigner).setWithdrawalFee(instanceConfig.initialWithdrawalFeeBps);
    }

    // --- Migrate Token Roles (DEFAULT_ADMIN_ROLE + FEE_MANAGER_ROLE) ---
    try {
      const tokenDefaultAdminRole = await dstakeToken.DEFAULT_ADMIN_ROLE();
      const tokenFeeManagerRole = await dstakeToken.FEE_MANAGER_ROLE();

      const targetTokenAdmin = instanceConfig.initialAdmin;
      const targetFeeManager = instanceConfig.initialFeeManager;

      if (targetTokenAdmin && targetTokenAdmin !== ethers.ZeroAddress) {
        if (!(await dstakeToken.hasRole(tokenDefaultAdminRole, targetTokenAdmin))) {
          await dstakeToken.grantRole(tokenDefaultAdminRole, targetTokenAdmin);
          console.log(`    ➕ Granted token DEFAULT_ADMIN_ROLE to ${targetTokenAdmin}`);
        }
      }

      if (targetFeeManager && targetFeeManager !== ethers.ZeroAddress) {
        if (!(await dstakeToken.hasRole(tokenFeeManagerRole, targetFeeManager))) {
          await dstakeToken.grantRole(tokenFeeManagerRole, targetFeeManager);
          console.log(`    ➕ Granted token FEE_MANAGER_ROLE to ${targetFeeManager}`);
        }
      }

      // Revoke deployer roles last (after grants) to avoid locking ourselves out mid-run.
      if (targetTokenAdmin.toLowerCase() !== deployer.toLowerCase()) {
        if (await dstakeToken.hasRole(tokenDefaultAdminRole, deployer)) {
          await dstakeToken.revokeRole(tokenDefaultAdminRole, deployer);
          console.log(`    ➖ Revoked token DEFAULT_ADMIN_ROLE from deployer`);
        }
      }

      if (targetFeeManager.toLowerCase() !== deployer.toLowerCase()) {
        if (await dstakeToken.hasRole(tokenFeeManagerRole, deployer)) {
          await dstakeToken.revokeRole(tokenFeeManagerRole, deployer);
          console.log(`    ➖ Revoked token FEE_MANAGER_ROLE from deployer`);
        }
      }
    } catch (error) {
      manualActions.push(
        `Token (${dstakeTokenDeployment.address}) role migration: grant DEFAULT_ADMIN_ROLE to ${instanceConfig.initialAdmin}, grant FEE_MANAGER_ROLE to ${instanceConfig.initialFeeManager}, revoke those roles from ${deployer}. Error: ${
          error instanceof Error ? error.message : String(error)
        }`,
      );
    }

    // --- Configure DStakeCollateralVault ---
    const routerContract = DStakeRouterV2Factory.connect(routerDeployment.address, deployerSigner);

    const vaultRouter = await collateralVault.router();
    const vaultRouterRole = await collateralVault.ROUTER_ROLE();
    const isRouterRoleGranted = await collateralVault.hasRole(vaultRouterRole, routerDeployment.address);

    if (vaultRouter !== routerDeployment.address || !isRouterRoleGranted) {
      console.log(`    ⚙️ Setting router for ${collateralVaultDeploymentName} to ${routerDeployment.address}`);
      await collateralVault.connect(deployerSigner).setRouter(routerDeployment.address);
    }

    // --- Migrate CollateralVault Admin ---
    try {
      const vaultDefaultAdminRole = await collateralVault.DEFAULT_ADMIN_ROLE();
      const targetAdmin = instanceConfig.initialAdmin;

      if (targetAdmin && targetAdmin !== ethers.ZeroAddress) {
        if (!(await collateralVault.hasRole(vaultDefaultAdminRole, targetAdmin))) {
          await collateralVault.grantRole(vaultDefaultAdminRole, targetAdmin);
          console.log(`    ➕ Granted collateral vault DEFAULT_ADMIN_ROLE to ${targetAdmin}`);
        }

        if (targetAdmin.toLowerCase() !== deployer.toLowerCase()) {
          if (await collateralVault.hasRole(vaultDefaultAdminRole, deployer)) {
            await collateralVault.revokeRole(vaultDefaultAdminRole, deployer);
            console.log(`    ➖ Revoked collateral vault DEFAULT_ADMIN_ROLE from deployer`);
          }
        }
      }
    } catch (error) {
      manualActions.push(
        `CollateralVault (${collateralVaultDeployment.address}) admin migration: grant DEFAULT_ADMIN_ROLE to ${instanceConfig.initialAdmin}; revoke DEFAULT_ADMIN_ROLE from ${deployer}. Error: ${
          error instanceof Error ? error.message : String(error)
        }`,
      );
    }

    // --- Configure DStakeRouter Adapters ---
    const vaultConfigsToApply: Array<{ strategyVault: string; adapter: string; targetBps: bigint; status: number }> = [];

    for (const adapterConfig of instanceConfig.adapters) {
      const adapterDeploymentName = `${adapterConfig.adapterContract}_${instanceConfig.symbol}`;
      const adapterDeployment = await deployments.getOrNull(adapterDeploymentName);

      if (!adapterDeployment) {
        throw new Error(
          `Adapter deployment ${adapterDeploymentName} missing. Ensure wrappers are deployed before running ${routerDeploymentName}.`,
        );
      }

      let strategyShare = adapterConfig.strategyShare;

      if (!strategyShare || strategyShare === "" || strategyShare === ethers.ZeroAddress) {
        const inferredWrapperId =
          instanceConfig.symbol === "sdUSD"
            ? DUSD_A_TOKEN_WRAPPER_ID
            : instanceConfig.symbol === "sdETH"
              ? DETH_A_TOKEN_WRAPPER_ID
              : undefined;

        if (!inferredWrapperId) {
          throw new Error(`Unable to infer strategy share for ${adapterDeploymentName}`);
        }

        const wrapperDeployment = await deployments.getOrNull(inferredWrapperId);

        if (!wrapperDeployment) {
          throw new Error(`Wrapper deployment ${inferredWrapperId} missing for adapter ${adapterDeploymentName}`);
        }

        strategyShare = wrapperDeployment.address;
      }

      const existingAdapter = await routerContract.strategyShareToAdapter(strategyShare);

      if (existingAdapter === ethers.ZeroAddress) {
        await routerContract.addAdapter(strategyShare, adapterDeployment.address);
        console.log(`    ➕ Added adapter ${adapterDeploymentName} for strategy share ${strategyShare} to ${routerDeploymentName}`);
      } else if (existingAdapter !== adapterDeployment.address) {
        throw new Error(
          `⚠️ Adapter for strategy share ${strategyShare} in router is already set to ${existingAdapter} but config expects ${adapterDeployment.address}. Manual intervention may be required.`,
        );
      } else {
        console.log(
          `    👍 Adapter ${adapterDeploymentName} for strategy share ${strategyShare} already configured correctly in ${routerDeploymentName}`,
        );
      }

      const targetBps = BigInt(adapterConfig.targetBps ?? 1_000_000);
      vaultConfigsToApply.push({ strategyVault: strategyShare, adapter: adapterDeployment.address, targetBps, status: 0 });
    }

    if (vaultConfigsToApply.length > 0) {
      const totalTarget = vaultConfigsToApply.reduce((acc, cfg) => acc + cfg.targetBps, 0n);

      if (totalTarget !== 1_000_000n) {
        throw new Error(`Vault target allocations for ${routerDeploymentName} must sum to 1,000,000 bps (received ${totalTarget})`);
      }

      await routerContract.setVaultConfigs(
        vaultConfigsToApply.map((cfg) => ({
          strategyVault: cfg.strategyVault,
          adapter: cfg.adapter,
          targetBps: cfg.targetBps,
          status: cfg.status,
        })),
      );
      console.log(`    ⚙️ Configured ${vaultConfigsToApply.length} vault(s) for ${routerDeploymentName}`);
    }

    // --- Configure Router Roles ---
    const strategyRebalancerRole = await routerContract.STRATEGY_REBALANCER_ROLE();
    const defaultAdminRole = await routerContract.DEFAULT_ADMIN_ROLE();
    const configManagerRole = await routerContract.CONFIG_MANAGER_ROLE();
    const adapterManagerRole = await routerContract.ADAPTER_MANAGER_ROLE();
    const vaultManagerRole = await routerContract.VAULT_MANAGER_ROLE();
    const pauserRole = await routerContract.PAUSER_ROLE();

    const targetAdmin = instanceConfig.initialAdmin;

    if (targetAdmin && targetAdmin !== ethers.ZeroAddress) {
      if (!(await routerContract.hasRole(defaultAdminRole, targetAdmin))) {
        await routerContract.grantRole(defaultAdminRole, targetAdmin);
        console.log(`    ➕ Granted DEFAULT_ADMIN_ROLE to ${targetAdmin} for ${routerDeploymentName}`);
      }

      if (!(await routerContract.hasRole(configManagerRole, targetAdmin))) {
        await routerContract.grantRole(configManagerRole, targetAdmin);
        console.log(`    ➕ Granted CONFIG_MANAGER_ROLE to ${targetAdmin} for ${routerDeploymentName}`);
      }

      if (!(await routerContract.hasRole(adapterManagerRole, targetAdmin))) {
        await routerContract.grantRole(adapterManagerRole, targetAdmin);
        console.log(`    ➕ Granted ADAPTER_MANAGER_ROLE to ${targetAdmin} for ${routerDeploymentName}`);
      }

      if (!(await routerContract.hasRole(vaultManagerRole, targetAdmin))) {
        await routerContract.grantRole(vaultManagerRole, targetAdmin);
        console.log(`    ➕ Granted VAULT_MANAGER_ROLE to ${targetAdmin} for ${routerDeploymentName}`);
      }

      if (!(await routerContract.hasRole(pauserRole, targetAdmin))) {
        await routerContract.grantRole(pauserRole, targetAdmin);
        console.log(`    ➕ Granted PAUSER_ROLE to ${targetAdmin} for ${routerDeploymentName}`);
      }
    }

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

    // --- Revoke Deployer Roles (post-configuration, mainnet safety) ---
    // We do this at the very end so deployer can still finish configuration using its constructor-granted roles.
    try {
      if (targetAdmin && targetAdmin !== ethers.ZeroAddress && targetAdmin.toLowerCase() !== deployer.toLowerCase()) {
        const rolesToRevoke = [configManagerRole, adapterManagerRole, vaultManagerRole, pauserRole];

        for (const role of rolesToRevoke) {
          if (await routerContract.hasRole(role, deployer)) {
            await routerContract.revokeRole(role, deployer);
            console.log(`    ➖ Revoked router role ${role} from deployer for ${routerDeploymentName}`);
          }
        }

        // Revoke strategy rebalancer from deployer if deployer is not explicitly listed as an exchanger.
        const deployerIsExchanger = instanceConfig.collateralExchangers.some((x) => x.toLowerCase() === deployer.toLowerCase());

        if (!deployerIsExchanger && (await routerContract.hasRole(strategyRebalancerRole, deployer))) {
          await routerContract.revokeRole(strategyRebalancerRole, deployer);
          console.log(`    ➖ Revoked STRATEGY_REBALANCER_ROLE from deployer for ${routerDeploymentName}`);
        }

        // Default admin last (only after all grants are complete).
        if (await routerContract.hasRole(defaultAdminRole, deployer)) {
          await routerContract.revokeRole(defaultAdminRole, deployer);
          console.log(`    ➖ Revoked DEFAULT_ADMIN_ROLE from deployer for ${routerDeploymentName}`);
        }
      }
    } catch (error) {
      manualActions.push(
        `Router (${routerDeployment.address}) role revocation from deployer failed. Please revoke deployer roles manually after ensuring ${targetAdmin} holds admin/config roles. Error: ${
          error instanceof Error ? error.message : String(error)
        }`,
      );
    }
  }

  if (manualActions.length > 0) {
    console.log("\n⚠️  Manual actions required to finalize dSTAKE configuration / role migrations:");
    manualActions.forEach((a) => console.log(`   - ${a}`));
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
