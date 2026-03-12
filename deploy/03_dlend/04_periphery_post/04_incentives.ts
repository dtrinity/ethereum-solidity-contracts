import { ZeroAddress } from "ethers";
import { HardhatRuntimeEnvironment } from "hardhat/types";
import { DeployFunction } from "hardhat-deploy/types";

import { getConfig } from "../../../config/config";
import {
  EMISSION_MANAGER_ID,
  INCENTIVES_IMPL_ID,
  INCENTIVES_PROXY_ID,
  POOL_ADDRESSES_PROVIDER_ID,
  PULL_REWARDS_TRANSFER_STRATEGY_ID,
} from "../../../typescript/deploy-ids";

const func: DeployFunction = async function (hre: HardhatRuntimeEnvironment) {
  const { deployments, getNamedAccounts, ethers } = hre;
  const { deploy, save, getExtendedArtifact } = deployments;
  const { deployer } = await getNamedAccounts();
  const config = await getConfig(hre);

  // Get AddressesProvider address
  const addressesProvider = await deployments.get(POOL_ADDRESSES_PROVIDER_ID);
  const addressesProviderInstance = await ethers.getContractAt(
    "PoolAddressesProvider",
    addressesProvider.address,
    await ethers.getSigner(deployer),
  );

  // Deploy EmissionManager
  const emissionManager = await deploy(EMISSION_MANAGER_ID, {
    from: deployer,
    args: [deployer],
    log: true,
    waitConfirmations: 1,
  });

  // Deploy Incentives Implementation (RewardsController)
  const incentivesImpl = await deploy(INCENTIVES_IMPL_ID, {
    from: deployer,
    args: [emissionManager.address],
    log: true,
    waitConfirmations: 1,
  });

  const incentivesImplContract = await ethers.getContractAt("RewardsController", incentivesImpl.address);

  // Check if already initialized
  let isInitialized = false;

  try {
    const emissionManagerAddress = await incentivesImplContract.getEmissionManager();

    if (emissionManagerAddress && emissionManagerAddress !== ZeroAddress) {
      isInitialized = true;
      console.log(`  - RewardsController already initialized with emission manager: ${emissionManagerAddress}`);
    }
  } catch {
    // Not initialized yet
  }

  if (!isInitialized) {
    // Initialize the implementation
    try {
      await incentivesImplContract.initialize(ZeroAddress);
      console.log("  - RewardsController initialized");
    } catch (error: any) {
      console.log(`  - Failed to initialize RewardsController`);
      console.log(`  - Error: ${error?.message || error}`);
      throw Error(`Failed to initialize Incentives implementation: ${error}`);
    }
  } else {
    console.log("  - Skipping RewardsController initialization (already initialized)");
  }

  // The Rewards Controller must be set at AddressesProvider with id keccak256("INCENTIVES_CONTROLLER")
  const incentivesControllerId = ethers.keccak256(ethers.toUtf8Bytes("INCENTIVES_CONTROLLER"));

  const isRewardsProxyPending = (await addressesProviderInstance.getAddressFromID(incentivesControllerId)) === ZeroAddress;

  if (isRewardsProxyPending) {
    const proxyArtifact = await getExtendedArtifact("InitializableImmutableAdminUpgradeabilityProxy");

    await addressesProviderInstance.setAddressAsProxy(incentivesControllerId, incentivesImpl.address);

    const proxyAddress = await addressesProviderInstance.getAddressFromID(incentivesControllerId);

    await save(INCENTIVES_PROXY_ID, {
      ...proxyArtifact,
      address: proxyAddress,
    });
  }

  const incentivesProxyAddress = (await deployments.getOrNull(INCENTIVES_PROXY_ID))?.address;

  // Initialize EmissionManager with the rewards controller address
  const emissionManagerContract = await ethers.getContractAt("EmissionManager", emissionManager.address);

  if (incentivesProxyAddress) {
    await emissionManagerContract.setRewardsController(incentivesProxyAddress);
  } else {
    console.log("Warning: IncentivesProxy address is undefined, skipping setRewardsController");
  }

  // Deploy Rewards Strategies
  await deploy(PULL_REWARDS_TRANSFER_STRATEGY_ID, {
    from: deployer,
    args: [
      incentivesProxyAddress,
      config.walletAddresses.governanceMultisig, // This is the REWARDS_ADMIN
      config.walletAddresses.incentivesVault, // This is where we pull the rewards from
    ],
    log: true,
    waitConfirmations: 1,
  });

  // Set incentives controller on all existing reserve tokens (aToken, variableDebt, stableDebt).
  // Reserves are initialized with ZeroAddress because Incentives deploys after init_reserves.
  if (incentivesProxyAddress && config.dLend?.reservesConfig) {
    const poolAddress = await addressesProviderInstance.getPool();
    const poolContract = await ethers.getContractAt("Pool", poolAddress, await ethers.getSigner(deployer));
    const reserveSymbols = Object.keys(config.dLend.reservesConfig);

    for (const symbol of reserveSymbols) {
      let underlyingAddress = config.tokenAddresses[symbol as keyof typeof config.tokenAddresses];

      if (!underlyingAddress) {
        const dep = await deployments.getOrNull(symbol);
        if (dep?.address) underlyingAddress = dep.address;
      }
      if (!underlyingAddress) continue;

      const reserveData = await poolContract.getReserveData(underlyingAddress);
      if (reserveData.aTokenAddress === ZeroAddress) continue; // reserve not initialized

      const tokens: { addr: string; contractName: string; label: string }[] = [
        { addr: reserveData.aTokenAddress, contractName: "AToken", label: "aToken" },
        { addr: reserveData.variableDebtTokenAddress, contractName: "VariableDebtToken", label: "variableDebtToken" },
        { addr: reserveData.stableDebtTokenAddress, contractName: "StableDebtToken", label: "stableDebtToken" },
      ];

      for (const { addr, contractName, label } of tokens) {
        try {
          const tokenContract = await ethers.getContractAt(contractName, addr, await ethers.getSigner(deployer));
          const current = await tokenContract.getIncentivesController();

          if (current === ZeroAddress) {
            await tokenContract.setIncentivesController(incentivesProxyAddress);
            console.log(`  - Set incentives controller on ${symbol} ${label}`);
          }
        } catch (err: unknown) {
          const msg = err instanceof Error ? err.message : String(err);
          console.warn(`  - Could not set incentives controller on ${symbol} ${label}: ${msg}`);
          console.warn("    Caller must have POOL_ADMIN.");
        }
      }
    }
  }

  console.log(`🏦 ${__filename.split("/").slice(-2).join("/")}: ✅`);

  return true;
};

func.id = "dLend:Incentives";
func.tags = ["dlend", "dlend-periphery-post"];
func.dependencies = ["dlend-core", "dlend-periphery-pre", "dlend-market", "PoolAddressesProvider"];

export default func;
