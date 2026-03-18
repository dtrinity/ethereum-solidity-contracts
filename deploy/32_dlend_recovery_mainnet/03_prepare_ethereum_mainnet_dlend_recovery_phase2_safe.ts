import { formatUnits } from "ethers";
import { HardhatRuntimeEnvironment } from "hardhat/types";
import { DeployFunction } from "hardhat-deploy/types";

import { getConfig } from "../../config/config";
import { DUSD_TOKEN_ID, POOL_ADDRESSES_PROVIDER_ID } from "../../typescript/deploy-ids";
import { isLocalNetwork } from "../../typescript/hardhat/deploy";
import { GovernanceExecutor } from "../../typescript/hardhat/governance";
import {
  DEFAULT_CBBTC,
  getDefaultPhase2TargetReserves,
  getReserveConfig,
  normalizeAddress,
  parseAddressListEnv,
  parseBooleanEnv,
  queueReserveIntoFrozenState,
} from "./common";

const DEFAULT_ATTACKER = "0xbA5E1E36b0305772D35509c694782fB9118D4ecc";
const ERC20_MIN_ABI = ["function balanceOf(address account) view returns (uint256)", "function decimals() view returns (uint8)"] as const;

const func: DeployFunction = async function (hre: HardhatRuntimeEnvironment): Promise<boolean> {
  if (isLocalNetwork(hre.network.name)) {
    console.log("🔁 setup-ethereum-mainnet-dlend-recovery-phase2-safe: local network detected - skipping");
    return true;
  }

  const config = await getConfig(hre);
  const { deployments, ethers } = hre;
  const { deployer } = await hre.getNamedAccounts();
  const signer = await ethers.getSigner(deployer);
  const executor = new GovernanceExecutor(hre, signer, config.safeConfig);

  if (!executor.useSafe || !config.safeConfig?.safeAddress) {
    throw new Error("Safe config is required for dLEND recovery Phase 2 batch generation. Provide config.safeConfig and enable Safe mode.");
  }

  await executor.initialize();

  const attacker = process.env.ATTACKER || DEFAULT_ATTACKER;
  const requestedTargets = parseAddressListEnv("PHASE2_UNPAUSE_RESERVES_JSON");
  const dUSDAddress = process.env.RECOVERY_DUSD_ADDRESS || config.tokenAddresses.dUSD || (await deployments.get(DUSD_TOKEN_ID)).address;
  const cbBtcAddress = process.env.RECOVERY_CBBTC_ADDRESS || config.tokenAddresses.cbBTC || DEFAULT_CBBTC;
  const lowSupplyWarning = Number(process.env.LOW_SUPPLY_WARNING ?? "10");
  const allowLowSupply = parseBooleanEnv("PHASE2_ALLOW_LOW_SUPPLY_RESERVES", false);

  const addressProviderDeployment = await deployments.get(POOL_ADDRESSES_PROVIDER_ID);
  const addressProvider = await ethers.getContractAt("PoolAddressesProvider", addressProviderDeployment.address, signer);
  const [poolAddress, poolConfiguratorAddress] = await Promise.all([addressProvider.getPool(), addressProvider.getPoolConfigurator()]);
  const [pool, poolConfigurator] = await Promise.all([
    ethers.getContractAt("Pool", poolAddress, signer),
    ethers.getContractAt("PoolConfigurator", poolConfiguratorAddress, signer),
  ]);
  const targetReserves =
    requestedTargets.length > 0 ? requestedTargets : await getDefaultPhase2TargetReserves(pool, dUSDAddress, cbBtcAddress);

  if (targetReserves.length === 0) {
    throw new Error(
      "Phase 2 found no paused non-cbBTC reserves to move into frozen mode. Provide PHASE2_UNPAUSE_RESERVES_JSON only if you intend a custom target set.",
    );
  }

  const dusdReserveData = await pool.getReserveData(dUSDAddress);
  const dusdDebtToken = await ethers.getContractAt(ERC20_MIN_ABI, dusdReserveData.variableDebtTokenAddress, signer);
  const attackerDebt = await dusdDebtToken.balanceOf(attacker);

  if (attackerDebt !== 0n) {
    throw new Error(`Attacker dUSD variable debt is still nonzero: ${attackerDebt.toString()}. Repay it before Phase 2 unpause.`);
  }

  for (const asset of targetReserves) {
    const normalized = normalizeAddress(asset);

    if (normalized === normalizeAddress(cbBtcAddress)) {
      throw new Error("cbBTC must remain paused and cannot be part of PHASE2_UNPAUSE_RESERVES_JSON.");
    }

    if (normalized === normalizeAddress(dUSDAddress)) {
      throw new Error("dUSD is already live from Phase 1 and must not be part of PHASE2_UNPAUSE_RESERVES_JSON.");
    }

    const [current, reserveData] = await Promise.all([getReserveConfig(pool, asset), pool.getReserveData(asset)]);
    const [assetToken, aToken] = await Promise.all([
      ethers.getContractAt(ERC20_MIN_ABI, asset, signer),
      ethers.getContractAt(["function totalSupply() view returns (uint256)"], reserveData.aTokenAddress, signer),
    ]);
    const [decimals, totalSupply] = await Promise.all([assetToken.decimals(), aToken.totalSupply()]);
    const formattedSupply = Number(formatUnits(totalSupply, decimals));

    if (!allowLowSupply && current.paused && formattedSupply <= lowSupplyWarning) {
      throw new Error(
        `Reserve ${asset} has low live aToken supply (${formattedSupply}). Set PHASE2_ALLOW_LOW_SUPPLY_RESERVES=true to override explicitly.`,
      );
    }
    await queueReserveIntoFrozenState(executor, poolConfigurator, poolConfiguratorAddress, asset, current, false);
  }

  const success = await executor.flush("Ethereum mainnet dLEND recovery phase 2: unpause selected healthy reserves into frozen mode");

  if (!success) {
    throw new Error("Failed to flush dLEND recovery Phase 2 Safe batch");
  }

  console.log(`🔁 setup-ethereum-mainnet-dlend-recovery-phase2-safe: ✅ (${targetReserves.length} reserves)`);
  return true;
};

func.tags = ["post-deploy", "safe", "dlend", "recovery", "phase2", "setup-ethereum-mainnet-dlend-recovery-phase2-safe"];
func.dependencies = ["setup-ethereum-mainnet-dlend-recovery-phase2-preflight"];
func.id = "setup-ethereum-mainnet-dlend-recovery-phase2-safe";

export default func;
