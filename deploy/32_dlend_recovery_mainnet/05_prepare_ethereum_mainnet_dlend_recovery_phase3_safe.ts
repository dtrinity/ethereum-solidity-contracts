import { formatUnits } from "ethers";
import { HardhatRuntimeEnvironment } from "hardhat/types";
import { DeployFunction } from "hardhat-deploy/types";

import { getConfig } from "../../config/config";
import { DUSD_TOKEN_ID, POOL_ADDRESSES_PROVIDER_ID } from "../../typescript/deploy-ids";
import { isLocalNetwork } from "../../typescript/hardhat/deploy";
import { GovernanceExecutor } from "../../typescript/hardhat/governance";
import {
  DEFAULT_CBBTC,
  getPoolReserves,
  getReserveConfig,
  isSubset,
  normalizeAddress,
  parseAddressListEnv,
  parseBooleanEnv,
  phase3SafePosture,
  queueReserveIntoResumeState,
  queueReserveLtvZeroFloor,
} from "./common";

const DEFAULT_ATTACKER = "0xbA5E1E36b0305772D35509c694782fB9118D4ecc";
const ERC20_MIN_ABI = ["function balanceOf(address account) view returns (uint256)", "function decimals() view returns (uint8)"] as const;

const func: DeployFunction = async function (hre: HardhatRuntimeEnvironment): Promise<boolean> {
  if (isLocalNetwork(hre.network.name)) {
    console.log("🔁 setup-ethereum-mainnet-dlend-recovery-phase3-safe: local network detected - skipping");
    return true;
  }

  const config = await getConfig(hre);
  const { deployments, ethers } = hre;
  const { deployer } = await hre.getNamedAccounts();
  const signer = await ethers.getSigner(deployer);
  const executor = new GovernanceExecutor(hre, signer, config.safeConfig);

  if (!executor.useSafe || !config.safeConfig?.safeAddress) {
    throw new Error("Safe config is required for dLEND recovery Phase 3 batch generation. Provide config.safeConfig and enable Safe mode.");
  }

  await executor.initialize();

  const attacker = process.env.ATTACKER || DEFAULT_ATTACKER;
  const dUSDAddress = process.env.RECOVERY_DUSD_ADDRESS || config.tokenAddresses.dUSD || (await deployments.get(DUSD_TOKEN_ID)).address;
  const cbBtcAddress = process.env.RECOVERY_CBBTC_ADDRESS || config.tokenAddresses.cbBTC || DEFAULT_CBBTC;
  const resumeReserves = parseAddressListEnv("PHASE3_RESUME_RESERVES_JSON");
  const borrowingReserves = parseAddressListEnv("PHASE3_ENABLE_BORROWING_RESERVES_JSON");
  const stableBorrowingReserves = parseAddressListEnv("PHASE3_ENABLE_STABLE_BORROWING_RESERVES_JSON");
  const flashLoanReserves = parseAddressListEnv("PHASE3_ENABLE_FLASHLOAN_RESERVES_JSON");
  const borrowingReserveSet = new Set(borrowingReserves.map((asset) => normalizeAddress(asset)));
  const stableBorrowingReserveSet = new Set(stableBorrowingReserves.map((asset) => normalizeAddress(asset)));
  const flashLoanReserveSet = new Set(flashLoanReserves.map((asset) => normalizeAddress(asset)));
  const { allowFlashLoans, allowBorrowingReenable, floorResumeLtvToZero, allowNonZeroLtvResumes } = phase3SafePosture;
  const allowLowSupplyResume = parseBooleanEnv("PHASE3_ALLOW_LOW_SUPPLY_RESUMES", false);
  const lowSupplyWarning = Number(process.env.LOW_SUPPLY_WARNING ?? "10");

  if (!parseBooleanEnv("PHASE3_REMEDIATION_ACK", false)) {
    throw new Error("Set PHASE3_REMEDIATION_ACK=true only after code-level protections are deployed and reviewed.");
  }

  if (!parseBooleanEnv("PHASE3_HEALTHCHECK_ACK", false)) {
    throw new Error("Set PHASE3_HEALTHCHECK_ACK=true only after reserve-by-reserve health checks are complete.");
  }

  if (!parseBooleanEnv("PHASE3_MONITORING_ACK", false)) {
    throw new Error("Set PHASE3_MONITORING_ACK=true only after alerting/monitoring is live for the resume window.");
  }

  if (resumeReserves.length === 0) {
    throw new Error("PHASE3_RESUME_RESERVES_JSON must contain at least one reserve.");
  }

  if (!isSubset(borrowingReserves, resumeReserves)) {
    throw new Error("PHASE3_ENABLE_BORROWING_RESERVES_JSON must be a subset of PHASE3_RESUME_RESERVES_JSON.");
  }

  if (!isSubset(stableBorrowingReserves, borrowingReserves)) {
    throw new Error("PHASE3_ENABLE_STABLE_BORROWING_RESERVES_JSON must be a subset of PHASE3_ENABLE_BORROWING_RESERVES_JSON.");
  }

  if (!isSubset(flashLoanReserves, resumeReserves)) {
    throw new Error("PHASE3_ENABLE_FLASHLOAN_RESERVES_JSON must be a subset of PHASE3_RESUME_RESERVES_JSON.");
  }

  if (borrowingReserveSet.size > 0 && !allowBorrowingReenable) {
    throw new Error(
      "Borrowing restore is a later-stage reopen step. Set phase3SafePosture.allowBorrowingReenable = true in deploy/32_dlend_recovery_mainnet/common.ts before re-enabling borrowing in Phase 3.",
    );
  }

  if (flashLoanReserveSet.size > 0 && !allowFlashLoans) {
    throw new Error(
      "Flash loans are opt-in last. Set phase3SafePosture.allowFlashLoans = true in deploy/32_dlend_recovery_mainnet/common.ts before re-enabling them.",
    );
  }

  const addressProviderDeployment = await deployments.get(POOL_ADDRESSES_PROVIDER_ID);
  const addressProvider = await ethers.getContractAt("PoolAddressesProvider", addressProviderDeployment.address, signer);
  const [poolAddress, poolConfiguratorAddress] = await Promise.all([addressProvider.getPool(), addressProvider.getPoolConfigurator()]);
  const [pool, poolConfigurator] = await Promise.all([
    ethers.getContractAt("Pool", poolAddress, signer),
    ethers.getContractAt("PoolConfigurator", poolConfiguratorAddress, signer),
  ]);

  const allReserves = await getPoolReserves(pool);
  const allReserveSet = new Set(allReserves.map((asset) => normalizeAddress(asset)));

  for (const [label, values] of [
    ["PHASE3_RESUME_RESERVES_JSON", resumeReserves],
    ["PHASE3_ENABLE_BORROWING_RESERVES_JSON", borrowingReserves],
    ["PHASE3_ENABLE_STABLE_BORROWING_RESERVES_JSON", stableBorrowingReserves],
    ["PHASE3_ENABLE_FLASHLOAN_RESERVES_JSON", flashLoanReserves],
  ] as const) {
    for (const asset of values) {
      const normalized = normalizeAddress(asset);

      if (!allReserveSet.has(normalized)) {
        throw new Error(`${label} contains reserve ${asset}, which is not active in pool ${poolAddress}.`);
      }

      if (normalized === normalizeAddress(cbBtcAddress)) {
        throw new Error(`${label} must not include cbBTC. cbBTC stays quarantined in Phase 3.`);
      }
    }
  }

  const dusdReserveData = await pool.getReserveData(dUSDAddress);
  const dusdDebtToken = await ethers.getContractAt(ERC20_MIN_ABI, dusdReserveData.variableDebtTokenAddress, signer);
  const attackerDebt = await dusdDebtToken.balanceOf(attacker);

  if (attackerDebt !== 0n) {
    throw new Error(
      `Attacker dUSD variable debt is still nonzero: ${attackerDebt.toString()}. Do not enter Phase 3 before Phase 2 is complete.`,
    );
  }

  for (const asset of resumeReserves) {
    const reserveData = await pool.getReserveData(asset);
    const [assetToken, aToken] = await Promise.all([
      ethers.getContractAt(ERC20_MIN_ABI, asset, signer),
      ethers.getContractAt(["function totalSupply() view returns (uint256)"], reserveData.aTokenAddress, signer),
    ]);
    const [decimals, totalSupply] = await Promise.all([assetToken.decimals(), aToken.totalSupply()]);
    const formattedSupply = Number(formatUnits(totalSupply, decimals));

    if (!allowLowSupplyResume && formattedSupply <= lowSupplyWarning) {
      throw new Error(
        `Reserve ${asset} has low live aToken supply (${formattedSupply}). Set PHASE3_ALLOW_LOW_SUPPLY_RESUMES=true to override explicitly.`,
      );
    }

    const normalized = normalizeAddress(asset);
    const current = await getReserveConfig(pool, asset);

    if (!floorResumeLtvToZero && !allowNonZeroLtvResumes && current.ltv !== 0n) {
      throw new Error(
        `Reserve ${asset} still has LTV=${current.ltv.toString()}. Keep phase3SafePosture.floorResumeLtvToZero for the supply-only reopen, or set phase3SafePosture.allowNonZeroLtvResumes = true in deploy/32_dlend_recovery_mainnet/common.ts.`,
      );
    }

    if (floorResumeLtvToZero) {
      await queueReserveLtvZeroFloor(executor, poolConfigurator, poolConfiguratorAddress, asset, current);
    }

    await queueReserveIntoResumeState(
      executor,
      poolConfigurator,
      poolConfiguratorAddress,
      asset,
      current,
      borrowingReserveSet.has(normalized),
      stableBorrowingReserveSet.has(normalized),
      flashLoanReserveSet.has(normalized),
    );
  }

  const success = await executor.flush("Ethereum mainnet dLEND recovery phase 3: controlled reserve resume");

  if (!success) {
    throw new Error("Failed to flush dLEND recovery Phase 3 Safe batch");
  }

  console.log(`🔁 setup-ethereum-mainnet-dlend-recovery-phase3-safe: ✅ (${resumeReserves.length} reserves)`);
  return true;
};

func.tags = ["post-deploy", "safe", "dlend", "recovery", "phase3", "setup-ethereum-mainnet-dlend-recovery-phase3-safe"];
func.dependencies = ["setup-ethereum-mainnet-dlend-recovery-phase3-preflight"];
func.id = "setup-ethereum-mainnet-dlend-recovery-phase3-safe";

export default func;
