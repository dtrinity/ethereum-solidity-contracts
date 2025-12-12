import { ethers } from "hardhat";
import { HardhatRuntimeEnvironment } from "hardhat/types";
import { DeployFunction } from "hardhat-deploy/types";

import { getConfig } from "../../config/config";
import { DStakeInstanceConfig } from "../../config/types";
import {
  DETH_A_TOKEN_WRAPPER_ID,
  DSTAKE_COLLATERAL_VAULT_ID_PREFIX,
  DSTAKE_ROUTER_ID_PREFIX,
  DUSD_A_TOKEN_WRAPPER_ID,
} from "../../typescript/deploy-ids";

const ADAPTER_ACCESS_ABI = ["function setAuthorizedCaller(address caller, bool authorized) external"];
const ACCESS_CONTROL_ABI = [
  "function DEFAULT_ADMIN_ROLE() view returns (bytes32)",
  "function hasRole(bytes32 role, address account) view returns (bool)",
  "function grantRole(bytes32 role, address account) external",
  "function revokeRole(bytes32 role, address account) external",
];

/**
 * Grants router permissions to call adapter methods if both addresses are configured.
 *
 * @param adapterAddress Address of adapter contract that exposes `setAuthorizedCaller`.
 * @param caller Router or reward manager address we need to authorize.
 * @param signer Signer that has access to update the adapter's ACL.
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
  const deployerSigner = await ethers.getSigner(deployer);

  const config = await getConfig(hre);

  if (!config.dStake) {
    console.log("No dStake configuration found for this network. Skipping adapters.");
    return;
  }

  const manualActions: string[] = [];

  // All configs are valid, proceed with adapter deployment
  for (const instanceKey in config.dStake) {
    const instanceConfig = config.dStake[instanceKey] as DStakeInstanceConfig;
    const dStableSymbol = instanceConfig.symbol;
    const targetAdmin =
      instanceConfig.initialAdmin && instanceConfig.initialAdmin !== ethers.ZeroAddress ? instanceConfig.initialAdmin : undefined;

    if (!dStableSymbol) {
      console.warn(`Skipping adapter deployment for ${instanceKey}: missing symbol.`);
      continue;
    }

    if (!instanceConfig.dStable || instanceConfig.dStable === ethers.ZeroAddress) {
      console.warn(`Skipping adapter deployment for ${instanceKey}: dStable address not configured yet.`);
      continue;
    }
    const collateralVaultDeploymentName = `${DSTAKE_COLLATERAL_VAULT_ID_PREFIX}_${dStableSymbol}`;
    const routerDeploymentName = `${DSTAKE_ROUTER_ID_PREFIX}_${dStableSymbol}`;

    // Get the collateral vault address from deployment
    const collateralVault = await deployments.getOrNull(collateralVaultDeploymentName);

    if (!collateralVault) {
      console.log(`    Error: ${collateralVaultDeploymentName} not found. Make sure dStakeCore is deployed first.`);
      continue;
    }

    for (const adapterConfig of instanceConfig.adapters) {
      const { adapterContract } = adapterConfig;
      let { strategyShare } = adapterConfig;

      if (!adapterContract) {
        console.warn(`    Skipping adapter for ${dStableSymbol}: missing adapterContract field.`);
        continue;
      }

      // Resolve strategy share (wrapper/vault address) if not explicitly provided
      if (adapterContract === "WrappedDLendConversionAdapter") {
        // If no explicit strategyShare is provided, try to infer from known dLend wrappers
        if (!strategyShare || strategyShare === ethers.ZeroAddress) {
          const inferredWrapperId =
            dStableSymbol === "sdUSD" ? DUSD_A_TOKEN_WRAPPER_ID : dStableSymbol === "sdETH" ? DETH_A_TOKEN_WRAPPER_ID : undefined;

          if (inferredWrapperId) {
            const wrapperDeployment = await deployments.getOrNull(inferredWrapperId);

            if (wrapperDeployment) {
              strategyShare = wrapperDeployment.address;
            }
          }
        }
      }

      // Validate that we have a target address for the adapter
      if (!strategyShare || strategyShare === ethers.ZeroAddress) {
        console.warn(`    Skipping ${adapterContract} for ${dStableSymbol}: strategyShare (vault/wrapper) not configured or found.`);
        continue;
      }

      // Prepare constructor arguments based on adapter type
      let deployArgs: any[] = [];

      if (adapterContract === "WrappedDLendConversionAdapter") {
        // constructor(dStable, wrappedDLendToken, collateralVault)
        deployArgs = [instanceConfig.dStable, strategyShare, collateralVault.address];
      } else if (adapterContract === "GenericERC4626ConversionAdapter") {
        // constructor(dStable, vault, collateralVault)
        deployArgs = [instanceConfig.dStable, strategyShare, collateralVault.address];
      } else if (adapterContract === "MetaMorphoConversionAdapter") {
        // constructor(dStable, metaMorphoVault, collateralVault, initialAdmin)
        deployArgs = [instanceConfig.dStable, strategyShare, collateralVault.address, deployer];
      } else {
        console.warn(`    Unknown adapter type ${adapterContract}, skipping deployment.`);
        continue;
      }

      const deploymentName = `${adapterContract}_${dStableSymbol}`;
      const existingAdapter = await deployments.getOrNull(deploymentName);

      let adapterAddress: string;

      if (existingAdapter) {
        console.log(`    ${deploymentName} already exists at ${existingAdapter.address}. Skipping deployment.`);
        adapterAddress = existingAdapter.address;
      } else {
        const newDeployment = await deploy(deploymentName, {
          from: deployer,
          contract: adapterContract,
          args: deployArgs,
          log: true,
        });
        adapterAddress = newDeployment.address;
      }

      // If router exists, ensure adapter authorizes it
      const routerDeployment = await deployments.getOrNull(routerDeploymentName);

      if (routerDeployment) {
        await ensureAdapterAuthorizedCaller(adapterAddress, routerDeployment.address, deployerSigner);
      } else {
        console.warn(
          `    ⚠️  Router ${routerDeploymentName} not found. Remember to run this script again after deploying the router to set permissions.`,
        );
      }

      // Mainnet safety: migrate adapter admin role off the deployer when a target admin is configured.
      // (Adapters use AccessControl; leaving deployer as DEFAULT_ADMIN_ROLE is not acceptable for production.)
      if (targetAdmin) {
        try {
          const access = await ethers.getContractAt(ACCESS_CONTROL_ABI, adapterAddress, deployerSigner);
          const defaultAdminRole: string = await access.DEFAULT_ADMIN_ROLE();

          const adminHasRole = await access.hasRole(defaultAdminRole, targetAdmin);
          if (!adminHasRole) {
            await access.grantRole(defaultAdminRole, targetAdmin);
            console.log(`    ➕ Granted adapter DEFAULT_ADMIN_ROLE to ${targetAdmin} for ${deploymentName}`);
          }

          // Revoke deployer admin last to avoid locking ourselves out mid-script.
          const deployerHasRole = await access.hasRole(defaultAdminRole, deployer);
          if (deployerHasRole && targetAdmin.toLowerCase() !== deployer.toLowerCase()) {
            await access.revokeRole(defaultAdminRole, deployer);
            console.log(`    ➖ Revoked adapter DEFAULT_ADMIN_ROLE from deployer for ${deploymentName}`);
          }
        } catch (error) {
          manualActions.push(
            `Adapter (${adapterAddress}) admin migration: grantRole(DEFAULT_ADMIN_ROLE, ${targetAdmin}); revokeRole(DEFAULT_ADMIN_ROLE, ${deployer}). Error: ${
              error instanceof Error ? error.message : String(error)
            }`,
          );
        }
      }
    }
  }

  if (manualActions.length > 0) {
    console.log("\n⚠️  Manual actions required to finalize adapter admin migration:");
    manualActions.forEach((a) => console.log(`   - ${a}`));
  }

  console.log(`🥩 ${__filename.split("/").slice(-2).join("/")}: ✅`);
  return true;
};

export default func;
func.tags = ["dStakeAdapters", "dStake"];
func.dependencies = ["dStakeIdleVaults", "dStakeCore", "dLendCore", "dUSD-aTokenWrapper", "dETH-aTokenWrapper"];

// Ensure one-shot execution.
func.id = "deploy_dstake_adapters";
