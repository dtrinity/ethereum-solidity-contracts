import { formatUnits } from "ethers";
import { HardhatRuntimeEnvironment } from "hardhat/types";
import { DeployFunction } from "hardhat-deploy/types";

import { getConfig } from "../../config/config";
import { DUSD_TOKEN_ID, POOL_ADDRESSES_PROVIDER_ID, POOL_CONFIGURATOR_PROXY_ID } from "../../typescript/deploy-ids";
import { isLocalNetwork } from "../../typescript/hardhat/deploy";
import { GovernanceExecutor } from "../../typescript/hardhat/governance";
import {
  addBlocker,
  DEFAULT_CBBTC,
  getPoolReserves,
  getReserveConfig,
  isSubset,
  normalizeAddress,
  parseAddressListEnv,
  parseBooleanEnv,
} from "./common";

const DEFAULT_ATTACKER = "0xbA5E1E36b0305772D35509c694782fB9118D4ecc";
const ERC20_MIN_ABI = ["function balanceOf(address account) view returns (uint256)", "function decimals() view returns (uint8)"] as const;

const func: DeployFunction = async function (hre: HardhatRuntimeEnvironment): Promise<boolean> {
  if (isLocalNetwork(hre.network.name)) {
    console.log("🔁 setup-ethereum-mainnet-dlend-recovery-phase3-preflight: local network detected - skipping");
    return true;
  }

  const config = await getConfig(hre);
  const { deployments, ethers } = hre;
  const { deployer } = await hre.getNamedAccounts();
  const signer = await ethers.getSigner(deployer);
  const executor = new GovernanceExecutor(hre, signer, config.safeConfig);
  const blockers: string[] = [];

  if (!executor.useSafe || !config.safeConfig?.safeAddress) {
    throw new Error("Safe config is required for dLEND recovery Phase 3. Provide config.safeConfig and enable Safe mode.");
  }

  const safeAddress = config.safeConfig.safeAddress;
  const attacker = process.env.ATTACKER || DEFAULT_ATTACKER;
  const dUSDAddress = process.env.RECOVERY_DUSD_ADDRESS || config.tokenAddresses.dUSD || (await deployments.get(DUSD_TOKEN_ID)).address;
  const cbBtcAddress = process.env.RECOVERY_CBBTC_ADDRESS || config.tokenAddresses.cbBTC || DEFAULT_CBBTC;
  const resumeReserves = parseAddressListEnv("PHASE3_RESUME_RESERVES_JSON");
  const borrowingReserves = parseAddressListEnv("PHASE3_ENABLE_BORROWING_RESERVES_JSON");
  const stableBorrowingReserves = parseAddressListEnv("PHASE3_ENABLE_STABLE_BORROWING_RESERVES_JSON");
  const flashLoanReserves = parseAddressListEnv("PHASE3_ENABLE_FLASHLOAN_RESERVES_JSON");
  const allowFlashLoans = parseBooleanEnv("PHASE3_ALLOW_FLASHLOANS", false);
  const allowLowSupplyResume = parseBooleanEnv("PHASE3_ALLOW_LOW_SUPPLY_RESUMES", false);
  const lowSupplyWarning = Number(process.env.LOW_SUPPLY_WARNING ?? "10");
  const requireCbBtcLtvZero = parseBooleanEnv("REQUIRE_CBBTC_LTV_ZERO", true);

  if (!parseBooleanEnv("PHASE3_REMEDIATION_ACK", false)) {
    addBlocker(blockers, "Set PHASE3_REMEDIATION_ACK=true only after code-level protections are deployed and reviewed.");
  }

  if (!parseBooleanEnv("PHASE3_HEALTHCHECK_ACK", false)) {
    addBlocker(blockers, "Set PHASE3_HEALTHCHECK_ACK=true only after reserve-by-reserve health checks are complete.");
  }

  if (!parseBooleanEnv("PHASE3_MONITORING_ACK", false)) {
    addBlocker(blockers, "Set PHASE3_MONITORING_ACK=true only after alerting/monitoring is live for the resume window.");
  }

  if (resumeReserves.length === 0) {
    addBlocker(blockers, "PHASE3_RESUME_RESERVES_JSON must list at least one reserve to resume.");
  }

  const [providerDeployment, configuratorDeployment] = await Promise.all([
    deployments.get(POOL_ADDRESSES_PROVIDER_ID),
    deployments.get(POOL_CONFIGURATOR_PROXY_ID),
  ]);

  const addressProvider = await ethers.getContractAt("PoolAddressesProvider", providerDeployment.address, signer);
  const [poolAddress, poolConfiguratorAddress, aclManagerAddress] = await Promise.all([
    addressProvider.getPool(),
    addressProvider.getPoolConfigurator(),
    addressProvider.getACLManager(),
  ]);

  if (normalizeAddress(poolConfiguratorAddress) !== normalizeAddress(configuratorDeployment.address)) {
    addBlocker(
      blockers,
      `PoolConfiguratorProxy mismatch: provider=${poolConfiguratorAddress}, deployment=${configuratorDeployment.address}.`,
    );
  }

  const [pool, aclManager] = await Promise.all([
    ethers.getContractAt("Pool", poolAddress, signer),
    ethers.getContractAt("ACLManager", aclManagerAddress, signer),
  ]);

  const allReserves = await getPoolReserves(pool);
  const allReserveSet = new Set(allReserves.map((asset) => normalizeAddress(asset)));
  const cbBtcListed = allReserveSet.has(normalizeAddress(cbBtcAddress));

  if (!allReserveSet.has(normalizeAddress(dUSDAddress))) {
    addBlocker(blockers, `dUSD reserve ${dUSDAddress} is not active in pool ${poolAddress}.`);
  }

  if (!cbBtcListed) {
    console.log(`cbBTC reserve ${cbBtcAddress} is not active in pool ${poolAddress}; Phase 3 will treat cbBTC as already delisted.`);
  }

  const listChecks = [
    ["PHASE3_RESUME_RESERVES_JSON", resumeReserves],
    ["PHASE3_ENABLE_BORROWING_RESERVES_JSON", borrowingReserves],
    ["PHASE3_ENABLE_STABLE_BORROWING_RESERVES_JSON", stableBorrowingReserves],
    ["PHASE3_ENABLE_FLASHLOAN_RESERVES_JSON", flashLoanReserves],
  ] as const;

  for (const [label, values] of listChecks) {
    for (const asset of values) {
      const normalized = normalizeAddress(asset);

      if (!allReserveSet.has(normalized)) {
        addBlocker(blockers, `${label} contains reserve ${asset}, which is not active in pool ${poolAddress}.`);
      }

      if (normalized === normalizeAddress(cbBtcAddress)) {
        addBlocker(
          blockers,
          `${label} must not include cbBTC. In Phase 3, cbBTC is either already delisted or remains quarantined outside the resume set.`,
        );
      }
    }
  }

  if (!isSubset(borrowingReserves, resumeReserves)) {
    addBlocker(blockers, "PHASE3_ENABLE_BORROWING_RESERVES_JSON must be a subset of PHASE3_RESUME_RESERVES_JSON.");
  }

  if (!isSubset(stableBorrowingReserves, borrowingReserves)) {
    addBlocker(blockers, "PHASE3_ENABLE_STABLE_BORROWING_RESERVES_JSON must be a subset of PHASE3_ENABLE_BORROWING_RESERVES_JSON.");
  }

  if (!isSubset(flashLoanReserves, resumeReserves)) {
    addBlocker(blockers, "PHASE3_ENABLE_FLASHLOAN_RESERVES_JSON must be a subset of PHASE3_RESUME_RESERVES_JSON.");
  }

  if (flashLoanReserves.length > 0 && !allowFlashLoans) {
    addBlocker(blockers, "Flash loans are opt-in last. Set PHASE3_ALLOW_FLASHLOANS=true before re-enabling them.");
  }

  const [isPoolAdmin, isRiskAdmin, isEmergencyAdmin] = await Promise.all([
    aclManager.isPoolAdmin(safeAddress),
    aclManager.isRiskAdmin(safeAddress),
    aclManager.isEmergencyAdmin(safeAddress),
  ]);

  if (!isPoolAdmin && !isRiskAdmin) {
    addBlocker(
      blockers,
      `Safe ${safeAddress} must be a pool admin or risk admin to unfreeze reserves and re-enable borrowing / flash loans in Phase 3.`,
    );
  }

  if (!isPoolAdmin && !isEmergencyAdmin) {
    addBlocker(blockers, `Safe ${safeAddress} must be a pool admin or emergency admin to unpause reserves in Phase 3.`);
  }

  const dusdReserveData = await pool.getReserveData(dUSDAddress);
  const dusdDebtToken = await ethers.getContractAt(ERC20_MIN_ABI, dusdReserveData.variableDebtTokenAddress, signer);
  const attackerDebt = await dusdDebtToken.balanceOf(attacker);

  if (attackerDebt !== 0n) {
    addBlocker(
      blockers,
      `Attacker dUSD variable debt is still nonzero: ${attackerDebt.toString()}. Do not enter Phase 3 before Phase 2 is complete.`,
    );
  }

  const dusdConfig = await getReserveConfig(pool, dUSDAddress);

  if (dusdConfig.paused) {
    addBlocker(blockers, "dUSD is paused. Phase 3 assumes dUSD remained available in recovery mode.");
  }

  if (cbBtcListed) {
    const cbBtcConfig = await getReserveConfig(pool, cbBtcAddress);

    if (!cbBtcConfig.paused) {
      addBlocker(blockers, "cbBTC is not paused. Phase 3 expects cbBTC to remain quarantined until delisted.");
    }

    if (cbBtcConfig.borrowingEnabled || cbBtcConfig.stableRateBorrowingEnabled || cbBtcConfig.flashLoanEnabled) {
      addBlocker(blockers, "cbBTC still has borrowing, stable borrowing, or flash loans enabled.");
    }

    if (requireCbBtcLtvZero && cbBtcConfig.ltv !== 0n) {
      addBlocker(blockers, `cbBTC LTV is ${cbBtcConfig.ltv.toString()} instead of 0.`);
    }
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
      addBlocker(
        blockers,
        `Phase 3 resume reserve ${asset} has low live aToken supply (${formattedSupply}). Keep thin reserves frozen unless you explicitly override PHASE3_ALLOW_LOW_SUPPLY_RESUMES=true.`,
      );
    }
  }

  if (blockers.length > 0) {
    throw new Error(`dLEND recovery Phase 3 preflight failed:\n- ${blockers.join("\n- ")}`);
  }

  console.log(`🔁 setup-ethereum-mainnet-dlend-recovery-phase3-preflight: ✅ (${resumeReserves.length} reserves)`);
  return true;
};

func.tags = ["post-deploy", "safe", "dlend", "recovery", "phase3", "setup-ethereum-mainnet-dlend-recovery-phase3-preflight"];
func.id = "setup-ethereum-mainnet-dlend-recovery-phase3-preflight";

export default func;
