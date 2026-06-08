import { id as keccakId, ZeroAddress, ZeroHash } from "ethers";
import { HardhatRuntimeEnvironment } from "hardhat/types";
import { DeployFunction } from "hardhat-deploy/types";

import { getConfig } from "../../config/config";
import { POOL_ADDRESSES_PROVIDER_ID } from "../../typescript/deploy-ids";
import { isLocalNetwork } from "../../typescript/hardhat/deploy";
import { GovernanceExecutor } from "../../typescript/hardhat/governance";
import {
  normalize,
  normalizeSymbol,
  parseBooleanEnv,
  parseStringArrayEnv,
  resolveTokenAddress,
  ROLLOUT_COLLATERAL_SYMBOLS,
} from "./common";

/*
 * Re-parameterizes a set of reserves to match sUSDe's collateral parameters
 * (Max LTV 72.00%, Liquidation threshold 75.00%, Liquidation penalty 8.50% => bonus 10850),
 * routed through the OZ TimelockController governance contract.
 *
 * Flow (the timelock enforces a delay between the two steps):
 *   1. TIMELOCK_ACTION=schedule (default): the governance Safe (PROPOSER) calls
 *      timelock.scheduleBatch([configurator x N], [0 x N], [configureReserveAsCollateral x N], 0, salt, delay).
 *   2. After >= getMinDelay() seconds: TIMELOCK_ACTION=execute: the Safe (EXECUTOR) calls
 *      timelock.executeBatch(... same args ...). The timelock (which holds RISK_ADMIN/POOL_ADMIN)
 *      then performs the configureReserveAsCollateral calls.
 *
 * Only collateral parameters (LTV / liquidation threshold / liquidation bonus) are changed. Freeze,
 * borrowing, flash-loan and cap state are NOT touched. No contract is deployed.
 */

const TIMELOCK = "0x18CB0EB73D953eD20F2157ce6bDE2A85E30e681B";

// Target = sUSDe's collateral parameters.
const TARGET_BASE_LTV = 7200n; // 72.00%
const TARGET_LIQ_THRESHOLD = 7500n; // 75.00%
const TARGET_LIQ_BONUS = 10850n; // 8.50% liquidation penalty

const DEFAULT_SYMBOLS = ["sfrxUSD", "sUSDS", "syrupUSDC", "syrupUSDT"] as const;

// Deterministic salt so the schedule and the later execute reference the SAME timelock operation.
const SALT = keccakId("dlend:ethereum-mainnet:reserve-params:match-sUSDe:sfrxUSD,sUSDS,syrupUSDC,syrupUSDT:v1");

const TIMELOCK_ABI = [
  "function getMinDelay() view returns (uint256)",
  "function PROPOSER_ROLE() view returns (bytes32)",
  "function EXECUTOR_ROLE() view returns (bytes32)",
  "function hasRole(bytes32 role, address account) view returns (bool)",
  "function hashOperationBatch(address[] targets, uint256[] values, bytes[] payloads, bytes32 predecessor, bytes32 salt) view returns (bytes32)",
  "function isOperation(bytes32 id) view returns (bool)",
  "function isOperationDone(bytes32 id) view returns (bool)",
  "function scheduleBatch(address[] targets, uint256[] values, bytes[] payloads, bytes32 predecessor, bytes32 salt, uint256 delay)",
  "function executeBatch(address[] targets, uint256[] values, bytes[] payloads, bytes32 predecessor, bytes32 salt) payable",
];

const func: DeployFunction = async function (hre: HardhatRuntimeEnvironment): Promise<boolean> {
  if (isLocalNetwork(hre.network.name)) {
    console.log("🔁 setup-ethereum-mainnet-reserve-params-timelock-safe: local network detected – skipping");
    return true;
  }

  const { deployments, ethers } = hre;
  const { deployer } = await hre.getNamedAccounts();
  const signer = await ethers.getSigner(deployer);
  const config = await getConfig(hre);

  if (!config.dLend) {
    throw new Error(`dLend configuration is required for network ${hre.network.name}`);
  }

  if (!parseBooleanEnv("RESERVE_PARAM_TIMELOCK_ACK", false)) {
    throw new Error(
      "Set RESERVE_PARAM_TIMELOCK_ACK=true only when the selected reserves should be re-parameterized to the sUSDe collateral params via the timelock.",
    );
  }

  if (!parseBooleanEnv("RESERVE_PARAM_MONITORING_ACK", false)) {
    throw new Error("Set RESERVE_PARAM_MONITORING_ACK=true only after monitoring/alerting is live for this parameter-change window.");
  }

  const action = (process.env.TIMELOCK_ACTION ?? "schedule").toLowerCase();

  if (action !== "schedule" && action !== "execute") {
    throw new Error(`TIMELOCK_ACTION must be 'schedule' or 'execute' (got '${action}').`);
  }

  // Cross-check: the explicit target equals sUSDe's configured params (guards against config drift).
  const susdeParams = config.dLend.reservesConfig["sUSDe"];

  if (susdeParams) {
    if (
      BigInt(susdeParams.baseLTVAsCollateral) !== TARGET_BASE_LTV ||
      BigInt(susdeParams.liquidationThreshold) !== TARGET_LIQ_THRESHOLD ||
      BigInt(susdeParams.liquidationBonus) !== TARGET_LIQ_BONUS
    ) {
      throw new Error(
        [
          "[target-check] sUSDe config no longer matches the hard-coded target params.",
          `sUSDe config: ltv=${susdeParams.baseLTVAsCollateral} liqThr=${susdeParams.liquidationThreshold} liqBonus=${susdeParams.liquidationBonus}`,
          `target: ltv=${TARGET_BASE_LTV} liqThr=${TARGET_LIQ_THRESHOLD} liqBonus=${TARGET_LIQ_BONUS}`,
          "Reconcile before generating a governance batch.",
        ].join(" "),
      );
    }
  }

  const requestedRaw = parseStringArrayEnv("RESERVE_PARAM_SYMBOLS_JSON");
  const requested = requestedRaw.length > 0 ? requestedRaw : [...DEFAULT_SYMBOLS];
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
    throw new Error("Safe config is required for the timelock parameter change. Provide config.safeConfig and enable Safe mode.");
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
  const safeAddress = config.safeConfig!.safeAddress;

  const timelock = new ethers.Contract(TIMELOCK, TIMELOCK_ABI, signer);

  // ── Authorization preconditions ──
  const [tlIsPoolAdmin, tlIsRiskAdmin] = await Promise.all([aclManager.isPoolAdmin(TIMELOCK), aclManager.isRiskAdmin(TIMELOCK)]);

  if (!tlIsPoolAdmin && !tlIsRiskAdmin) {
    throw new Error(
      `[role-check] Timelock ${TIMELOCK} holds neither POOL_ADMIN nor RISK_ADMIN; configureReserveAsCollateral would revert on execute.`,
    );
  }

  const [proposerRole, executorRole] = await Promise.all([timelock.PROPOSER_ROLE(), timelock.EXECUTOR_ROLE()]);
  const neededRole = action === "schedule" ? proposerRole : executorRole;
  const safeHasRole = await timelock.hasRole(neededRole, safeAddress);

  if (!safeHasRole) {
    throw new Error(
      `[role-check] Safe ${safeAddress} lacks the ${action === "schedule" ? "PROPOSER" : "EXECUTOR"} role on timelock ${TIMELOCK}.`,
    );
  }

  // ── Build the inner configureReserveAsCollateral calls ──
  const targets: string[] = [];
  const values: string[] = [];
  const payloads: string[] = [];

  for (const symbol of selectedSymbols) {
    const tokenAddress = await resolveTokenAddress(hre, symbol, config.tokenAddresses);

    if (!tokenAddress) {
      throw new Error(`[config-check] Missing token address for ${symbol}.`);
    }

    const reserveData = await pool.getReserveData(tokenAddress);

    if (normalize(reserveData.aTokenAddress) === normalize(ZeroAddress)) {
      throw new Error(`[reserve-check] ${symbol} is not initialized on-chain; cannot re-parameterize.`);
    }

    const data = poolConfigurator.interface.encodeFunctionData("configureReserveAsCollateral", [
      tokenAddress,
      TARGET_BASE_LTV,
      TARGET_LIQ_THRESHOLD,
      TARGET_LIQ_BONUS,
    ]);
    targets.push(poolConfiguratorAddress);
    values.push("0");
    payloads.push(data);
    console.log(
      `  • ${symbol} (${tokenAddress}): configureReserveAsCollateral(ltv=${TARGET_BASE_LTV}, liqThr=${TARGET_LIQ_THRESHOLD}, liqBonus=${TARGET_LIQ_BONUS})`,
    );
  }

  if (targets.length === 0) {
    console.log("🔁 setup-ethereum-mainnet-reserve-params-timelock-safe: no reserves selected");
    return true;
  }

  const minDelay: bigint = await timelock.getMinDelay();
  const operationId: string = await timelock.hashOperationBatch(targets, values, payloads, ZeroHash, SALT);
  const alreadyScheduled: boolean = await timelock.isOperation(operationId);
  const alreadyDone: boolean = await timelock.isOperationDone(operationId);

  console.log(`ℹ️ timelock=${TIMELOCK} minDelay=${minDelay.toString()}s salt=${SALT}`);
  console.log(`ℹ️ operationId=${operationId} (isOperation=${alreadyScheduled}, isDone=${alreadyDone})`);

  let safeCallData: string;

  if (action === "schedule") {
    if (alreadyScheduled) {
      throw new Error(
        `[schedule-check] Operation ${operationId} is already scheduled on the timelock. Use TIMELOCK_ACTION=execute after the delay.`,
      );
    }
    safeCallData = timelock.interface.encodeFunctionData("scheduleBatch", [targets, values, payloads, ZeroHash, SALT, minDelay]);
    console.log(`📅 SCHEDULE: Safe -> timelock.scheduleBatch (delay ${minDelay.toString()}s ≈ ${(Number(minDelay) / 3600).toFixed(0)}h)`);
  } else {
    if (alreadyDone) {
      throw new Error(`[execute-check] Operation ${operationId} is already executed.`);
    }

    if (!alreadyScheduled) {
      throw new Error(
        `[execute-check] Operation ${operationId} has not been scheduled yet. Run TIMELOCK_ACTION=schedule first and wait the delay.`,
      );
    }
    safeCallData = timelock.interface.encodeFunctionData("executeBatch", [targets, values, payloads, ZeroHash, SALT]);
    console.log("▶️ EXECUTE: Safe -> timelock.executeBatch");
  }

  await executor.tryOrQueue(
    async () => {
      throw new Error("Direct execution disabled: queue Safe transaction instead.");
    },
    () => ({ to: TIMELOCK, value: "0", data: safeCallData }),
  );

  const success = await executor.flush(`Ethereum mainnet dLEND reserve params -> sUSDe (timelock ${action})`);

  if (!success) {
    throw new Error("Failed to create Safe batch for the timelock parameter change.");
  }

  console.log(`🔁 setup-ethereum-mainnet-reserve-params-timelock-safe: ✅ (${action}, ${targets.length} reserves)`);
  return true;
};

func.tags = ["post-deploy", "dlend", "reserve-rollout", "safe", "setup-ethereum-mainnet-reserve-params-timelock-safe"];
func.dependencies = [POOL_ADDRESSES_PROVIDER_ID];
func.id = "setup-ethereum-mainnet-reserve-params-timelock-safe-v2";

export default func;
