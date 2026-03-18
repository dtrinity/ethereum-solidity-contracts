import "dotenv/config";

import { Contract, formatUnits } from "ethers";

import {
  aTokenAbi,
  createProvider,
  decodeConfig,
  DEFAULT_ATTACKER,
  DEFAULT_CBBTC,
  erc20Abi,
  loadDeploymentAddress,
  normalizeAddress,
  parseAddressListEnv,
  parseBooleanEnv,
  parseReserveOverrides,
  poolAbi,
} from "./common";

const provider = createProvider();
const POOL = process.env.POOL || loadDeploymentAddress("PoolProxy");
const DUSD = process.env.DUSD || loadDeploymentAddress("dUSD");
const CBBTC = process.env.CBBTC || DEFAULT_CBBTC;
const ATTACKER = process.env.ATTACKER || DEFAULT_ATTACKER;
const LOW_SUPPLY_WARNING = Number(process.env.LOW_SUPPLY_WARNING ?? "10");
const REQUIRE_ZERO_AVAILABLE_BORROWS = parseBooleanEnv("REQUIRE_ZERO_AVAILABLE_BORROWS", true);
const REQUIRE_CBBTC_LTV_ZERO = parseBooleanEnv("REQUIRE_CBBTC_LTV_ZERO", true);

if (!POOL || !DUSD || !CBBTC || !ATTACKER) {
  throw new Error("Missing required addresses. Set POOL, DUSD, CBBTC, and ATTACKER.");
}

async function main() {
  const pool = new Contract(POOL, poolAbi, provider);
  const configuredReserves = parseReserveOverrides();
  const reserves = configuredReserves.length > 0 ? configuredReserves : ((await pool.getReservesList()) as string[]);
  const phase2LiveReserves = new Set([
    normalizeAddress(DUSD),
    ...parseAddressListEnv("PHASE2_UNPAUSE_RESERVES_JSON").map((asset) => normalizeAddress(asset)),
  ]);
  const failures: string[] = [];
  const warnings: string[] = [];

  const decodeReserve = async (asset: string) => {
    const configRaw = await pool.getConfiguration(asset);
    return decodeConfig(BigInt(configRaw.data.toString()));
  };

  const [dusdConfig, cbBtcConfig] = await Promise.all([decodeReserve(DUSD), decodeReserve(CBBTC)]);

  if (dusdConfig.paused) failures.push("dUSD is still paused");
  if (!dusdConfig.frozen) failures.push("dUSD is not frozen");
  if (dusdConfig.borrowingEnabled) failures.push("dUSD borrowing is still enabled");
  if (dusdConfig.stableRateBorrowingEnabled) failures.push("dUSD stable-rate borrowing is still enabled");
  if (dusdConfig.flashLoanEnabled) failures.push("dUSD flash loans are still enabled");

  if (!cbBtcConfig.paused) failures.push("cbBTC is not paused");
  if (!cbBtcConfig.frozen) failures.push("cbBTC is not frozen");
  if (cbBtcConfig.borrowingEnabled) failures.push("cbBTC borrowing is still enabled");
  if (cbBtcConfig.stableRateBorrowingEnabled) failures.push("cbBTC stable-rate borrowing is still enabled");
  if (cbBtcConfig.flashLoanEnabled) failures.push("cbBTC flash loans are still enabled");

  if (REQUIRE_CBBTC_LTV_ZERO && cbBtcConfig.ltv !== 0) {
    failures.push(`cbBTC LTV is ${cbBtcConfig.ltv} instead of 0`);
  } else if (cbBtcConfig.ltv !== 0) {
    warnings.push(`cbBTC LTV remains ${cbBtcConfig.ltv}`);
  }

  const dusdReserve = await pool.getReserveData(DUSD);
  const dusdDebtToken = new Contract(dusdReserve.variableDebtTokenAddress, erc20Abi, provider);
  const attackerDebt = await dusdDebtToken.balanceOf(ATTACKER);
  if (attackerDebt !== 0n) failures.push(`attacker dUSD variable debt is nonzero: ${attackerDebt.toString()}`);

  const attackerAccountData = await pool.getUserAccountData(ATTACKER);

  if (REQUIRE_ZERO_AVAILABLE_BORROWS && attackerAccountData.availableBorrowsBase !== 0n) {
    failures.push(`attacker availableBorrowsBase is nonzero: ${attackerAccountData.availableBorrowsBase.toString()}`);
  } else if (attackerAccountData.availableBorrowsBase !== 0n) {
    warnings.push(`attacker availableBorrowsBase remains nonzero: ${attackerAccountData.availableBorrowsBase.toString()}`);
  }

  for (const asset of reserves) {
    const [config, reserveData] = await Promise.all([decodeReserve(asset), pool.getReserveData(asset)]);
    const token = new Contract(asset, erc20Abi, provider);
    const aToken = new Contract(reserveData.aTokenAddress, aTokenAbi, provider);
    const [symbol, decimals, totalSupply] = await Promise.all([
      token.symbol().catch(() => asset.slice(0, 10)),
      token.decimals().catch(() => config.decimals),
      aToken.totalSupply(),
    ]);
    const totalSupplyFormatted = Number(formatUnits(totalSupply, decimals));
    const normalized = normalizeAddress(asset);

    if (!config.active) {
      failures.push(`${symbol} is inactive`);
    }

    if (normalized === normalizeAddress(CBBTC)) {
      if (!config.paused) {
        failures.push("cbBTC is not paused");
      }

      if (!config.frozen) {
        failures.push("cbBTC is not frozen");
      }

      if (config.borrowingEnabled) {
        failures.push("cbBTC still has borrowing enabled");
      }

      if (config.stableRateBorrowingEnabled) {
        failures.push("cbBTC still has stable-rate borrowing enabled");
      }

      if (config.flashLoanEnabled) {
        failures.push("cbBTC still has flash loans enabled");
      }

      continue;
    }

    const shouldBeUnpaused = phase2LiveReserves.has(normalized);

    if (shouldBeUnpaused && config.paused) {
      failures.push(`${symbol} should be unpaused in Phase 2 but is still paused`);
    }

    if (!shouldBeUnpaused && !config.paused) {
      failures.push(`${symbol} is unpaused even though it is not in the Phase 2 live reserve set`);
    }

    if (!shouldBeUnpaused) {
      continue;
    }

    if (!config.frozen) {
      failures.push(`${symbol} is not frozen`);
    }

    if (config.borrowingEnabled) {
      failures.push(`${symbol} still has borrowing enabled`);
    }

    if (config.stableRateBorrowingEnabled) {
      failures.push(`${symbol} still has stable-rate borrowing enabled`);
    }

    if (config.flashLoanEnabled) {
      failures.push(`${symbol} still has flash loans enabled`);
    }

    if (shouldBeUnpaused && totalSupplyFormatted <= LOW_SUPPLY_WARNING) {
      warnings.push(`${symbol} is live in Phase 2 with low aToken supply (${totalSupplyFormatted})`);
    }
  }

  console.log(
    JSON.stringify(
      {
        checkedAt: new Date().toISOString(),
        attacker: ATTACKER,
        phase2LiveReserves: Array.from(phase2LiveReserves),
        failures,
        warnings,
        status: failures.length === 0 ? "PASS" : "FAIL",
      },
      null,
      2,
    ),
  );

  if (failures.length !== 0) {
    process.exit(2);
  }
}

main().catch((error) => {
  console.error(error);
  process.exit(1);
});
