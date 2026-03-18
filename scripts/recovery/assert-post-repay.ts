import "dotenv/config";

import { Contract, formatUnits } from "ethers";

import { aTokenAbi, createProvider, decodeConfig, DEFAULT_ATTACKER, DEFAULT_CBBTC, erc20Abi, loadDeploymentAddress, parseReserveOverrides, poolAbi } from "./common";

const provider = createProvider();
const POOL = process.env.POOL || loadDeploymentAddress("PoolProxy");
const DUSD = process.env.DUSD || loadDeploymentAddress("dUSD");
const CBBTC = process.env.CBBTC || DEFAULT_CBBTC;
const ATTACKER = process.env.ATTACKER || DEFAULT_ATTACKER;
const LOW_SUPPLY_WARNING = Number(process.env.LOW_SUPPLY_WARNING ?? "10");
const REQUIRE_ZERO_AVAILABLE_BORROWS = (process.env.REQUIRE_ZERO_AVAILABLE_BORROWS || "true").toLowerCase() === "true";

if (!POOL || !DUSD || !CBBTC || !ATTACKER) {
  throw new Error("Missing required addresses. Set POOL, DUSD, CBBTC, and ATTACKER.");
}

async function main() {
  const pool = new Contract(POOL, poolAbi, provider);
  const configuredReserves = parseReserveOverrides();
  const reserves = configuredReserves.length > 0 ? configuredReserves : ((await pool.getReservesList()) as string[]);
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
  if (cbBtcConfig.borrowingEnabled) failures.push("cbBTC borrowing is still enabled");
  if (cbBtcConfig.stableRateBorrowingEnabled) failures.push("cbBTC stable-rate borrowing is still enabled");
  if (cbBtcConfig.flashLoanEnabled) failures.push("cbBTC flash loans are still enabled");
  if (cbBtcConfig.ltv !== 0) warnings.push("cbBTC LTV is not zero; attacker may still show nonzero available borrow base.");

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

    if (!config.paused && config.flashLoanEnabled && totalSupplyFormatted <= LOW_SUPPLY_WARNING) {
      failures.push(`${symbol} is unpaused, flashloan-enabled, and low-supply (${totalSupplyFormatted}).`);
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
