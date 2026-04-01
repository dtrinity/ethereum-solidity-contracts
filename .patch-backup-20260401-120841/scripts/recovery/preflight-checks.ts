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
  parseReserveOverrides,
  poolAbi,
} from "./common";

const provider = createProvider();
const POOL = process.env.POOL || loadDeploymentAddress("PoolProxy");
const DUSD = process.env.DUSD || loadDeploymentAddress("dUSD");
const CBBTC = process.env.CBBTC || DEFAULT_CBBTC;
const ATTACKER = process.env.ATTACKER || DEFAULT_ATTACKER;
const LOW_SUPPLY_WARNING = Number(process.env.LOW_SUPPLY_WARNING ?? "10");

if (!POOL || !DUSD || !CBBTC || !ATTACKER) {
  throw new Error("Missing required addresses. Set POOL, DUSD, CBBTC, and ATTACKER.");
}

type ReserveSnapshot = {
  asset: string;
  symbol: string;
  aToken: string;
  stableDebtToken: string;
  variableDebtToken: string;
  liquidityIndex: string;
  aTokenTotalSupplyRaw: string;
  aTokenTotalSupplyFormatted: number;
  aTokenScaledTotalSupplyRaw: string;
  config: ReturnType<typeof decodeConfig>;
  warnings: {
    lowSupply: boolean;
    dustFlashRisk: boolean;
    freezeDoesNotDisableFlashLoans: boolean;
  };
};

async function main() {
  const pool = new Contract(POOL, poolAbi, provider);
  const configuredReserves = parseReserveOverrides();
  const reserves = configuredReserves.length > 0 ? configuredReserves : ((await pool.getReservesList()) as string[]);

  const reservesOut: ReserveSnapshot[] = [];

  for (const asset of reserves) {
    const cfgRaw = await pool.getConfiguration(asset);
    const reserveData = await pool.getReserveData(asset);
    const cfg = decodeConfig(BigInt(cfgRaw.data.toString()));
    const aToken = new Contract(reserveData.aTokenAddress, aTokenAbi, provider);
    const token = new Contract(asset, erc20Abi, provider);

    const [symbol, totalSupply, scaledTotalSupply, decimals] = await Promise.all([
      token.symbol().catch(() => asset.slice(0, 10)),
      aToken.totalSupply(),
      aToken.scaledTotalSupply().catch(() => 0n),
      token.decimals().catch(() => cfg.decimals),
    ]);

    const totalSupplyFormatted = Number(formatUnits(totalSupply, decimals));
    const lowSupply = totalSupplyFormatted <= LOW_SUPPLY_WARNING;

    reservesOut.push({
      asset,
      symbol,
      aToken: reserveData.aTokenAddress,
      stableDebtToken: reserveData.stableDebtTokenAddress,
      variableDebtToken: reserveData.variableDebtTokenAddress,
      liquidityIndex: reserveData.liquidityIndex.toString(),
      aTokenTotalSupplyRaw: totalSupply.toString(),
      aTokenTotalSupplyFormatted: totalSupplyFormatted,
      aTokenScaledTotalSupplyRaw: scaledTotalSupply.toString(),
      config: cfg,
      warnings: {
        lowSupply,
        dustFlashRisk: !cfg.paused && cfg.flashLoanEnabled && lowSupply,
        freezeDoesNotDisableFlashLoans: cfg.frozen && !cfg.paused && cfg.flashLoanEnabled,
      },
    });
  }

  const dusdReserve = await pool.getReserveData(DUSD);
  const dusdConfigRaw = await pool.getConfiguration(DUSD);
  const dusdConfig = decodeConfig(BigInt(dusdConfigRaw.data.toString()));
  const dusdDebtToken = new Contract(dusdReserve.variableDebtTokenAddress, erc20Abi, provider);
  const attackerDebt = await dusdDebtToken.balanceOf(ATTACKER);
  const attackerAccountData = await pool.getUserAccountData(ATTACKER);

  const cbBtcReserve = await pool.getReserveData(CBBTC);
  const cbBtcAToken = new Contract(cbBtcReserve.aTokenAddress, aTokenAbi, provider);
  const cbBtcToken = new Contract(CBBTC, erc20Abi, provider);
  const [cbBtcBalance, cbBtcScaledBalance, cbBtcUnderlyingInAToken] = await Promise.all([
    cbBtcAToken.balanceOf(ATTACKER),
    cbBtcAToken.scaledBalanceOf(ATTACKER).catch(() => 0n),
    cbBtcToken.balanceOf(cbBtcReserve.aTokenAddress),
  ]);

  const output = {
    checkedAt: new Date().toISOString(),
    addresses: {
      pool: POOL,
      dUSD: DUSD,
      cbBTC: CBBTC,
      attacker: ATTACKER,
    },
    attacker: {
      dUSDVariableDebtRaw: attackerDebt.toString(),
      cbBTCAttackerBalanceRaw: cbBtcBalance.toString(),
      cbBTCAttackerScaledBalanceRaw: cbBtcScaledBalance.toString(),
      cbBTCUnderlyingInATokenRaw: cbBtcUnderlyingInAToken.toString(),
      userAccountData: {
        totalCollateralBase: attackerAccountData.totalCollateralBase.toString(),
        totalDebtBase: attackerAccountData.totalDebtBase.toString(),
        availableBorrowsBase: attackerAccountData.availableBorrowsBase.toString(),
        currentLiquidationThreshold: attackerAccountData.currentLiquidationThreshold.toString(),
        ltv: attackerAccountData.ltv.toString(),
        healthFactor: attackerAccountData.healthFactor.toString(),
      },
    },
    dusdConfig,
    reserves: reservesOut,
    summary: {
      reserveCount: reservesOut.length,
      reservesWithDustFlashRisk: reservesOut.filter((reserve) => reserve.warnings.dustFlashRisk).map((reserve) => reserve.symbol),
      frozenButFlashloanEnabled: reservesOut
        .filter((reserve) => reserve.warnings.freezeDoesNotDisableFlashLoans)
        .map((reserve) => reserve.symbol),
    },
  };

  console.log(JSON.stringify(output, null, 2));
}

main().catch((error) => {
  console.error(error);
  process.exit(1);
});
