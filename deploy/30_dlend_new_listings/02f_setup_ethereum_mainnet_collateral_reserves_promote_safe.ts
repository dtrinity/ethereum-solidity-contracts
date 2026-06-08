import { ZeroAddress } from "ethers";
import { HardhatRuntimeEnvironment } from "hardhat/types";
import { DeployFunction } from "hardhat-deploy/types";

import { getConfig } from "../../config/config";
import { POOL_ADDRESSES_PROVIDER_ID } from "../../typescript/deploy-ids";
import { isLocalNetwork } from "../../typescript/hardhat/deploy";
import { GovernanceExecutor } from "../../typescript/hardhat/governance";
import {
  assertReserveOracleReadiness,
  buildExpectedOracleAssets,
  getDecodedReserveConfig,
  normalize,
  normalizeSymbol,
  parseBooleanEnv,
  parseNormalizedBigIntMapEnv,
  parseStringArrayEnv,
  resolveTokenAddress,
  ROLLOUT_COLLATERAL_SYMBOLS,
} from "./common";

const DEFAULT_PROMOTE_SYMBOLS = ["WETH", "wstETH", "syrupUSDC"] as const;

/*
 * Promotes supply-only reserves (LTV 0 with liquidation params already set, unfrozen) into live
 * collateral by raising LTV from 0 to the configured target.
 *
 * This is the missing transition between the staged-enable flow and the recovery resume flow:
 * - STAGED reserves (no collateral params)        -> atomic enable (...collateral-reserves-config-safe)
 * - SUPPLY-ONLY reserves (LTV 0, liq params set)  -> THIS script
 * - FROZEN collateral reserves                    -> Phase 3 recovery resume (PHASE3_RESUME_RESERVES_JSON)
 *
 * The atomic enable helper cannot be used here: AtomicMarketListingHelper._enableReserve reverts with
 * ReserveCollateralAlreadyEnabled on any nonzero collateral param, and a supply-only reserve with live
 * suppliers cannot be re-staged (its liquidation params cannot be zeroed while it holds supply). So the
 * promotion is a direct configureReserveAsCollateral call that raises LTV in place.
 *
 * Borrowing and flash loans are intentionally NOT touched here (they remain at their current state,
 * consistent with the recovery posture); enable them separately if and when that decision is made.
 */
const func: DeployFunction = async function (hre: HardhatRuntimeEnvironment): Promise<boolean> {
  if (isLocalNetwork(hre.network.name)) {
    console.log("🔁 setup-ethereum-mainnet-collateral-reserves-promote-safe: local network detected – skipping");
    return true;
  }

  const { deployments, ethers } = hre;
  const { deployer } = await hre.getNamedAccounts();
  const signer = await ethers.getSigner(deployer);
  const config = await getConfig(hre);

  if (!config.dLend) {
    throw new Error(`dLend configuration is required for network ${hre.network.name}`);
  }

  if (!parseBooleanEnv("PROMOTE_ENABLE_ACK", false)) {
    throw new Error(
      "Set PROMOTE_ENABLE_ACK=true only when the selected supply-only reserves should be promoted to live collateral (LTV raised from 0 to the configured target).",
    );
  }

  if (!parseBooleanEnv("PROMOTE_MONITORING_ACK", false)) {
    throw new Error("Set PROMOTE_MONITORING_ACK=true only after monitoring/alerting is live for the promotion window.");
  }

  const requestedSymbolsRaw = parseStringArrayEnv("PROMOTE_SYMBOLS_JSON");
  const requestedSymbols = requestedSymbolsRaw.length > 0 ? requestedSymbolsRaw : [...DEFAULT_PROMOTE_SYMBOLS];
  const rolloutSymbols = ROLLOUT_COLLATERAL_SYMBOLS.filter((symbol) => Boolean(config.dLend?.reservesConfig[symbol]));
  const configuredSymbolsByNormalized = new Map(rolloutSymbols.map((symbol) => [normalizeSymbol(symbol), symbol] as const));
  const selectedSymbols = requestedSymbols.map((requestedSymbol) => {
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

  // Floor enforcement is optional. When enabled, the floor defaults to each reserve's CURRENT on-chain
  // aToken supply ("current numbers"); an explicit per-symbol override may be supplied via
  // PROMOTE_MIN_ATOKEN_SUPPLY_JSON (raw aToken units) if a higher bar is wanted later.
  const enforceFloor = parseBooleanEnv("PROMOTE_ENFORCE_ATOKEN_FLOOR", true);
  const explicitFloorBySymbol = parseNormalizedBigIntMapEnv("PROMOTE_MIN_ATOKEN_SUPPLY_JSON");

  const executor = new GovernanceExecutor(hre, signer, config.safeConfig);

  if (!executor.useSafe) {
    throw new Error("Safe config is required for supply-only promotion. Provide config.safeConfig and enable Safe mode.");
  }

  await executor.initialize();

  const addressProviderDeployment = await deployments.get(POOL_ADDRESSES_PROVIDER_ID);
  const addressProvider = await ethers.getContractAt("PoolAddressesProvider", addressProviderDeployment.address, signer);
  const poolConfiguratorAddress = await addressProvider.getPoolConfigurator();
  const poolAddress = await addressProvider.getPool();
  const pool = await ethers.getContractAt("Pool", poolAddress, signer);
  const poolConfigurator = await ethers.getContractAt("PoolConfigurator", poolConfiguratorAddress, signer);
  const priceOracleAddress = await addressProvider.getPriceOracle();
  const priceOracle = await ethers.getContractAt("IAaveOracle", priceOracleAddress, signer);
  const aclManagerAddress = await addressProvider.getACLManager();
  const aclManager = await ethers.getContractAt("ACLManager", aclManagerAddress, signer);
  const managerAddress = config.safeConfig!.safeAddress;

  const [isPoolAdmin, isRiskAdmin] = await Promise.all([aclManager.isPoolAdmin(managerAddress), aclManager.isRiskAdmin(managerAddress)]);

  if (!isPoolAdmin && !isRiskAdmin) {
    throw new Error(
      [`[role-check] ${managerAddress} must be POOL_ADMIN or RISK_ADMIN to raise collateral LTV.`, `aclManager=${aclManagerAddress}`].join(
        " ",
      ),
    );
  }

  const verifiedOracleAssets = new Set<string>();
  const expectedOracleAssets = buildExpectedOracleAssets(config);

  let queuedOperations = 0;

  for (const symbol of selectedSymbols) {
    const reserveParams = config.dLend.reservesConfig[symbol];
    const tokenAddress = await resolveTokenAddress(hre, symbol, config.tokenAddresses);

    if (!reserveParams) {
      continue;
    }

    if (!tokenAddress) {
      throw new Error(`[config-check] Missing token address for ${symbol}. Run preflight and fix the network config before promotion.`);
    }

    await assertReserveOracleReadiness({
      hre,
      signer,
      priceOracleAddress,
      priceOracle,
      verifiedOracleAssets,
      expectedOracleAssets,
      symbol,
      asset: tokenAddress,
    });

    const reserveData = await pool.getReserveData(tokenAddress);

    if (normalize(reserveData.aTokenAddress) === normalize(ZeroAddress)) {
      throw new Error(
        [`[reserve-check] ${symbol} is not initialized on-chain yet.`, "Promotion only applies to existing supply-only reserves."].join(
          " ",
        ),
      );
    }

    const currentConfig = await getDecodedReserveConfig(pool, tokenAddress);
    const targetBaseLTV = BigInt(reserveParams.baseLTVAsCollateral);
    const targetLiquidationThreshold = BigInt(reserveParams.liquidationThreshold);
    const targetLiquidationBonus = BigInt(reserveParams.liquidationBonus);

    if (!currentConfig.active) {
      throw new Error(`[promote-check] Reserve ${symbol} is inactive; manual review is required before promotion.`);
    }

    if (currentConfig.paused) {
      throw new Error(`[promote-check] Reserve ${symbol} is paused; manual review is required before promotion.`);
    }

    // Frozen collateral reserves are reopened via the Phase 3 recovery resume flow, not here.
    if (currentConfig.frozen) {
      console.log(
        [
          `ℹ️ ${symbol}: frozen — skipping promotion.`,
          "Frozen reserves are reopened via the Phase 3 recovery resume flow (PHASE3_RESUME_RESERVES_JSON), not the new-listings promotion path.",
        ].join(" "),
      );
      continue;
    }

    // Reserves that already have a nonzero LTV are not in the supply-only posture this script promotes.
    if (currentConfig.ltv !== 0n) {
      const matchesTarget =
        currentConfig.ltv === targetBaseLTV &&
        currentConfig.liquidationThreshold === targetLiquidationThreshold &&
        currentConfig.liquidationBonus === targetLiquidationBonus;
      console.log(
        [
          `ℹ️ ${symbol}: ${matchesTarget ? "already promoted to target collateral parameters" : "already has a nonzero LTV (live collateral)"} — skipping.`,
          `ltv=${currentConfig.ltv.toString()}`,
          `liqThreshold=${currentConfig.liquidationThreshold.toString()}`,
          `liqBonus=${currentConfig.liquidationBonus.toString()}`,
        ].join(" "),
      );
      continue;
    }

    // Staged reserves (LTV 0 AND no liquidation params) go through the atomic enable path, not promotion.
    if (currentConfig.liquidationThreshold === 0n && currentConfig.liquidationBonus === 0n) {
      console.log(
        [
          `ℹ️ ${symbol}: staged (no collateral parameters set) — skipping promotion.`,
          "Staged reserves are opened via the atomic enable flow (setup-ethereum-mainnet-collateral-reserves-config-safe), not promotion.",
        ].join(" "),
      );
      continue;
    }

    // Eligible: supply-only reserve (LTV 0, liquidation params already set, unfrozen, active, unpaused).
    const aToken = await ethers.getContractAt("@openzeppelin/contracts/token/ERC20/IERC20.sol:IERC20", reserveData.aTokenAddress, signer);
    const aTokenSupply = await aToken.totalSupply();

    if (enforceFloor) {
      const explicitFloor = explicitFloorBySymbol[normalizeSymbol(symbol)];
      // Default floor source: the reserve's CURRENT on-chain aToken supply ("current numbers").
      const floor = explicitFloor !== undefined ? explicitFloor : aTokenSupply;

      if (aTokenSupply <= 0n) {
        console.log([`ℹ️ ${symbol}: aToken supply is zero — skipping promotion of an empty reserve. Seed it before promoting.`].join(" "));
        continue;
      }

      if (aTokenSupply < floor) {
        console.log(
          [
            `ℹ️ ${symbol}: below required aToken floor — skipping.`,
            `required=${floor.toString()}`,
            `current=${aTokenSupply.toString()}`,
            `aToken=${reserveData.aTokenAddress}`,
          ].join(" "),
        );
        continue;
      }

      console.log(
        [
          `ℹ️ ${symbol}: aToken floor enforced = ${floor.toString()}`,
          `(source: ${explicitFloor !== undefined ? "explicit PROMOTE_MIN_ATOKEN_SUPPLY_JSON override" : "current on-chain supply"});`,
          `current supply = ${aTokenSupply.toString()}.`,
        ].join(" "),
      );
    }

    const data = poolConfigurator.interface.encodeFunctionData("configureReserveAsCollateral", [
      tokenAddress,
      targetBaseLTV,
      targetLiquidationThreshold,
      targetLiquidationBonus,
    ]);
    await executor.tryOrQueue(
      async () => {
        throw new Error("Direct execution disabled: queue Safe transaction instead.");
      },
      () => ({ to: poolConfiguratorAddress, value: "0", data }),
    );
    queuedOperations++;

    console.log(
      [
        `🔼 ${symbol}: queued promotion to collateral.`,
        `ltv ${currentConfig.ltv.toString()} -> ${targetBaseLTV.toString()}`,
        `liqThreshold=${targetLiquidationThreshold.toString()}`,
        `liqBonus=${targetLiquidationBonus.toString()}`,
      ].join(" "),
    );
  }

  if (queuedOperations === 0) {
    console.log("🔁 setup-ethereum-mainnet-collateral-reserves-promote-safe: no eligible supply-only reserves to promote");
    return true;
  }

  const success = await executor.flush("Ethereum mainnet dLEND supply-only to collateral promotion");

  if (!success) {
    throw new Error("Failed to create Safe batch for supply-only collateral promotion.");
  }

  console.log(`🔁 setup-ethereum-mainnet-collateral-reserves-promote-safe: ✅ (${queuedOperations} operations)`);
  return true;
};

func.tags = ["post-deploy", "dlend", "reserve-rollout", "safe", "setup-ethereum-mainnet-collateral-reserves-promote-safe"];
func.dependencies = [
  "setup-ethereum-mainnet-new-listings-preflight",
  "setup-ethereum-mainnet-collateral-oracles-safe",
  "setup-ethereum-mainnet-eth-oracles-safe",
  POOL_ADDRESSES_PROVIDER_ID,
];
func.id = "setup-ethereum-mainnet-collateral-reserves-promote-safe-v1";

export default func;
