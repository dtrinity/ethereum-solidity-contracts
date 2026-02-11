import { IReserveParams } from "../types";
import { rateStrategyBorrowDStable, rateStrategyHighLiquidityStable, rateStrategyHighLiquidityVolatile } from "./interest-rate-strategies";

const baseReserveConfig: Pick<
  IReserveParams,
  "aTokenImpl" | "reserveDecimals" | "debtCeiling" | "borrowableIsolation" | "flashLoanEnabled" | "liquidationProtocolFee"
> = {
  aTokenImpl: "ATokenImpl",
  reserveDecimals: "18",
  debtCeiling: "0",
  borrowableIsolation: false,
  flashLoanEnabled: true,
  liquidationProtocolFee: "1000", // 10%
};

const baseDSTABLEConfig: IReserveParams = {
  ...baseReserveConfig,
  reserveFactor: "1000", // 10%
  supplyCap: "0",
  borrowingEnabled: true,
  stableBorrowRateEnabled: false,
  borrowCap: "0",
  baseLTVAsCollateral: "0",
  liquidationThreshold: "0",
  liquidationBonus: "0",
  strategy: rateStrategyBorrowDStable,
};

/**
 * Builds a non-borrowable collateral reserve strategy from the provided risk parameters.
 */
function buildCollateralStrategy(params: {
  supplyCap: string;
  baseLTVAsCollateral: string;
  liquidationThreshold: string;
  liquidationBonus: string;
  reserveDecimals?: string;
  strategy?: IReserveParams["strategy"];
}): IReserveParams {
  return {
    ...baseReserveConfig,
    reserveDecimals: params.reserveDecimals ?? baseReserveConfig.reserveDecimals,
    reserveFactor: "1000",
    borrowingEnabled: false,
    stableBorrowRateEnabled: false,
    borrowCap: "0",
    supplyCap: params.supplyCap,
    baseLTVAsCollateral: params.baseLTVAsCollateral,
    liquidationThreshold: params.liquidationThreshold,
    liquidationBonus: params.liquidationBonus,
    strategy: params.strategy ?? rateStrategyHighLiquidityVolatile,
  };
}

// dSTABLEs
export const strategyDUSD: IReserveParams = {
  ...baseDSTABLEConfig,
  supplyCap: "1000000",
};

export const strategyDETH: IReserveParams = {
  ...baseDSTABLEConfig,
  supplyCap: "500",
  strategy: rateStrategyBorrowDStable,
};

// Yieldcoin collateral
export const strategySUSDE: IReserveParams = buildCollateralStrategy({
  supplyCap: "450000",
  baseLTVAsCollateral: "7200",
  liquidationThreshold: "7500",
  liquidationBonus: "10850",
  strategy: rateStrategyHighLiquidityStable,
});

export const strategySUSDS: IReserveParams = buildCollateralStrategy({
  supplyCap: "500000",
  baseLTVAsCollateral: "7500",
  liquidationThreshold: "7800",
  liquidationBonus: "10450",
  strategy: rateStrategyHighLiquidityStable,
});

export const strategySYRUPUSDC: IReserveParams = buildCollateralStrategy({
  supplyCap: "500000",
  baseLTVAsCollateral: "7200",
  liquidationThreshold: "7500",
  liquidationBonus: "10600",
  strategy: rateStrategyHighLiquidityStable,
});

export const strategySYRUPUSDT: IReserveParams = buildCollateralStrategy({
  supplyCap: "500000",
  baseLTVAsCollateral: "7200",
  liquidationThreshold: "7500",
  liquidationBonus: "10600",
  strategy: rateStrategyHighLiquidityStable,
});

export const strategySFRXUSD: IReserveParams = buildCollateralStrategy({
  supplyCap: "500000",
  baseLTVAsCollateral: "7200",
  liquidationThreshold: "7500",
  liquidationBonus: "10600",
  strategy: rateStrategyHighLiquidityStable,
});

// LST and ETH collateral
export const strategyWETH: IReserveParams = buildCollateralStrategy({
  supplyCap: "250",
  baseLTVAsCollateral: "8050",
  liquidationThreshold: "8300",
  liquidationBonus: "10500",
});

export const strategySTETH: IReserveParams = buildCollateralStrategy({
  supplyCap: "250",
  baseLTVAsCollateral: "7850",
  liquidationThreshold: "8100",
  liquidationBonus: "10600",
});

export const strategyRETH: IReserveParams = buildCollateralStrategy({
  supplyCap: "250",
  baseLTVAsCollateral: "7500",
  liquidationThreshold: "7900",
  liquidationBonus: "10750",
});

export const strategySFRXETH: IReserveParams = buildCollateralStrategy({
  supplyCap: "250",
  baseLTVAsCollateral: "7850",
  liquidationThreshold: "8100",
  liquidationBonus: "10600",
});

export const strategyFRXETH: IReserveParams = buildCollateralStrategy({
  supplyCap: "250",
  baseLTVAsCollateral: "7850",
  liquidationThreshold: "8100",
  liquidationBonus: "10600",
});

// BTC and RWA collateral
export const strategyLBTC: IReserveParams = buildCollateralStrategy({
  supplyCap: "8",
  reserveDecimals: "8",
  baseLTVAsCollateral: "7000",
  liquidationThreshold: "7500",
  liquidationBonus: "10850",
});

export const strategyWBTC: IReserveParams = buildCollateralStrategy({
  supplyCap: "8",
  reserveDecimals: "8",
  baseLTVAsCollateral: "7300",
  liquidationThreshold: "7800",
  liquidationBonus: "10500",
});

export const strategyCBBTC: IReserveParams = buildCollateralStrategy({
  supplyCap: "8",
  reserveDecimals: "8",
  baseLTVAsCollateral: "7300",
  liquidationThreshold: "7800",
  liquidationBonus: "10750",
});

export const strategyPAXG: IReserveParams = buildCollateralStrategy({
  supplyCap: "100",
  baseLTVAsCollateral: "7000",
  liquidationThreshold: "7500",
  liquidationBonus: "10600",
});
