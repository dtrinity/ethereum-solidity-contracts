import { ZeroAddress } from "ethers";
import { HardhatRuntimeEnvironment } from "hardhat/types";
import { DeployFunction } from "hardhat-deploy/types";

import { getConfig } from "../../config/config";
import { POOL_ADDRESSES_PROVIDER_ID } from "../../typescript/deploy-ids";
import { isLocalNetwork } from "../../typescript/hardhat/deploy";
import { GovernanceExecutor } from "../../typescript/hardhat/governance";
import {
  getDecodedReserveConfig,
  normalize,
  normalizeSymbol,
  parseBooleanEnv,
  parseStringArrayEnv,
  resolveTokenAddress,
  ROLLOUT_COLLATERAL_SYMBOLS,
} from "./common";

const DEFAULT_UNFREEZE_SYMBOLS = ["sfrxETH", "sfrxUSD", "WBTC", "PAXG"] as const;

/*
 * Unfreezes already-collateral-configured reserves IN PLACE, keeping their existing LTV / liquidation
 * params — i.e. reopens frozen legacy collateral markets directly as live collateral.
 *
 * This is the deliberate alternative to the Phase 3 recovery resume flow, which floors LTV to 0
 * (supply-only) on unfreeze per phase3SafePosture (floorResumeLtvToZero / requireResumeLtvZeroInAssert).
 * Use this ONLY when a frozen reserve should come back as full collateral immediately.
 *
 * Borrowing / stable / flash loans are NOT touched (they stay at their current state). No contract is
 * deployed: this queues a direct PoolConfigurator.setReserveFreeze(asset, false) multicall executed by
 * the governance Safe, which holds RISK_ADMIN / POOL_ADMIN.
 */
const func: DeployFunction = async function (hre: HardhatRuntimeEnvironment): Promise<boolean> {
  if (isLocalNetwork(hre.network.name)) {
    console.log("🔁 setup-ethereum-mainnet-collateral-reserves-unfreeze-safe: local network detected – skipping");
    return true;
  }

  const { deployments, ethers } = hre;
  const { deployer } = await hre.getNamedAccounts();
  const signer = await ethers.getSigner(deployer);
  const config = await getConfig(hre);

  if (!config.dLend) {
    throw new Error(`dLend configuration is required for network ${hre.network.name}`);
  }

  if (!parseBooleanEnv("UNFREEZE_ENABLE_ACK", false)) {
    throw new Error(
      "Set UNFREEZE_ENABLE_ACK=true only when the selected frozen reserves should be reopened as live collateral (unfrozen, keeping their existing LTV).",
    );
  }

  if (!parseBooleanEnv("UNFREEZE_MONITORING_ACK", false)) {
    throw new Error("Set UNFREEZE_MONITORING_ACK=true only after monitoring/alerting is live for the unfreeze window.");
  }

  const requestedRaw = parseStringArrayEnv("UNFREEZE_SYMBOLS_JSON");
  const requested = requestedRaw.length > 0 ? requestedRaw : [...DEFAULT_UNFREEZE_SYMBOLS];
  const rolloutSymbols = ROLLOUT_COLLATERAL_SYMBOLS.filter((symbol) => Boolean(config.dLend?.reservesConfig[symbol]));
  const configuredSymbolsByNormalized = new Map(rolloutSymbols.map((symbol) => [normalizeSymbol(symbol), symbol] as const));
  const selectedSymbols = requested.map((requestedSymbol) => {
    const resolved = configuredSymbolsByNormalized.get(normalizeSymbol(requestedSymbol));

    if (!resolved) {
      throw new Error(
        [
          `[config-check] ${requestedSymbol} is not part of the supported collateral rollout set.`,
          `Allowed symbols: ${rolloutSymbols.join(", ")}`,
        ].join(" "),
      );
    }

    return resolved;
  });

  const executor = new GovernanceExecutor(hre, signer, config.safeConfig);

  if (!executor.useSafe) {
    throw new Error("Safe config is required for reserve unfreeze. Provide config.safeConfig and enable Safe mode.");
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
      [`[role-check] ${managerAddress} must be POOL_ADMIN or RISK_ADMIN to unfreeze reserves.`, `aclManager=${aclManagerAddress}`].join(
        " ",
      ),
    );
  }

  let queuedOperations = 0;

  for (const symbol of selectedSymbols) {
    const tokenAddress = await resolveTokenAddress(hre, symbol, config.tokenAddresses);

    if (!tokenAddress) {
      throw new Error(`[config-check] Missing token address for ${symbol}. Run preflight and fix the network config before unfreeze.`);
    }

    const reserveData = await pool.getReserveData(tokenAddress);

    if (normalize(reserveData.aTokenAddress) === normalize(ZeroAddress)) {
      throw new Error(`[reserve-check] ${symbol} is not initialized on-chain; nothing to unfreeze.`);
    }

    const currentConfig = await getDecodedReserveConfig(pool, tokenAddress);

    if (!currentConfig.active) {
      throw new Error(`[unfreeze-check] Reserve ${symbol} is inactive; manual review is required before unfreeze.`);
    }

    if (!currentConfig.frozen) {
      console.log(`ℹ️ ${symbol}: not frozen — skipping (already unfrozen).`);
      continue;
    }

    if (currentConfig.ltv === 0n) {
      console.log(
        [
          `ℹ️ ${symbol}: frozen but LTV is 0 — unfreezing reopens it SUPPLY-ONLY, not as collateral.`,
          "Run the 02f promote step afterwards to set a collateral LTV. Queuing the unfreeze anyway.",
        ].join(" "),
      );
    }

    const data = poolConfigurator.interface.encodeFunctionData("setReserveFreeze", [tokenAddress, false]);
    await executor.tryOrQueue(
      async () => {
        throw new Error("Direct execution disabled: queue Safe transaction instead.");
      },
      () => ({ to: poolConfiguratorAddress, value: "0", data }),
    );
    queuedOperations++;

    console.log(
      [
        `🔓 ${symbol}: queued unfreeze.`,
        `LTV stays ${currentConfig.ltv.toString()}`,
        `liqThreshold=${currentConfig.liquidationThreshold.toString()}`,
        `liqBonus=${currentConfig.liquidationBonus.toString()}`,
        `(borrowing=${currentConfig.borrowingEnabled}, flash=${currentConfig.flashLoanEnabled} left untouched).`,
      ].join(" "),
    );
  }

  if (queuedOperations === 0) {
    console.log("🔁 setup-ethereum-mainnet-collateral-reserves-unfreeze-safe: no frozen reserves to unfreeze");
    return true;
  }

  const success = await executor.flush("Ethereum mainnet dLEND frozen collateral reserve unfreeze");

  if (!success) {
    throw new Error("Failed to create Safe batch for reserve unfreeze.");
  }

  console.log(`🔁 setup-ethereum-mainnet-collateral-reserves-unfreeze-safe: ✅ (${queuedOperations} operations)`);
  return true;
};

func.tags = ["post-deploy", "dlend", "reserve-rollout", "safe", "setup-ethereum-mainnet-collateral-reserves-unfreeze-safe"];
func.dependencies = [POOL_ADDRESSES_PROVIDER_ID];
func.id = "setup-ethereum-mainnet-collateral-reserves-unfreeze-safe-v1";

export default func;
