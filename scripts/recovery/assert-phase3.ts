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
  poolAbi,
} from "./common";

const provider = createProvider();
const POOL = process.env.POOL || loadDeploymentAddress("PoolProxy");
const DUSD = process.env.DUSD || loadDeploymentAddress("dUSD");
const CBBTC = process.env.CBBTC || DEFAULT_CBBTC;
const ATTACKER = process.env.ATTACKER || DEFAULT_ATTACKER;
const LOW_SUPPLY_WARNING = Number(process.env.LOW_SUPPLY_WARNING ?? "10");
const REQUIRE_CBBTC_LTV_ZERO = parseBooleanEnv("REQUIRE_CBBTC_LTV_ZERO", true);

if (!POOL || !DUSD || !CBBTC || !ATTACKER) {
  throw new Error("Missing required addresses. Set POOL, DUSD, CBBTC, and ATTACKER.");
}

async function main() {
  const pool = new Contract(POOL, poolAbi, provider);
  const failures: string[] = [];
  const warnings: string[] = [];

  const resumeReserves = parseAddressListEnv("PHASE3_RESUME_RESERVES_JSON");
  const borrowingReserves = new Set(parseAddressListEnv("PHASE3_ENABLE_BORROWING_RESERVES_JSON").map((asset) => normalizeAddress(asset)));
  const stableBorrowingReserves = new Set(
    parseAddressListEnv("PHASE3_ENABLE_STABLE_BORROWING_RESERVES_JSON").map((asset) => normalizeAddress(asset)),
  );
  const flashLoanReserves = new Set(parseAddressListEnv("PHASE3_ENABLE_FLASHLOAN_RESERVES_JSON").map((asset) => normalizeAddress(asset)));

  if (resumeReserves.length === 0) {
    throw new Error("PHASE3_RESUME_RESERVES_JSON must contain at least one reserve to assert.");
  }

  const decodeReserve = async (asset: string) => {
    const configRaw = await pool.getConfiguration(asset);
    return decodeConfig(BigInt(configRaw.data.toString()));
  };

  const dusdReserve = await pool.getReserveData(DUSD);
  const dusdDebtToken = new Contract(dusdReserve.variableDebtTokenAddress, erc20Abi, provider);
  const attackerDebt = await dusdDebtToken.balanceOf(ATTACKER);

  if (attackerDebt !== 0n) {
    failures.push(`attacker dUSD variable debt is nonzero: ${attackerDebt.toString()}`);
  }

  const cbBtcConfig = await decodeReserve(CBBTC);

  if (!cbBtcConfig.paused) {
    failures.push("cbBTC is not paused");
  }

  if (cbBtcConfig.borrowingEnabled) {
    failures.push("cbBTC borrowing is enabled");
  }

  if (cbBtcConfig.stableRateBorrowingEnabled) {
    failures.push("cbBTC stable-rate borrowing is enabled");
  }

  if (cbBtcConfig.flashLoanEnabled) {
    failures.push("cbBTC flash loans are enabled");
  }

  if (REQUIRE_CBBTC_LTV_ZERO && cbBtcConfig.ltv !== 0) {
    failures.push(`cbBTC LTV is ${cbBtcConfig.ltv} instead of 0`);
  }

  for (const asset of resumeReserves) {
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

    if (config.paused) {
      failures.push(`${symbol} is paused`);
    }

    if (config.frozen) {
      failures.push(`${symbol} is still frozen`);
    }

    if (config.borrowingEnabled !== borrowingReserves.has(normalized)) {
      failures.push(`${symbol} borrowing flag does not match PHASE3_ENABLE_BORROWING_RESERVES_JSON`);
    }

    if (config.stableRateBorrowingEnabled !== stableBorrowingReserves.has(normalized)) {
      failures.push(`${symbol} stable-borrowing flag does not match PHASE3_ENABLE_STABLE_BORROWING_RESERVES_JSON`);
    }

    if (config.flashLoanEnabled !== flashLoanReserves.has(normalized)) {
      failures.push(`${symbol} flash-loan flag does not match PHASE3_ENABLE_FLASHLOAN_RESERVES_JSON`);
    }

    if (flashLoanReserves.has(normalized) && totalSupplyFormatted <= LOW_SUPPLY_WARNING) {
      warnings.push(`${symbol} has flash loans enabled with low aToken supply (${totalSupplyFormatted})`);
    }
  }

  console.log(
    JSON.stringify(
      {
        checkedAt: new Date().toISOString(),
        attacker: ATTACKER,
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
