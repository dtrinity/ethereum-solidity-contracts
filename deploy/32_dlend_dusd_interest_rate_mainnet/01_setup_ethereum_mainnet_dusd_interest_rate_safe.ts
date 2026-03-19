import { ZeroAddress } from "ethers";
import { HardhatRuntimeEnvironment } from "hardhat/types";
import { DeployFunction } from "hardhat-deploy/types";

import { getConfig } from "../../config/config";
import { DUSD_TOKEN_ID, POOL_ADDRESSES_PROVIDER_ID, POOL_DATA_PROVIDER_ID } from "../../typescript/deploy-ids";
import { isLocalNetwork, isMainnet } from "../../typescript/hardhat/deploy";
import { GovernanceExecutor } from "../../typescript/hardhat/governance";

/**
 * Normalizes addresses for case-insensitive comparisons.
 *
 * @param value Address to normalize.
 */
function normalize(value: string): string {
  return value.toLowerCase();
}

const func: DeployFunction = async function (hre: HardhatRuntimeEnvironment): Promise<boolean> {
  const runOnLocal = process.env.RUN_ON_LOCAL?.toLowerCase() === "true";

  if (isLocalNetwork(hre.network.name) && !runOnLocal) {
    console.log("🔁 setup-ethereum-mainnet-dusd-interest-rate-safe: local network detected – skipping");
    return true;
  }

  const { deployments, ethers } = hre;
  const { deployer } = await hre.getNamedAccounts();
  const signer = await ethers.getSigner(deployer);
  const config = await getConfig(hre);

  if (!config.dLend) {
    throw new Error(`dLend configuration is required for network ${hre.network.name}`);
  }

  const dUSDReserveConfig = config.dLend.reservesConfig.dUSD;

  if (!dUSDReserveConfig) {
    throw new Error(`dUSD reserve configuration is required for network ${hre.network.name}`);
  }

  const desiredStrategy = dUSDReserveConfig.strategy;
  const dUSDDeployment = await deployments.getOrNull(DUSD_TOKEN_ID);
  const dUSDAddress = config.tokenAddresses.dUSD || dUSDDeployment?.address;

  if (!dUSDAddress) {
    throw new Error(`Unable to resolve ${DUSD_TOKEN_ID} address on ${hre.network.name}`);
  }

  const { address: addressProviderAddress } = await deployments.get(POOL_ADDRESSES_PROVIDER_ID);
  const { address: poolDataProviderAddress } = await deployments.get(POOL_DATA_PROVIDER_ID);
  const addressProvider = await ethers.getContractAt("PoolAddressesProvider", addressProviderAddress, signer);
  const poolAddress = await addressProvider.getPool();
  const poolConfiguratorAddress = await addressProvider.getPoolConfigurator();
  const pool = await ethers.getContractAt("Pool", poolAddress, signer);
  const poolConfigurator = await ethers.getContractAt("PoolConfigurator", poolConfiguratorAddress, signer);
  const poolDataProvider = await ethers.getContractAt("AaveProtocolDataProvider", poolDataProviderAddress, signer);

  const deploymentName = `ReserveStrategy-${desiredStrategy.name}`;
  const strategyDeployment = await deployments.deploy(deploymentName, {
    contract: "DefaultReserveInterestRateStrategy",
    from: deployer,
    args: [
      addressProviderAddress,
      desiredStrategy.optimalUsageRatio,
      desiredStrategy.baseVariableBorrowRate,
      desiredStrategy.variableRateSlope1,
      desiredStrategy.variableRateSlope2,
      desiredStrategy.stableRateSlope1,
      desiredStrategy.stableRateSlope2,
      desiredStrategy.baseStableRateOffset,
      desiredStrategy.stableRateExcessOffset,
      desiredStrategy.optimalStableToTotalDebtRatio,
    ],
    log: true,
  });

  const reserveData = await pool.getReserveData(dUSDAddress);

  if (normalize(reserveData.aTokenAddress) === normalize(ZeroAddress)) {
    throw new Error(`dUSD reserve is not initialized on ${hre.network.name}`);
  }

  const [, , , , currentReserveFactor] = await poolDataProvider.getReserveConfigurationData(dUSDAddress);
  const targetReserveFactor = BigInt(dUSDReserveConfig.reserveFactor);
  const needsRateStrategyUpdate = normalize(reserveData.interestRateStrategyAddress) !== normalize(strategyDeployment.address);
  const needsReserveFactorUpdate = currentReserveFactor !== targetReserveFactor;

  if (!needsRateStrategyUpdate && !needsReserveFactorUpdate) {
    console.log("🔁 setup-ethereum-mainnet-dusd-interest-rate-safe: dUSD already matches target rate strategy and reserve factor");
    return true;
  }

  const executor = new GovernanceExecutor(hre, signer, config.safeConfig);

  if (isMainnet(hre.network.name) && !executor.useSafe) {
    throw new Error("Safe config is required for the Ethereum mainnet dUSD interest rate rollout.");
  }

  await executor.initialize();

  if (executor.useSafe) {
    if (needsReserveFactorUpdate) {
      const data = poolConfigurator.interface.encodeFunctionData("setReserveFactor", [dUSDAddress, targetReserveFactor]);
      await executor.tryOrQueue(
        async () => {
          throw new Error("Direct execution disabled: queue Safe transaction instead.");
        },
        () => ({ to: poolConfiguratorAddress, value: "0", data }),
      );
    }

    if (needsRateStrategyUpdate) {
      const data = poolConfigurator.interface.encodeFunctionData("setReserveInterestRateStrategyAddress", [
        dUSDAddress,
        strategyDeployment.address,
      ]);
      await executor.tryOrQueue(
        async () => {
          throw new Error("Direct execution disabled: queue Safe transaction instead.");
        },
        () => ({ to: poolConfiguratorAddress, value: "0", data }),
      );
    }
  } else {
    if (needsReserveFactorUpdate) {
      const tx = await poolConfigurator.setReserveFactor(dUSDAddress, targetReserveFactor);
      await tx.wait();
    }

    if (needsRateStrategyUpdate) {
      const tx = await poolConfigurator.setReserveInterestRateStrategyAddress(dUSDAddress, strategyDeployment.address);
      await tx.wait();
    }
  }

  const success = await executor.flush("Ethereum mainnet dUSD interest rate curve update");

  if (!success) {
    throw new Error("Failed to flush dUSD interest rate curve Safe batch.");
  }

  console.log("🔁 setup-ethereum-mainnet-dusd-interest-rate-safe: ✅");
  return true;
};

func.tags = ["post-deploy", "dlend", "safe", "setup-ethereum-mainnet-dusd-interest-rate-safe"];
func.dependencies = [POOL_ADDRESSES_PROVIDER_ID, DUSD_TOKEN_ID];
func.id = "setup-ethereum-mainnet-dusd-interest-rate-safe-v1";

export default func;
