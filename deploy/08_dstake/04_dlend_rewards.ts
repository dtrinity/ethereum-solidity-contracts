import { ethers } from "hardhat";
import { HardhatRuntimeEnvironment } from "hardhat/types";
import { DeployFunction } from "hardhat-deploy/types";

import { getConfig } from "../../config/config";
import { DLendRewardManagerConfig, DStakeInstanceConfig } from "../../config/types";
import {
  EmissionManager__factory as EmissionManagerFactory,
  RewardsController__factory as RewardsControllerFactory,
} from "../../typechain-types";
import {
  DETH_A_TOKEN_WRAPPER_ID,
  DSTAKE_COLLATERAL_VAULT_ID_PREFIX,
  DSTAKE_ROUTER_ID_PREFIX,
  DUSD_A_TOKEN_WRAPPER_ID,
  EMISSION_MANAGER_ID,
  INCENTIVES_PROXY_ID,
  POOL_DATA_PROVIDER_ID,
} from "../../typescript/deploy-ids";

const ADAPTER_ACCESS_ABI = ["function setAuthorizedCaller(address caller, bool authorized) external"];

/**
 * Authorizes reward managers to pull rewards from adapters when both addresses are valid.
 *
 * @param adapterAddress Address of adapter contract managing authorized callers.
 * @param caller Reward manager or router address that should be granted access.
 * @param signer Signer capable of executing the authorization transaction.
 */
async function ensureAdapterAuthorizedCaller(
  adapterAddress: string,
  caller: string,
  signer: Awaited<ReturnType<typeof ethers.getSigner>>,
): Promise<void> {
  if (!adapterAddress || adapterAddress === ethers.ZeroAddress || !caller || caller === ethers.ZeroAddress) {
    return;
  }

  const adapter = await ethers.getContractAt(ADAPTER_ACCESS_ABI, adapterAddress, signer);

  try {
    await adapter.setAuthorizedCaller(caller, true);
  } catch (error) {
    console.warn(
      `⚠️  Unable to authorize caller ${caller} on adapter ${adapterAddress}: ${error instanceof Error ? error.message : error}`,
    );
  }
}

const func: DeployFunction = async function (hre: HardhatRuntimeEnvironment) {
  const { deployments, getNamedAccounts } = hre;
  const { deploy } = deployments;
  const { deployer } = await getNamedAccounts();

  // Collect instructions for any manual actions required when the deployer lacks permissions.
  const manualActions: string[] = [];

  const config = await getConfig(hre);

  if (!config.dStake) {
    console.log("No dSTAKE configuration found for this network. Skipping dLend rewards manager deployment.");
    return;
  }

  const deployerSigner = await ethers.getSigner(deployer);

  // --- Validation Loop ---
  for (const instanceKey in config.dStake) {
    const instanceConfig = config.dStake[instanceKey] as DStakeInstanceConfig;
    const rewardManagerConfig = instanceConfig.dLendRewardManager as DLendRewardManagerConfig | undefined;

    if (!rewardManagerConfig) {
      // dLend rewards are optional; skip instances that don't configure a rewards manager.
      console.log(`No dLendRewardManager configuration for ${instanceKey}. Skipping dLend rewards deployment for this instance.`);
      continue;
    }

    if (!instanceConfig.dStable || instanceConfig.dStable === "" || instanceConfig.dStable === ethers.ZeroAddress) {
      console.warn(`Skipping dLendRewardManager deployment for ${instanceKey}: dStable address not configured.`);
      continue;
    }

    // Fetch required addresses *within* the deploy script execution flow,
    // ensuring dependencies have been run.
    const incentivesProxyDeployment = await deployments.get(INCENTIVES_PROXY_ID);

    // Fetch the AaveProtocolDataProvider and get the aToken address for this instance's underlying stablecoin
    const underlyingStablecoinAddress = instanceConfig.dStable;
    const poolDataProviderDeployment = await deployments.get(POOL_DATA_PROVIDER_ID);
    const poolDataProviderContract = await ethers.getContractAt("AaveProtocolDataProvider", poolDataProviderDeployment.address);
    const reserveTokens = await poolDataProviderContract.getReserveTokensAddresses(underlyingStablecoinAddress);
    const aTokenAddress = reserveTokens.aTokenAddress;

    let { managedStrategyShare, treasury, maxTreasuryFeeBps, initialTreasuryFeeBps, initialExchangeThreshold } = rewardManagerConfig;

    if (!managedStrategyShare || managedStrategyShare === ethers.ZeroAddress || managedStrategyShare === "") {
      const inferredWrapperId =
        instanceConfig.symbol === "sdUSD"
          ? DUSD_A_TOKEN_WRAPPER_ID
          : instanceConfig.symbol === "sdETH"
            ? DETH_A_TOKEN_WRAPPER_ID
            : undefined;

      if (inferredWrapperId) {
        const wrapperDeployment = await deployments.getOrNull(inferredWrapperId);

        if (wrapperDeployment) {
          managedStrategyShare = wrapperDeployment.address;
        }
      }
    }

    let dLendAssetToClaimFor = rewardManagerConfig.dLendAssetToClaimFor;

    if (!dLendAssetToClaimFor || dLendAssetToClaimFor === ethers.ZeroAddress) {
      dLendAssetToClaimFor = aTokenAddress;
    }

    let dLendRewardsController = rewardManagerConfig.dLendRewardsController;

    if (!dLendRewardsController || dLendRewardsController === ethers.ZeroAddress) {
      dLendRewardsController = incentivesProxyDeployment.address;
    }

    if (!treasury || treasury === "" || treasury === ethers.ZeroAddress) {
      treasury = deployer;
    }

    if (
      !managedStrategyShare ||
      managedStrategyShare === ethers.ZeroAddress ||
      !dLendAssetToClaimFor ||
      dLendAssetToClaimFor === ethers.ZeroAddress ||
      !dLendRewardsController ||
      dLendRewardsController === ethers.ZeroAddress ||
      !treasury ||
      treasury === ethers.ZeroAddress
    ) {
      const missing: string[] = [];
      if (!managedStrategyShare || managedStrategyShare === ethers.ZeroAddress) missing.push("managedStrategyShare");
      if (!dLendAssetToClaimFor || dLendAssetToClaimFor === ethers.ZeroAddress) missing.push("dLendAssetToClaimFor (aToken)");
      if (!dLendRewardsController || dLendRewardsController === ethers.ZeroAddress) missing.push("dLendRewardsController");
      if (!treasury || treasury === ethers.ZeroAddress) missing.push("treasury");

      throw new Error(`Missing critical addresses in dLendRewardManager config for ${instanceKey}: ${missing.join(", ")}`);
    }

    if (
      typeof maxTreasuryFeeBps !== "number" ||
      maxTreasuryFeeBps < 0 ||
      typeof initialTreasuryFeeBps !== "number" ||
      initialTreasuryFeeBps < 0 ||
      typeof initialExchangeThreshold !== "bigint" ||
      initialExchangeThreshold < 0n
    ) {
      throw new Error(`Invalid fee/threshold numbers in dLendRewardManager config for ${instanceKey}.`);
    }

    // The config loop serves as validation, the actual deployment logic will be outside
    // or modified to use the already fetched addresses.
  }

  // Actual deployment logic using fetched addresses
  for (const instanceKey in config.dStake) {
    const instanceConfig = config.dStake[instanceKey] as DStakeInstanceConfig;
    const rewardManagerConfig = instanceConfig.dLendRewardManager as DLendRewardManagerConfig | undefined;

    if (!rewardManagerConfig) {
      console.log(`No dLendRewardManager configuration for dSTAKE instance ${instanceKey}. Skipping.`);
      continue;
    }

    let managedStrategyShare = rewardManagerConfig.managedStrategyShare;

    if (!managedStrategyShare || managedStrategyShare === ethers.ZeroAddress || managedStrategyShare === "") {
      const inferredWrapperId =
        instanceConfig.symbol === "sdUSD"
          ? DUSD_A_TOKEN_WRAPPER_ID
          : instanceConfig.symbol === "sdETH"
            ? DETH_A_TOKEN_WRAPPER_ID
            : undefined;

      if (inferredWrapperId) {
        const wrapperDeployment = await deployments.getOrNull(inferredWrapperId);

        if (wrapperDeployment) {
          managedStrategyShare = wrapperDeployment.address;
        }
      }
    }

    if (!managedStrategyShare || managedStrategyShare === ethers.ZeroAddress || managedStrategyShare === "") {
      console.warn(`Skipping dLend rewards for ${instanceKey}: managedStrategyShare could not be resolved.`);
      continue;
    }

    let treasury = rewardManagerConfig.treasury;

    if (!treasury || treasury === "" || treasury === ethers.ZeroAddress) {
      treasury = deployer;
    }

    const symbol = instanceConfig.symbol;
    const collateralVaultDeployment = await deployments.getOrNull(`${DSTAKE_COLLATERAL_VAULT_ID_PREFIX}_${symbol}`);
    const routerDeployment = await deployments.getOrNull(`${DSTAKE_ROUTER_ID_PREFIX}_${symbol}`);

    if (!collateralVaultDeployment || !routerDeployment) {
      console.warn(
        `Skipping dLend rewards manager deployment for ${instanceKey}: dSTAKE core components not found (vault: ${!!collateralVaultDeployment}, router: ${!!routerDeployment}).`,
      );
      continue;
    }

    const dStakeCollateralVaultAddress = collateralVaultDeployment.address;
    const dStakeRouterAddress = routerDeployment.address;

    const targetStaticATokenWrapperAddress = managedStrategyShare;
    const underlyingStablecoinAddress = instanceConfig.dStable; // from parent DStakeInstanceConfig

    let dLendAssetToClaimForAddress = rewardManagerConfig.dLendAssetToClaimFor;

    if (!dLendAssetToClaimForAddress || dLendAssetToClaimForAddress === ethers.ZeroAddress) {
      const poolDataProviderDeployment = await deployments.get(POOL_DATA_PROVIDER_ID);
      const poolDataProviderContract = await ethers.getContractAt("AaveProtocolDataProvider", poolDataProviderDeployment.address);
      const reserveTokens = await poolDataProviderContract.getReserveTokensAddresses(underlyingStablecoinAddress);
      dLendAssetToClaimForAddress = reserveTokens.aTokenAddress;
    }

    if (!dLendAssetToClaimForAddress || dLendAssetToClaimForAddress === ethers.ZeroAddress) {
      console.warn(
        `Skipping dLend rewards for ${instanceKey}: could not determine aToken for underlying stable ${underlyingStablecoinAddress}.`,
      );
      continue;
    }

    let rewardsControllerAddress = rewardManagerConfig.dLendRewardsController;

    if (!rewardsControllerAddress || rewardsControllerAddress === ethers.ZeroAddress) {
      const incentivesProxyDeployment = await deployments.get(INCENTIVES_PROXY_ID);
      rewardsControllerAddress = incentivesProxyDeployment.address;
    }

    const deployArgs = [
      dStakeCollateralVaultAddress,
      dStakeRouterAddress,
      rewardsControllerAddress, // dLendRewardsController
      targetStaticATokenWrapperAddress, // targetStaticATokenWrapper
      dLendAssetToClaimForAddress, // dLendAssetToClaimFor (the actual aToken)
      treasury,
      rewardManagerConfig.maxTreasuryFeeBps,
      rewardManagerConfig.initialTreasuryFeeBps,
      rewardManagerConfig.initialExchangeThreshold,
    ];

    const rewardManagerDeploymentName = `DStakeRewardManagerDLend_${instanceKey}`;
    const deployment = await deploy(rewardManagerDeploymentName, {
      from: deployer,
      contract: "DStakeRewardManagerDLend",
      args: deployArgs,
      log: true,
      skipIfAlreadyDeployed: true,
    });

    // Authorize this manager as a claimer via EmissionManager
    const emissionManagerDeployment = await deployments.get(EMISSION_MANAGER_ID);
    const emissionManager = EmissionManagerFactory.connect(emissionManagerDeployment.address, deployerSigner);

    // Attempt to authorize this manager as a claimer only on first deploy; otherwise verify and skip.
    const emissionOwner = await emissionManager.owner();
    const rewardsController = await emissionManager.getRewardsController();
    const rewardsControllerContract = RewardsControllerFactory.connect(rewardsController, deployerSigner);
    const existingClaimer = await rewardsControllerContract.getClaimer(targetStaticATokenWrapperAddress);
    const needsClaimerUpdate = existingClaimer.toLowerCase() !== deployment.address.toLowerCase();

    if (needsClaimerUpdate) {
      if (emissionOwner.toLowerCase() === deployer.toLowerCase()) {
        const tx = await emissionManager.connect(deployerSigner).setClaimer(targetStaticATokenWrapperAddress, deployment.address);
        await tx.wait();
      } else {
        manualActions.push(
          `EmissionManager (${emissionManagerDeployment.address}).setClaimer(${targetStaticATokenWrapperAddress}, ${deployment.address})`,
        );
      }
    }

    // Authorize the rewards manager contract as an adapter caller (contract-to-contract auth).
    if (deployment.address) {
      const routerContract = await ethers.getContractAt("DStakeRouterV2", dStakeRouterAddress);

      // Authorize for the managed strategy share adapter
      const managedAdapterAddress = await routerContract.strategyShareToAdapter(targetStaticATokenWrapperAddress);
      await ensureAdapterAuthorizedCaller(managedAdapterAddress, deployment.address, deployerSigner);

      // Also authorize for the default deposit strategy adapter if different (e.g., Idle Vault)
      // This is required because the manager compounds by depositing into the default strategy.
      const defaultStrategyShare = await routerContract.defaultDepositStrategyShare();

      if (defaultStrategyShare !== ethers.ZeroAddress && defaultStrategyShare !== targetStaticATokenWrapperAddress) {
        const defaultAdapterAddress = await routerContract.strategyShareToAdapter(defaultStrategyShare);
        await ensureAdapterAuthorizedCaller(defaultAdapterAddress, deployment.address, deployerSigner);
      }

      console.log(`    Deployed DStakeRewardManagerDLend for ${instanceKey}.`);
    }
  }

  // After processing all instances, print any manual steps that are required.
  if (manualActions.length > 0) {
    console.log("\n⚠️  Manual actions required to finalize dLend rewards deployment:");
    manualActions.forEach((a: string) => console.log(`   - ${a}`));
  }

  console.log(`🥩 ${__filename.split("/").slice(-2).join("/")}: ✅`);
  return true;
};

export default func;
// Define tags and dependencies
func.tags = ["dStakeDLendRewards", "dStake"];
func.dependencies = ["dStakeConfigure"];

// Mark as executed once.
func.id = "dstake_dlend_rewards";
func.runAtTheEnd = true;
