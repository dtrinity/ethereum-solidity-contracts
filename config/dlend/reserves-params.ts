import { IReserveParams } from "../types";
import {
  rateStrategyBorrowDStable,
  rateStrategyHighLiquidityStable,
  rateStrategyHighLiquidityVolatile,
} from "./interest-rate-strategies";

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
  stableBorrowRateEnabled: false, // Disabled due to exploit concerns
  borrowCap: "0",
  baseLTVAsCollateral: "0",
  liquidationThreshold: "0",
  liquidationBonus: "0",
  strategy: rateStrategyBorrowDStable,
};

// dSTABLEs
export const strategyDUSD: IReserveParams = {
  ...baseDSTABLEConfig,
  supplyCap: "1000000", // 1M
};

export const strategyDETH: IReserveParams = {
  ...baseDSTABLEConfig,
  supplyCap: "500", // 500 dETH
  strategy: rateStrategyBorrowDStable,
};

// LSTs and ETH
const baseETHLikeConfig: IReserveParams = {
  ...baseReserveConfig,
  reserveFactor: "1000",
  borrowingEnabled: false, // Non-dSTABLEs are collateral only
  stableBorrowRateEnabled: false,
  borrowCap: "0",
  baseLTVAsCollateral: "8000",
  liquidationThreshold: "8500",
  liquidationBonus: "10500",
  strategy: rateStrategyHighLiquidityVolatile,
  supplyCap: "0",
};

export const strategyWETH: IReserveParams = {
  ...baseETHLikeConfig,
  supplyCap: "1000",
};

export const strategySTETH: IReserveParams = {
  ...baseETHLikeConfig,
  supplyCap: "1000",
};

export const strategySFRXETH: IReserveParams = {
  ...baseETHLikeConfig,
  supplyCap: "1000",
};

export const strategyFRXETH: IReserveParams = {
  ...baseETHLikeConfig,
  supplyCap: "1000",
};

// USD yield-bearing collateral
export const strategySFRXUSD: IReserveParams = {
  ...baseReserveConfig,
  reserveFactor: "1000",
  borrowingEnabled: false,
  stableBorrowRateEnabled: false,
  borrowCap: "0",
  baseLTVAsCollateral: "8000",
  liquidationThreshold: "8500",
  liquidationBonus: "10500",
  strategy: rateStrategyHighLiquidityStable,
  supplyCap: "1000000",
};
