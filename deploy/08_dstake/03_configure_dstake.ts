import { ethers } from "hardhat";
import { HardhatRuntimeEnvironment } from "hardhat/types";
import { DeployFunction } from "hardhat-deploy/types";
import type { Signer } from "ethers";

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

async function ensureRole(params: {
  contract: any;
  role: string;
  roleLabel: string;
  account: string;
  signer: Signer;
  contractLabel: string;
}) {
  const { contract, role, roleLabel, account, signer, contractLabel } = params;
  const signerAddress = await signer.getAddress();

  const alreadyHasRole = await contract.hasRole(role, account);
  if (alreadyHasRole) return;

  const adminRole = await contract.getRoleAdmin(role);
  const signerCanGrant = await contract.hasRole(adminRole, signerAddress);
  if (!signerCanGrant) {
    throw new Error(`Deployer ${signerAddress} cannot grant ${roleLabel} on ${contractLabel}: missing admin role ${adminRole}`);
  }

  await contract.connect(signer).grantRole(role, account);
  console.log(`    🔑 Granted ${roleLabel} to ${account} on ${contractLabel}`);
}

async function ensureRouterModulesWired(params: {
  deployments: HardhatRuntimeEnvironment["deployments"];
  router: any;
  routerDeploymentName: string;
  deployer: string;
  deployerSigner: Signer;
}) {
  const { deployments, router, routerDeploymentName, deployer, deployerSigner } = params;

  const currentGovernanceModule = await router.governanceModule();
  if (currentGovernanceModule === ethers.ZeroAddress) {
    const governanceModuleDeployment = await deployments.getOrNull(`${routerDeploymentName}_GovernanceModule`);
    if (!governanceModuleDeployment) {
      throw new Error(
        `Router ${routerDeploymentName} has governanceModule unset, but deployment ${routerDeploymentName}_GovernanceModule is missing`,
      );
    }

    await ensureRole({
      contract: router,
      role: await router.DEFAULT_ADMIN_ROLE(),
      roleLabel: "DEFAULT_ADMIN_ROLE",
      account: deployer,
      signer: deployerSigner,
      contractLabel: routerDeploymentName,
    });

    console.log(`    ⚙️ Wiring governance module for ${routerDeploymentName} to ${governanceModuleDeployment.address}`);
    await router.connect(deployerSigner).setGovernanceModule(governanceModuleDeployment.address);
  }

  const currentRebalanceModule = await router.rebalanceModule();
  if (currentRebalanceModule === ethers.ZeroAddress) {
    const rebalanceModuleDeployment = await deployments.getOrNull(`${routerDeploymentName}_RebalanceModule`);
    if (!rebalanceModuleDeployment) {
      // Rebalance is not needed for the configure steps below; keep it as a warning to avoid hard failure.
      console.warn(
        `    ⚠️ Router ${routerDeploymentName} has rebalanceModule unset and ${routerDeploymentName}_RebalanceModule is missing`,
      );
      return;
    }

    await ensureRole({
      contract: router,
      role: await router.DEFAULT_ADMIN_ROLE(),
      roleLabel: "DEFAULT_ADMIN_ROLE",
      account: deployer,
      signer: deployerSigner,
      contractLabel: routerDeploymentName,
    });

    console.log(`    ⚙️ Wiring rebalance module for ${routerDeploymentName} to ${rebalanceModuleDeployment.address}`);
    await router.connect(deployerSigner).setRebalanceModule(rebalanceModuleDeployment.address);
  }
}

const func: DeployFunction = async function (hre: HardhatRuntimeEnvironment) {
  const { deployments, getNamedAccounts } = hre;
  const { deployer } = await getNamedAccounts();

  // Use deployer for all state-changing transactions. Permission migrations to the
  // designated admin and fee manager addresses should be handled outside of the
  // deploy scripts (e.g., via governance/Safe transactions) after configuration.
  const deployerSigner = await ethers.getSigner(deployer);

  const config = await getConfig(hre);

  if (!config.dStake) {
    console.log("No dSTAKE configuration found for this network. Skipping configuration.");
    return;
  }

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

    if (!Array.isArray(instanceConfig.adapters) || instanceConfig.adapters.length === 0) {
      console.warn(`Skipping configuration for dSTAKE instance ${instanceKey}: no adapters configured.`);
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
    const routerContract = DStakeRouterV2Factory.connect(routerDeployment.address, deployerSigner);

    // Ensure router delegatecall modules are wired before any config calls that delegate.
    // Without this, router entrypoints like setWithdrawalFee/addAdapter/setVaultConfigs revert with ModuleNotSet().
    await ensureRouterModulesWired({
      deployments,
      router: routerContract,
      routerDeploymentName,
      deployer,
      deployerSigner,
    });

    // --- Configure DStakeToken ---
    const currentRouter = await dstakeToken.router();
    const currentVault = await dstakeToken.collateralVault();

    if (currentRouter !== routerDeployment.address || currentVault !== collateralVaultDeployment.address) {
      // migrateCore is restricted to DEFAULT_ADMIN_ROLE on the token
      await ensureRole({
        contract: dstakeToken,
        role: await dstakeToken.DEFAULT_ADMIN_ROLE(),
        roleLabel: "DEFAULT_ADMIN_ROLE",
        account: deployer,
        signer: deployerSigner,
        contractLabel: DStakeTokenDeploymentName,
      });

      console.log(
        `    ⚙️ Migrating core for ${DStakeTokenDeploymentName} to router ${routerDeployment.address} and vault ${collateralVaultDeployment.address}`,
      );
      await dstakeToken.connect(deployerSigner).migrateCore(routerDeployment.address, collateralVaultDeployment.address);
    }
    const currentFee = await dstakeToken.withdrawalFeeBps();

    if (currentFee.toString() !== instanceConfig.initialWithdrawalFeeBps.toString()) {
      // setWithdrawalFee is restricted to FEE_MANAGER_ROLE on the token; ensure deployer has it for config
      await ensureRole({
        contract: dstakeToken,
        role: await dstakeToken.FEE_MANAGER_ROLE(),
        roleLabel: "FEE_MANAGER_ROLE",
        account: deployer,
        signer: deployerSigner,
        contractLabel: DStakeTokenDeploymentName,
      });

      console.log(`    ⚙️ Setting withdrawal fee for ${DStakeTokenDeploymentName} to ${instanceConfig.initialWithdrawalFeeBps}`);
      await dstakeToken.connect(deployerSigner).setWithdrawalFee(instanceConfig.initialWithdrawalFeeBps);
    }

    // --- Configure DStakeCollateralVault ---
    const vaultRouter = await collateralVault.router();
    const vaultRouterRole = await collateralVault.ROUTER_ROLE();
    const isRouterRoleGranted = await collateralVault.hasRole(vaultRouterRole, routerDeployment.address);

    if (vaultRouter !== routerDeployment.address || !isRouterRoleGranted) {
      // setRouter is restricted to DEFAULT_ADMIN_ROLE on the collateral vault
      await ensureRole({
        contract: collateralVault,
        role: await collateralVault.DEFAULT_ADMIN_ROLE(),
        roleLabel: "DEFAULT_ADMIN_ROLE",
        account: deployer,
        signer: deployerSigner,
        contractLabel: collateralVaultDeploymentName,
      });

      console.log(`    ⚙️ Setting router for ${collateralVaultDeploymentName} to ${routerDeployment.address}`);
      await collateralVault.connect(deployerSigner).setRouter(routerDeployment.address);
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
        // addAdapter is restricted to ADAPTER_MANAGER_ROLE on the router
        await ensureRole({
          contract: routerContract,
          role: await routerContract.ADAPTER_MANAGER_ROLE(),
          roleLabel: "ADAPTER_MANAGER_ROLE",
          account: deployer,
          signer: deployerSigner,
          contractLabel: routerDeploymentName,
        });

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

      // setVaultConfigs is restricted to VAULT_MANAGER_ROLE on the router
      await ensureRole({
        contract: routerContract,
        role: await routerContract.VAULT_MANAGER_ROLE(),
        roleLabel: "VAULT_MANAGER_ROLE",
        account: deployer,
        signer: deployerSigner,
        contractLabel: routerDeploymentName,
      });

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

    // --- Configure Default Deposit Strategy ---
    if (instanceConfig.defaultDepositStrategyShare && instanceConfig.defaultDepositStrategyShare !== ethers.ZeroAddress) {
      const currentDefault = await routerContract.defaultDepositStrategyShare();

      if (currentDefault !== instanceConfig.defaultDepositStrategyShare) {
        // setDefaultDepositStrategyShare is restricted to CONFIG_MANAGER_ROLE on the router
        await ensureRole({
          contract: routerContract,
          role: await routerContract.CONFIG_MANAGER_ROLE(),
          roleLabel: "CONFIG_MANAGER_ROLE",
          account: deployer,
          signer: deployerSigner,
          contractLabel: routerDeploymentName,
        });

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
