import { ZeroAddress } from "ethers";
import { HardhatRuntimeEnvironment } from "hardhat/types";
import { DeployFunction } from "hardhat-deploy/types";

import { getConfig } from "../../config/config";
import { POOL_ADDRESSES_PROVIDER_ID } from "../../typescript/deploy-ids";
import { isLocalNetwork } from "../../typescript/hardhat/deploy";
import { GovernanceExecutor } from "../../typescript/hardhat/governance";
import { getDecodedReserveConfig, normalize, parseBooleanEnv, resolveTokenAddress } from "./common";

const DUSD_SYMBOL = "dUSD";

/*
 * Unfreezes the dUSD reserve (the protocol borrowable). dUSD is a dSTABLE, not a collateral asset, so
 * it is not part of the collateral rollout/unfreeze (02g) symbol set and is handled here.
 *
 * IMPORTANT: unfreezing alone does NOT make dUSD borrowable. dUSD's borrowingEnabled flag is currently
 * false, so the lending market cannot issue dUSD loans until borrowing is re-enabled. Set
 * DUSD_ENABLE_BORROWING=true to additionally re-enable borrowing and restore the configured reserve
 * factor — that is the step that turns the lending market back on, so gate it deliberately.
 *
 * Flash loans are NOT touched (they stay off). No contract is deployed: this queues direct
 * PoolConfigurator calls executed by the governance Safe, which holds RISK_ADMIN / POOL_ADMIN.
 */
const func: DeployFunction = async function (hre: HardhatRuntimeEnvironment): Promise<boolean> {
  if (isLocalNetwork(hre.network.name)) {
    console.log("🔁 setup-ethereum-mainnet-dusd-unfreeze-safe: local network detected – skipping");
    return true;
  }

  const { deployments, ethers } = hre;
  const { deployer } = await hre.getNamedAccounts();
  const signer = await ethers.getSigner(deployer);
  const config = await getConfig(hre);

  if (!config.dLend) {
    throw new Error(`dLend configuration is required for network ${hre.network.name}`);
  }

  if (!parseBooleanEnv("DUSD_UNFREEZE_ENABLE_ACK", false)) {
    throw new Error("Set DUSD_UNFREEZE_ENABLE_ACK=true only when the dUSD reserve should be unfrozen.");
  }

  if (!parseBooleanEnv("DUSD_MONITORING_ACK", false)) {
    throw new Error("Set DUSD_MONITORING_ACK=true only after monitoring/alerting is live for the dUSD reopen window.");
  }

  const enableBorrowing = parseBooleanEnv("DUSD_ENABLE_BORROWING", false);

  const executor = new GovernanceExecutor(hre, signer, config.safeConfig);

  if (!executor.useSafe) {
    throw new Error("Safe config is required for dUSD unfreeze. Provide config.safeConfig and enable Safe mode.");
  }

  await executor.initialize();

  const addressProviderDeployment = await deployments.get(POOL_ADDRESSES_PROVIDER_ID);
  const addressProvider = await ethers.getContractAt("PoolAddressesProvider", addressProviderDeployment.address, signer);
  const poolConfiguratorAddress = await addressProvider.getPoolConfigurator();
  const poolAddress = await addressProvider.getPool();
  const pool = await ethers.getContractAt("Pool", poolAddress, signer);
  const poolConfigurator = await ethers.getContractAt("PoolConfigurator", poolConfiguratorAddress, signer);
  const aclManagerAddress = await addressProvider.getACLManager();
  const aclManager = await ethers.getContractAt("ACLManager", aclManagerAddress, signer);
  const managerAddress = config.safeConfig!.safeAddress;

  const [isPoolAdmin, isRiskAdmin] = await Promise.all([aclManager.isPoolAdmin(managerAddress), aclManager.isRiskAdmin(managerAddress)]);

  if (!isPoolAdmin && !isRiskAdmin) {
    throw new Error(
      [`[role-check] ${managerAddress} must be POOL_ADMIN or RISK_ADMIN to unfreeze dUSD.`, `aclManager=${aclManagerAddress}`].join(" "),
    );
  }

  const tokenAddress = await resolveTokenAddress(hre, DUSD_SYMBOL, config.tokenAddresses);

  if (!tokenAddress) {
    throw new Error("[config-check] Missing dUSD token address in network config.");
  }

  const reserveData = await pool.getReserveData(tokenAddress);

  if (normalize(reserveData.aTokenAddress) === normalize(ZeroAddress)) {
    throw new Error("[reserve-check] dUSD is not initialized on-chain; nothing to unfreeze.");
  }

  const currentConfig = await getDecodedReserveConfig(pool, tokenAddress);

  if (!currentConfig.active) {
    throw new Error("[unfreeze-check] dUSD reserve is inactive; manual review is required before unfreeze.");
  }

  const reserveParams = config.dLend.reservesConfig[DUSD_SYMBOL];
  let queuedOperations = 0;

  if (currentConfig.frozen) {
    const data = poolConfigurator.interface.encodeFunctionData("setReserveFreeze", [tokenAddress, false]);
    await executor.tryOrQueue(
      async () => {
        throw new Error("Direct execution disabled: queue Safe transaction instead.");
      },
      () => ({ to: poolConfiguratorAddress, value: "0", data }),
    );
    queuedOperations++;
    console.log("🔓 dUSD: queued unfreeze (setReserveFreeze=false).");
  } else {
    console.log("ℹ️ dUSD: not frozen — no unfreeze needed.");
  }

  if (enableBorrowing) {
    if (!currentConfig.borrowingEnabled) {
      const data = poolConfigurator.interface.encodeFunctionData("setReserveBorrowing", [tokenAddress, true]);
      await executor.tryOrQueue(
        async () => {
          throw new Error("Direct execution disabled: queue Safe transaction instead.");
        },
        () => ({ to: poolConfiguratorAddress, value: "0", data }),
      );
      queuedOperations++;
      console.log("🔓 dUSD: queued setReserveBorrowing(true) — dUSD becomes borrowable (lending market reopens).");
    } else {
      console.log("ℹ️ dUSD: borrowing already enabled.");
    }

    if (reserveParams) {
      const targetReserveFactor = BigInt(reserveParams.reserveFactor);

      if (currentConfig.reserveFactor !== targetReserveFactor) {
        const data = poolConfigurator.interface.encodeFunctionData("setReserveFactor", [tokenAddress, targetReserveFactor]);
        await executor.tryOrQueue(
          async () => {
            throw new Error("Direct execution disabled: queue Safe transaction instead.");
          },
          () => ({ to: poolConfiguratorAddress, value: "0", data }),
        );
        queuedOperations++;
        console.log(`🔧 dUSD: queued setReserveFactor ${currentConfig.reserveFactor.toString()} -> ${targetReserveFactor.toString()}.`);
      }
    }
  } else if (!currentConfig.borrowingEnabled) {
    console.log(
      [
        "ℹ️ dUSD: borrowing stays DISABLED (set DUSD_ENABLE_BORROWING=true to make dUSD borrowable).",
        "Unfreeze alone does not restore lending — the market cannot issue dUSD loans until borrowing is re-enabled.",
      ].join(" "),
    );
  }

  if (queuedOperations === 0) {
    console.log("🔁 setup-ethereum-mainnet-dusd-unfreeze-safe: nothing to do (dUSD already in target state)");
    return true;
  }

  const success = await executor.flush("Ethereum mainnet dLEND dUSD unfreeze");

  if (!success) {
    throw new Error("Failed to create Safe batch for dUSD unfreeze.");
  }

  console.log(`🔁 setup-ethereum-mainnet-dusd-unfreeze-safe: ✅ (${queuedOperations} operations)`);
  return true;
};

func.tags = ["post-deploy", "dlend", "reserve-rollout", "safe", "setup-ethereum-mainnet-dusd-unfreeze-safe"];
func.dependencies = [POOL_ADDRESSES_PROVIDER_ID];
func.id = "setup-ethereum-mainnet-dusd-unfreeze-safe-v1";

export default func;
