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
  normalizeAddress,
  parseAddressListEnv,
  parseBooleanEnv,
} from "./common";

const DEFAULT_ATTACKER = "0xbA5E1E36b0305772D35509c694782fB9118D4ecc";
const ERC20_MIN_ABI = ["function balanceOf(address account) view returns (uint256)", "function decimals() view returns (uint8)"] as const;

const func: DeployFunction = async function (hre: HardhatRuntimeEnvironment): Promise<boolean> {
  if (isLocalNetwork(hre.network.name)) {
    console.log("🔁 setup-ethereum-mainnet-dlend-recovery-phase2-preflight: local network detected - skipping");
    return true;
  }

  const config = await getConfig(hre);
  const { deployments, ethers } = hre;
  const { deployer } = await hre.getNamedAccounts();
  const signer = await ethers.getSigner(deployer);
  const executor = new GovernanceExecutor(hre, signer, config.safeConfig);
  const blockers: string[] = [];

  if (!executor.useSafe || !config.safeConfig?.safeAddress) {
    throw new Error("Safe config is required for dLEND recovery Phase 2. Provide config.safeConfig and enable Safe mode.");
  }

  const safeAddress = config.safeConfig.safeAddress;
  const attacker = process.env.ATTACKER || DEFAULT_ATTACKER;
  const dUSDAddress = process.env.RECOVERY_DUSD_ADDRESS || config.tokenAddresses.dUSD || (await deployments.get(DUSD_TOKEN_ID)).address;
  const cbBtcAddress = process.env.RECOVERY_CBBTC_ADDRESS || config.tokenAddresses.cbBTC || DEFAULT_CBBTC;
  const targetReserves = parseAddressListEnv("PHASE2_UNPAUSE_RESERVES_JSON");
  const lowSupplyWarning = Number(process.env.LOW_SUPPLY_WARNING ?? "10");
  const allowLowSupply = parseBooleanEnv("PHASE2_ALLOW_LOW_SUPPLY_RESERVES", false);
  const requireZeroAvailableBorrows = parseBooleanEnv("REQUIRE_ZERO_AVAILABLE_BORROWS", true);
  const requireCbBtcLtvZero = parseBooleanEnv("REQUIRE_CBBTC_LTV_ZERO", true);

  if (targetReserves.length === 0) {
    addBlocker(blockers, "PHASE2_UNPAUSE_RESERVES_JSON must list the healthy non-cbBTC reserves that should exit full pause.");
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

  if (!allReserveSet.has(normalizeAddress(dUSDAddress))) {
    addBlocker(blockers, `dUSD reserve ${dUSDAddress} is not active in pool ${poolAddress}.`);
  }

  if (!allReserveSet.has(normalizeAddress(cbBtcAddress))) {
    addBlocker(blockers, `cbBTC reserve ${cbBtcAddress} is not active in pool ${poolAddress}.`);
  }

  for (const asset of targetReserves) {
    const normalized = normalizeAddress(asset);

    if (!allReserveSet.has(normalized)) {
      addBlocker(blockers, `Phase 2 target reserve ${asset} is not active in pool ${poolAddress}.`);
    }

    if (normalized === normalizeAddress(cbBtcAddress)) {
      addBlocker(blockers, "cbBTC must remain paused and cannot be included in PHASE2_UNPAUSE_RESERVES_JSON.");
    }

    if (normalized === normalizeAddress(dUSDAddress)) {
      addBlocker(blockers, "dUSD is already unpaused in Phase 1 and must not be included in PHASE2_UNPAUSE_RESERVES_JSON.");
    }
  }

  const [isPoolAdmin, isRiskAdmin, isEmergencyAdmin] = await Promise.all([
    aclManager.isPoolAdmin(safeAddress),
    aclManager.isRiskAdmin(safeAddress),
    aclManager.isEmergencyAdmin(safeAddress),
  ]);

  if (!isPoolAdmin && !isRiskAdmin) {
    addBlocker(
      blockers,
      `Safe ${safeAddress} must be a pool admin or risk admin to repair reserve flags before unpausing Phase 2 reserves.`,
    );
  }

  if (!isPoolAdmin && !isEmergencyAdmin) {
    addBlocker(blockers, `Safe ${safeAddress} must be a pool admin or emergency admin to unpause Phase 2 reserves.`);
  }

  const dusdReserveData = await pool.getReserveData(dUSDAddress);
  const dusdDebtToken = await ethers.getContractAt(ERC20_MIN_ABI, dusdReserveData.variableDebtTokenAddress, signer);
  const attackerDebt = await dusdDebtToken.balanceOf(attacker);

  if (attackerDebt !== 0n) {
    addBlocker(
      blockers,
      `Attacker dUSD variable debt is still nonzero: ${attackerDebt.toString()}. Repay Phase 2 debt before unpausing more markets.`,
    );
  }

  const attackerAccountData = await pool.getUserAccountData(attacker);

  if (requireZeroAvailableBorrows && attackerAccountData.availableBorrowsBase !== 0n) {
    addBlocker(blockers, `Attacker availableBorrowsBase remains nonzero: ${attackerAccountData.availableBorrowsBase.toString()}.`);
  }

  const allowedLiveReserves = new Set<string>([normalizeAddress(dUSDAddress), ...targetReserves.map((asset) => normalizeAddress(asset))]);

  for (const asset of allReserves) {
    const normalized = normalizeAddress(asset);
    const reserveConfig = await getReserveConfig(pool, asset);

    if (!reserveConfig.active) {
      addBlocker(blockers, `Reserve ${asset} is inactive; recovery scripts assume active reserves.`);
    }

    if (normalized === normalizeAddress(cbBtcAddress)) {
      if (!reserveConfig.paused) {
        addBlocker(blockers, "cbBTC is not paused. It must remain quarantined during Phase 2.");
      }

      if (!reserveConfig.frozen) {
        addBlocker(blockers, "cbBTC is not frozen. It must remain quarantined during Phase 2.");
      }

      if (reserveConfig.borrowingEnabled) {
        addBlocker(blockers, "cbBTC still has borrowing enabled.");
      }

      if (reserveConfig.stableRateBorrowingEnabled) {
        addBlocker(blockers, "cbBTC still has stable-rate borrowing enabled.");
      }

      if (reserveConfig.flashLoanEnabled) {
        addBlocker(blockers, "cbBTC still has flash loans enabled.");
      }

      if (requireCbBtcLtvZero && reserveConfig.ltv !== 0n) {
        addBlocker(blockers, `cbBTC LTV is ${reserveConfig.ltv.toString()} instead of 0.`);
      }

      continue;
    }

    if (normalized === normalizeAddress(dUSDAddress)) {
      if (reserveConfig.paused) {
        addBlocker(blockers, "dUSD is paused. Phase 2 expects dUSD live in frozen mode from Phase 1.");
      }

      if (!reserveConfig.frozen) {
        addBlocker(blockers, "dUSD is not frozen.");
      }

      if (reserveConfig.borrowingEnabled) {
        addBlocker(blockers, "dUSD still has borrowing enabled.");
      }

      if (reserveConfig.stableRateBorrowingEnabled) {
        addBlocker(blockers, "dUSD still has stable-rate borrowing enabled.");
      }

      if (reserveConfig.flashLoanEnabled) {
        addBlocker(blockers, "dUSD still has flash loans enabled.");
      }

      continue;
    }

    const shouldBeLive = allowedLiveReserves.has(normalized);

    if (!shouldBeLive && !reserveConfig.paused) {
      addBlocker(blockers, `Reserve ${asset} is already unpaused even though it is not in PHASE2_UNPAUSE_RESERVES_JSON.`);
    }

    if (!shouldBeLive) {
      continue;
    }

    if (reserveConfig.paused) {
      addBlocker(blockers, `Reserve ${asset} is still paused even though it is in PHASE2_UNPAUSE_RESERVES_JSON.`);
    }

    if (!reserveConfig.frozen) {
      addBlocker(blockers, `Reserve ${asset} is not frozen. Phase 2 live reserves must remain unpaused + frozen.`);
    }

    if (reserveConfig.borrowingEnabled) {
      addBlocker(blockers, `Reserve ${asset} still has borrowing enabled. Phase 2 live reserves must remain non-borrowable.`);
    }

    if (reserveConfig.stableRateBorrowingEnabled) {
      addBlocker(blockers, `Reserve ${asset} still has stable-rate borrowing enabled.`);
    }

    if (reserveConfig.flashLoanEnabled) {
      addBlocker(blockers, `Reserve ${asset} still has flash loans enabled.`);
    }
  }

  for (const asset of targetReserves) {
    const [reserveConfig, reserveData] = await Promise.all([getReserveConfig(pool, asset), pool.getReserveData(asset)]);
    const [assetToken, aToken] = await Promise.all([
      ethers.getContractAt(ERC20_MIN_ABI, asset, signer),
      ethers.getContractAt(["function totalSupply() view returns (uint256)"], reserveData.aTokenAddress, signer),
    ]);
    const [decimals, totalSupply] = await Promise.all([assetToken.decimals(), aToken.totalSupply()]);
    const formattedSupply = Number(formatUnits(totalSupply, decimals));

    if (!allowLowSupply && reserveConfig.paused && formattedSupply <= lowSupplyWarning) {
      addBlocker(
        blockers,
        `Phase 2 target reserve ${asset} has low live aToken supply (${formattedSupply}). Do not unpause thin reserves without an explicit override.`,
      );
    }
  }

  if (blockers.length > 0) {
    throw new Error(`dLEND recovery Phase 2 preflight failed:\n- ${blockers.join("\n- ")}`);
  }

  console.log(`🔁 setup-ethereum-mainnet-dlend-recovery-phase2-preflight: ✅ (${targetReserves.length} reserves)`);
  return true;
};

func.tags = ["post-deploy", "safe", "dlend", "recovery", "phase2", "setup-ethereum-mainnet-dlend-recovery-phase2-preflight"];
func.id = "setup-ethereum-mainnet-dlend-recovery-phase2-preflight";

export default func;
