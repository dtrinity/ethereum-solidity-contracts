import { HardhatRuntimeEnvironment } from "hardhat/types";
import { DeployFunction } from "hardhat-deploy/types";

import { getConfig } from "../../config/config";
import { ATOMIC_MARKET_LISTING_HELPER_ID, POOL_ADDRESSES_PROVIDER_ID } from "../../typescript/deploy-ids";
import { isLocalNetwork } from "../../typescript/hardhat/deploy";
import { GovernanceExecutor } from "../../typescript/hardhat/governance";
import {
  assertReserveOracleReadiness,
  buildExpectedOracleAssets,
  chunkArray,
  getDecodedReserveConfig,
  isReserveStaged,
  normalize,
  normalizeSymbol,
  parseBooleanEnv,
  parseNormalizedBigIntMapEnv,
  parseStringArrayEnv,
  resolveTokenAddress,
  ROLLOUT_COLLATERAL_SYMBOLS,
} from "./common";

const func: DeployFunction = async function (hre: HardhatRuntimeEnvironment): Promise<boolean> {
  if (isLocalNetwork(hre.network.name)) {
    console.log("🔁 setup-ethereum-mainnet-collateral-reserves-config-safe: local network detected – skipping");
    return true;
  }

  const { deployments, ethers } = hre;
  const { deployer } = await hre.getNamedAccounts();
  const signer = await ethers.getSigner(deployer);
  const config = await getConfig(hre);

  if (!config.dLend) {
    throw new Error(`dLend configuration is required for network ${hre.network.name}`);
  }

  if (!parseBooleanEnv("NEW_LISTINGS_ENABLE_ACK", false)) {
    throw new Error("Set NEW_LISTINGS_ENABLE_ACK=true only when the selected staged markets are intentionally being made live.");
  }

  if (!parseBooleanEnv("NEW_LISTINGS_SEED_ACK", false)) {
    throw new Error(
      "Set NEW_LISTINGS_SEED_ACK=true only after the selected staged markets have been seeded above the required aToken floor.",
    );
  }

  if (!parseBooleanEnv("NEW_LISTINGS_MONITORING_ACK", false)) {
    throw new Error("Set NEW_LISTINGS_MONITORING_ACK=true only after monitoring/alerting is live for the new listing window.");
  }

  const requestedSymbolsRaw = parseStringArrayEnv("NEW_LISTINGS_ENABLE_SYMBOLS_JSON");

  if (requestedSymbolsRaw.length === 0) {
    throw new Error('Set NEW_LISTINGS_ENABLE_SYMBOLS_JSON=\'["WETH","wstETH"]\' with the staged reserves you intend to enable.');
  }

  const rolloutSymbols = ROLLOUT_COLLATERAL_SYMBOLS.filter((symbol) => Boolean(config.dLend?.reservesConfig[symbol]));
  const configuredSymbolsByNormalized = new Map(rolloutSymbols.map((symbol) => [normalizeSymbol(symbol), symbol] as const));
  const selectedSymbols = requestedSymbolsRaw.map((requestedSymbol) => {
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

  const minATokenSupplyBySymbol = parseNormalizedBigIntMapEnv("NEW_LISTINGS_MIN_ATOKEN_SUPPLY_JSON");
  const allowFlashLoans = parseBooleanEnv("NEW_LISTINGS_ALLOW_FLASHLOANS", false);
  const executor = new GovernanceExecutor(hre, signer, config.safeConfig);

  if (!executor.useSafe) {
    throw new Error("Safe config is required for collateral reserve config rollout. Provide config.safeConfig and enable Safe mode.");
  }

  await executor.initialize();

  const addressProviderDeployment = await deployments.get(POOL_ADDRESSES_PROVIDER_ID);
  const addressProvider = await ethers.getContractAt("PoolAddressesProvider", addressProviderDeployment.address, signer);
  const poolConfiguratorAddress = await addressProvider.getPoolConfigurator();
  const poolAddress = await addressProvider.getPool();
  const pool = await ethers.getContractAt("Pool", poolAddress, signer);
  const priceOracleAddress = await addressProvider.getPriceOracle();
  const priceOracle = await ethers.getContractAt("IAaveOracle", priceOracleAddress, signer);
  const aclManagerAddress = await addressProvider.getACLManager();
  const aclManager = await ethers.getContractAt("ACLManager", aclManagerAddress, signer);
  const managerAddress = config.safeConfig!.safeAddress;

  const atomicHelperDeployment = await deployments.get(ATOMIC_MARKET_LISTING_HELPER_ID);
  const atomicHelperAddress = atomicHelperDeployment.address;
  const atomicHelper = await ethers.getContractAt("AtomicMarketListingHelper", atomicHelperAddress, signer);
  const [atomicHelperOwner, riskAdminRole] = await Promise.all([atomicHelper.owner(), aclManager.RISK_ADMIN_ROLE()]);
  const helperHasRiskAdmin = await aclManager.hasRole(riskAdminRole, atomicHelperAddress);

  if (normalize(atomicHelperOwner) !== normalize(managerAddress)) {
    throw new Error(
      [
        `[ownership-check] AtomicMarketListingHelper owner mismatch.`,
        `helper=${atomicHelperAddress}`,
        `owner=${atomicHelperOwner}`,
        `expected=${managerAddress}.`,
      ].join(" "),
    );
  }

  if (!helperHasRiskAdmin) {
    throw new Error(
      [
        `[role-check] AtomicMarketListingHelper is missing RISK_ADMIN_ROLE.`,
        `helper=${atomicHelperAddress}`,
        `aclManager=${aclManagerAddress}`,
        "Run and execute setup-ethereum-mainnet-collateral-reserves-grant-risk-admin-safe before generating the enable batch.",
      ].join(" "),
    );
  }

  const verifiedOracleAssets = new Set<string>();
  const expectedOracleAssets = buildExpectedOracleAssets(config);
  const enableInputParams: Array<Record<string, unknown>> = [];

  for (const symbol of selectedSymbols) {
    const reserveParams = config.dLend.reservesConfig[symbol];
    const tokenAddress = await resolveTokenAddress(hre, symbol, config.tokenAddresses);

    if (!reserveParams) {
      continue;
    }

    if (!tokenAddress) {
      throw new Error(`[config-check] Missing token address for ${symbol}. Run preflight and fix the network config before enabling.`);
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

    if (normalize(reserveData.aTokenAddress) === normalize("0x0000000000000000000000000000000000000000")) {
      throw new Error(
        [
          `[reserve-check] ${symbol} is not initialized on-chain yet.`,
          "Execute the init+stage Safe batches first, wait for them to be mined, then rerun the enable step.",
        ].join(" "),
      );
    }

    const normalizedSymbol = normalizeSymbol(symbol);
    const minATokenSupply = minATokenSupplyBySymbol[normalizedSymbol];

    if (minATokenSupply === undefined) {
      throw new Error(
        [
          `[seed-check] Missing min aToken supply for ${symbol}.`,
          "Set NEW_LISTINGS_MIN_ATOKEN_SUPPLY_JSON with raw aToken units per selected symbol.",
          "Example for 1 whole-token seed: 1e18 assets use 1000000000000000000, 8-decimal BTC assets use 100000000.",
        ].join(" "),
      );
    }

    if (minATokenSupply <= 0n) {
      throw new Error(`[seed-check] NEW_LISTINGS_MIN_ATOKEN_SUPPLY_JSON must provide a positive raw aToken floor for ${symbol}.`);
    }

    const currentConfig = await getDecodedReserveConfig(pool, tokenAddress);
    const flashLoanEnabled = allowFlashLoans ? reserveParams.flashLoanEnabled : false;

    if (reserveParams.flashLoanEnabled && !allowFlashLoans) {
      console.log(
        `ℹ️ ${symbol}: flashLoanEnabled forced to false. Set NEW_LISTINGS_ALLOW_FLASHLOANS=true only after code-level protections are live.`,
      );
    }

    const target = {
      asset: tokenAddress,
      baseLTV: BigInt(reserveParams.baseLTVAsCollateral),
      liquidationThreshold: BigInt(reserveParams.liquidationThreshold),
      liquidationBonus: BigInt(reserveParams.liquidationBonus),
      reserveFactor: BigInt(reserveParams.reserveFactor),
      borrowCap: BigInt(reserveParams.borrowCap),
      supplyCap: BigInt(reserveParams.supplyCap),
      debtCeiling: BigInt(reserveParams.debtCeiling),
      unbackedMintCap: 0n,
      liquidationProtocolFee: BigInt(reserveParams.liquidationProtocolFee ?? "0"),
      borrowableInIsolation: reserveParams.borrowableIsolation,
      borrowingEnabled: reserveParams.borrowingEnabled,
      stableBorrowingEnabled: reserveParams.stableBorrowRateEnabled,
      flashLoanEnabled,
      minATokenSupply,
    };

    const alreadyEnabled =
      currentConfig.active &&
      !currentConfig.paused &&
      !currentConfig.frozen &&
      currentConfig.ltv === target.baseLTV &&
      currentConfig.liquidationThreshold === target.liquidationThreshold &&
      currentConfig.liquidationBonus === target.liquidationBonus &&
      currentConfig.reserveFactor === target.reserveFactor &&
      currentConfig.borrowCap === target.borrowCap &&
      currentConfig.supplyCap === target.supplyCap &&
      currentConfig.debtCeiling === target.debtCeiling &&
      currentConfig.unbackedMintCap === target.unbackedMintCap &&
      currentConfig.liquidationProtocolFee === target.liquidationProtocolFee &&
      currentConfig.borrowableInIsolation === target.borrowableInIsolation &&
      currentConfig.borrowingEnabled === target.borrowingEnabled &&
      currentConfig.stableBorrowingEnabled === target.stableBorrowingEnabled &&
      currentConfig.flashLoanEnabled === target.flashLoanEnabled;

    if (alreadyEnabled) {
      continue;
    }

    // Reserves that already have collateral parameters set (nonzero LTV, liquidation
    // threshold, or liquidation bonus) cannot go through the atomic enable path:
    // AtomicMarketListingHelper._enableReserve reverts with ReserveCollateralAlreadyEnabled.
    // This covers BOTH frozen legacy collateral reserves AND supply-only reserves (LTV floored
    // to 0 but liquidation threshold/bonus retained, frozen=false). Remove them from the enable
    // batch instead of throwing, so the staged reserves that ARE eligible still get processed.
    const collateralConfigured =
      currentConfig.ltv !== 0n || currentConfig.liquidationThreshold !== 0n || currentConfig.liquidationBonus !== 0n;

    if (collateralConfigured) {
      console.log(
        [
          `ℹ️ ${symbol}: already collateral-configured (frozen=${currentConfig.frozen}) — removed from the atomic enable batch.`,
          "Collateral parameters are already set, so the staged-enable path does not apply",
          "(AtomicMarketListingHelper would revert ReserveCollateralAlreadyEnabled).",
          `ltv=${currentConfig.ltv.toString()}`,
          `liqThreshold=${currentConfig.liquidationThreshold.toString()}`,
          `liqBonus=${currentConfig.liquidationBonus.toString()}`,
          "Use the dedicated unfreeze/reconfigure flow if you intend to (re)configure it as live collateral.",
        ].join(" "),
      );
      continue;
    }

    if (!currentConfig.active) {
      throw new Error(`[enable-check] Reserve ${symbol} is inactive; manual review is required before enabling.`);
    }

    if (currentConfig.paused) {
      throw new Error(`[enable-check] Reserve ${symbol} is paused; manual review is required before enabling.`);
    }

    if (!isReserveStaged(currentConfig)) {
      throw new Error(
        [
          `[enable-check] Reserve ${symbol} is not in the staged posture expected by AtomicMarketListingHelper.`,
          `asset=${tokenAddress}`,
          `ltv=${currentConfig.ltv.toString()}`,
          `liqThreshold=${currentConfig.liquidationThreshold.toString()}`,
          `liqBonus=${currentConfig.liquidationBonus.toString()}`,
          `borrowing=${currentConfig.borrowingEnabled}`,
          `stableBorrowing=${currentConfig.stableBorrowingEnabled}`,
          `flashLoans=${currentConfig.flashLoanEnabled}`,
          `borrowCap=${currentConfig.borrowCap.toString()}`,
          `borrowableInIsolation=${currentConfig.borrowableInIsolation}`,
          "Execute or re-run the stage flow before attempting to enable the market.",
        ].join(" "),
      );
    }

    const aToken = await ethers.getContractAt("@openzeppelin/contracts/token/ERC20/IERC20.sol:IERC20", reserveData.aTokenAddress, signer);
    const aTokenSupply = await aToken.totalSupply();

    if (currentConfig.debtCeiling === 0n && target.debtCeiling !== 0n && aTokenSupply !== 0n) {
      throw new Error(
        [
          `[enable-check] Reserve ${symbol} was seeded before its nonzero debt ceiling was staged.`,
          `currentDebtCeiling=${currentConfig.debtCeiling.toString()}`,
          `requestedDebtCeiling=${target.debtCeiling.toString()}`,
          `currentATokenSupply=${aTokenSupply.toString()}`,
          "Re-stage or re-init the reserve with the final debt ceiling before seeding it.",
        ].join(" "),
      );
    }

    if (aTokenSupply < minATokenSupply) {
      throw new Error(
        [
          `[seed-check] ${symbol} is still below its required aToken floor.`,
          `required=${minATokenSupply.toString()}`,
          `current=${aTokenSupply.toString()}`,
          `aToken=${reserveData.aTokenAddress}`,
          "Seed the reserve first, then rerun the enable step.",
        ].join(" "),
      );
    }

    enableInputParams.push(target);
  }

  for (const enableChunk of chunkArray(enableInputParams, 4)) {
    const data = atomicHelper.interface.encodeFunctionData("enableReserves", [poolAddress, poolConfiguratorAddress, enableChunk]);
    await executor.tryOrQueue(
      async () => {
        throw new Error("Direct execution disabled: queue Safe transaction instead.");
      },
      () => ({ to: atomicHelperAddress, value: "0", data }),
    );
  }

  const success = await executor.flush("Ethereum mainnet dLEND collateral reserve atomic enable rollout");

  if (!success) {
    throw new Error("Failed to create Safe batch for collateral reserve atomic enable rollout.");
  }
  console.log("🔁 setup-ethereum-mainnet-collateral-reserves-config-safe: ✅");
  return true;
};

func.tags = ["post-deploy", "dlend", "reserve-rollout", "safe", "setup-ethereum-mainnet-collateral-reserves-config-safe"];
func.dependencies = [
  "setup-ethereum-mainnet-new-listings-preflight",
  "setup-ethereum-mainnet-new-listings-role-grants-safe",
  "setup-ethereum-mainnet-collateral-reserves-safe",
  "setup-ethereum-mainnet-collateral-reserves-init-batch-2-safe",
  "setup-ethereum-mainnet-collateral-reserves-grant-risk-admin-safe",
  "setup-ethereum-mainnet-collateral-oracles-safe",
  "setup-ethereum-mainnet-eth-oracles-safe",
  POOL_ADDRESSES_PROVIDER_ID,
  ATOMIC_MARKET_LISTING_HELPER_ID,
];
func.id = "setup-ethereum-mainnet-collateral-reserves-config-safe-v7";

export default func;
