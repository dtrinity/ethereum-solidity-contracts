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
  POOL_ADDRESSES_PROVIDER_ID,
} from "../../typescript/deploy-ids";

const ADAPTER_ACCESS_ABI = ["function setAuthorizedCaller(address caller, bool authorized) external"];

async function ensureAdapterAuthorizedCaller(adapterAddress: string, caller: string, signer: Awaited<ReturnType<typeof ethers.getSigner>>) {
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

  // Fetch dLend PoolAddressesProvider address if needed by any adapter
  let dLendAddressesProviderAddress = "";
  const dLendProvider = await deployments.getOrNull(POOL_ADDRESSES_PROVIDER_ID);

  if (dLendProvider) {
    dLendAddressesProviderAddress = dLendProvider.address;
  }

  // All configs are valid, proceed with adapter deployment
  for (const instanceKey in config.dStake) {
    const instanceConfig = config.dStake[instanceKey] as DStakeInstanceConfig;
    const dStableSymbol = instanceConfig.symbol;

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
      let { vaultAsset } = adapterConfig;

      if (!adapterContract) {
        console.warn(`    Skipping adapter for ${dStableSymbol}: missing adapterContract field.`);
        continue;
      }

      if (adapterContract === "WrappedDLendConversionAdapter") {
        if (!dLendAddressesProviderAddress) {
          throw new Error(`dLend PoolAddressesProvider not deployed before ${adapterContract}_${dStableSymbol}`);
        }

        const inferredWrapperId =
          dStableSymbol === "sdUSD" ? DUSD_A_TOKEN_WRAPPER_ID : dStableSymbol === "sdETH" ? DETH_A_TOKEN_WRAPPER_ID : undefined;

        if ((!strategyShare || strategyShare === "" || strategyShare === ethers.ZeroAddress) && inferredWrapperId) {
          const wrapperDeployment = await deployments.getOrNull(inferredWrapperId);

          if (!wrapperDeployment) {
            throw new Error(`Wrapper ${inferredWrapperId} not deployed prior to ${adapterContract}_${dStableSymbol}`);
          }
          strategyShare = wrapperDeployment.address;
        }

        if ((!vaultAsset || vaultAsset === "" || vaultAsset === ethers.ZeroAddress) && strategyShare) {
          vaultAsset = strategyShare;
        }

        if (!strategyShare || strategyShare === ethers.ZeroAddress) {
          throw new Error(`strategyShare not configured for ${adapterContract}_${dStableSymbol}`);
        }

        if (!vaultAsset || vaultAsset === ethers.ZeroAddress) {
          throw new Error(`vaultAsset not configured for ${adapterContract}_${dStableSymbol}`);
        }

        const deploymentName = `${adapterContract}_${dStableSymbol}`;
        // Avoid accidental redeployments on live networks by skipping if already deployed
        const existingAdapter = await deployments.getOrNull(deploymentName);

        let adapterAddress: string;
        if (existingAdapter) {
          console.log(`    ${deploymentName} already exists at ${existingAdapter.address}. Skipping deployment.`);
          adapterAddress = existingAdapter.address;
        } else {
          const newDeployment = await deploy(deploymentName, {
            from: deployer,
            contract: adapterContract,
            args: [instanceConfig.dStable, vaultAsset, collateralVault.address],
            log: true,
          });
          adapterAddress = newDeployment.address;
        }

        // If router already exists, ensure adapter wiring is refreshed later (configure script handles mapping).
        const routerDeployment = await deployments.getOrNull(routerDeploymentName);

        if (!routerDeployment) {
          throw new Error(`Router ${routerDeploymentName} not found while deploying ${deploymentName}`);
        }

        await ensureAdapterAuthorizedCaller(adapterAddress, routerDeployment.address, deployerSigner);
      } else {
        if (!vaultAsset || vaultAsset === ethers.ZeroAddress) {
          throw new Error(`vaultAsset not configured for ${adapterContract}_${dStableSymbol}`);
        }
      }
    }
  }

  console.log(`🥩 ${__filename.split("/").slice(-2).join("/")}: ✅`);
  return true;
};

export default func;
func.tags = ["dStakeAdapters", "dStake"];
func.dependencies = ["dStakeCore", "dLendCore", "dUSD-aTokenWrapper", "dETH-aTokenWrapper"];

// Ensure one-shot execution.
func.id = "deploy_dstake_adapters";
