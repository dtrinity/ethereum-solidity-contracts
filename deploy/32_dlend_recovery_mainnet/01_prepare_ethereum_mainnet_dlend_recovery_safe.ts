import { HardhatRuntimeEnvironment } from "hardhat/types";
import { DeployFunction } from "hardhat-deploy/types";

import { getConfig } from "../../config/config";
import { DUSD_TOKEN_ID, POOL_ADDRESSES_PROVIDER_ID } from "../../typescript/deploy-ids";
import { isLocalNetwork } from "../../typescript/hardhat/deploy";
import { GovernanceExecutor } from "../../typescript/hardhat/governance";

const DEFAULT_CBBTC = "0xcbB7C0000aB88B473b1f5aFd9ef808440eed33Bf";

type DecodedReserveConfig = {
  ltv: bigint;
  liquidationThreshold: bigint;
  liquidationBonus: bigint;
  frozen: boolean;
  borrowingEnabled: boolean;
  stableRateBorrowingEnabled: boolean;
  paused: boolean;
  flashLoanEnabled: boolean;
};

/**
 * Decodes an Aave-v3-style config bitfield.
 *
 * @param value Packed config value.
 * @param start Start bit.
 * @param width Width in bits.
 */
function bit(value: bigint, start: bigint, width = 1n): bigint {
  return (value >> start) & ((1n << width) - 1n);
}

/**
 * Parses the recovery reserve list from env.
 */
function parseRecoveryReserves(): string[] {
  return JSON.parse(process.env.RECOVERY_RESERVES_JSON || "[]") as string[];
}

/**
 * Converts the raw config bitmap into named fields.
 *
 * @param data Raw reserve config.
 */
function decodeConfig(data: bigint): DecodedReserveConfig {
  return {
    ltv: bit(data, 0n, 16n),
    liquidationThreshold: bit(data, 16n, 16n),
    liquidationBonus: bit(data, 32n, 16n),
    frozen: bit(data, 57n) === 1n,
    borrowingEnabled: bit(data, 58n) === 1n,
    stableRateBorrowingEnabled: bit(data, 59n) === 1n,
    paused: bit(data, 60n) === 1n,
    flashLoanEnabled: bit(data, 63n) === 1n,
  };
}

const func: DeployFunction = async function (hre: HardhatRuntimeEnvironment): Promise<boolean> {
  if (isLocalNetwork(hre.network.name)) {
    console.log("🔁 setup-ethereum-mainnet-dlend-recovery-safe: local network detected - skipping");
    return true;
  }

  const config = await getConfig(hre);
  const { deployments, ethers } = hre;
  const { deployer } = await hre.getNamedAccounts();
  const signer = await ethers.getSigner(deployer);
  const executor = new GovernanceExecutor(hre, signer, config.safeConfig);

  if (!executor.useSafe || !config.safeConfig?.safeAddress) {
    throw new Error("Safe config is required for dLEND recovery batch generation. Provide config.safeConfig and enable Safe mode.");
  }

  await executor.initialize();

  const recoveryReserves = parseRecoveryReserves();

  if (recoveryReserves.length === 0) {
    throw new Error("RECOVERY_RESERVES_JSON must contain at least one reserve.");
  }

  const dUSDAddress = process.env.RECOVERY_DUSD_ADDRESS || config.tokenAddresses.dUSD || (await deployments.get(DUSD_TOKEN_ID)).address;
  const cbBtcAddress = process.env.RECOVERY_CBBTC_ADDRESS || config.tokenAddresses.cbBTC || DEFAULT_CBBTC;
  const setCbBtcLtvZero = (process.env.RECOVERY_SET_CBBTC_LTV_ZERO || "true").toLowerCase() === "true";

  if (!recoveryReserves.some((asset) => asset.toLowerCase() === dUSDAddress.toLowerCase())) {
    throw new Error("RECOVERY_RESERVES_JSON must include dUSD so the recovery batch unpauses it into frozen mode.");
  }

  const addressProviderDeployment = await deployments.get(POOL_ADDRESSES_PROVIDER_ID);
  const addressProvider = await ethers.getContractAt("PoolAddressesProvider", addressProviderDeployment.address, signer);
  const [poolAddress, poolConfiguratorAddress] = await Promise.all([addressProvider.getPool(), addressProvider.getPoolConfigurator()]);
  const [pool, poolConfigurator] = await Promise.all([
    ethers.getContractAt("Pool", poolAddress, signer),
    ethers.getContractAt("PoolConfigurator", poolConfiguratorAddress, signer),
  ]);

  const addSafeCall = async (txData: string): Promise<void> => {
    await executor.tryOrQueue(
      async () => {
        throw new Error("Direct execution disabled: queue Safe transaction instead.");
      },
      () => ({ to: poolConfiguratorAddress, value: "0", data: txData }),
    );
  };

  const queueReserveTransition = async (asset: string): Promise<void> => {
    const configRaw = await pool.getConfiguration(asset);
    const current = decodeConfig(BigInt(configRaw.data.toString()));

    if (current.stableRateBorrowingEnabled) {
      await addSafeCall(poolConfigurator.interface.encodeFunctionData("setReserveStableRateBorrowing", [asset, false]));
    }

    if (current.borrowingEnabled) {
      await addSafeCall(poolConfigurator.interface.encodeFunctionData("setReserveBorrowing", [asset, false]));
    }

    if (current.flashLoanEnabled) {
      await addSafeCall(poolConfigurator.interface.encodeFunctionData("setReserveFlashLoaning", [asset, false]));
    }

    if (!current.frozen) {
      await addSafeCall(poolConfigurator.interface.encodeFunctionData("setReserveFreeze", [asset, true]));
    }

    if (current.paused) {
      await addSafeCall(poolConfigurator.interface.encodeFunctionData("setReservePause", [asset, false]));
    }
  };

  for (const asset of recoveryReserves) {
    const normalized = asset.toLowerCase();

    if (normalized === cbBtcAddress.toLowerCase()) {
      throw new Error("cbBTC must stay paused and cannot be part of RECOVERY_RESERVES_JSON.");
    }

    if (normalized === dUSDAddress.toLowerCase()) {
      continue;
    }

    await queueReserveTransition(asset);
  }

  const cbBtcRawConfig = await pool.getConfiguration(cbBtcAddress);
  const cbBtcConfig = decodeConfig(BigInt(cbBtcRawConfig.data.toString()));

  if (cbBtcConfig.stableRateBorrowingEnabled) {
    await addSafeCall(poolConfigurator.interface.encodeFunctionData("setReserveStableRateBorrowing", [cbBtcAddress, false]));
  }

  if (cbBtcConfig.borrowingEnabled) {
    await addSafeCall(poolConfigurator.interface.encodeFunctionData("setReserveBorrowing", [cbBtcAddress, false]));
  }

  if (cbBtcConfig.flashLoanEnabled) {
    await addSafeCall(poolConfigurator.interface.encodeFunctionData("setReserveFlashLoaning", [cbBtcAddress, false]));
  }

  if (!cbBtcConfig.frozen) {
    await addSafeCall(poolConfigurator.interface.encodeFunctionData("setReserveFreeze", [cbBtcAddress, true]));
  }

  if (!cbBtcConfig.paused) {
    await addSafeCall(poolConfigurator.interface.encodeFunctionData("setReservePause", [cbBtcAddress, true]));
  }

  if (setCbBtcLtvZero && cbBtcConfig.ltv !== 0n) {
    await addSafeCall(
      poolConfigurator.interface.encodeFunctionData("configureReserveAsCollateral", [
        cbBtcAddress,
        0,
        cbBtcConfig.liquidationThreshold,
        cbBtcConfig.liquidationBonus,
      ]),
    );
  }

  const dUSDRawConfig = await pool.getConfiguration(dUSDAddress);
  const dUSDConfig = decodeConfig(BigInt(dUSDRawConfig.data.toString()));

  if (dUSDConfig.stableRateBorrowingEnabled) {
    await addSafeCall(poolConfigurator.interface.encodeFunctionData("setReserveStableRateBorrowing", [dUSDAddress, false]));
  }

  if (dUSDConfig.borrowingEnabled) {
    await addSafeCall(poolConfigurator.interface.encodeFunctionData("setReserveBorrowing", [dUSDAddress, false]));
  }

  if (dUSDConfig.flashLoanEnabled) {
    await addSafeCall(poolConfigurator.interface.encodeFunctionData("setReserveFlashLoaning", [dUSDAddress, false]));
  }

  if (!dUSDConfig.frozen) {
    await addSafeCall(poolConfigurator.interface.encodeFunctionData("setReserveFreeze", [dUSDAddress, true]));
  }

  if (dUSDConfig.paused) {
    await addSafeCall(poolConfigurator.interface.encodeFunctionData("setReservePause", [dUSDAddress, false]));
  }

  const success = await executor.flush("Ethereum mainnet dLEND recovery reserve reconfiguration");

  if (!success) {
    throw new Error("Failed to flush dLEND recovery Safe batch");
  }

  console.log("🔁 setup-ethereum-mainnet-dlend-recovery-safe: ✅");
  return true;
};

func.tags = ["post-deploy", "safe", "dlend", "recovery", "setup-ethereum-mainnet-dlend-recovery-safe"];
func.dependencies = ["setup-ethereum-mainnet-dlend-recovery-preflight"];
func.id = "setup-ethereum-mainnet-dlend-recovery-safe";

export default func;
