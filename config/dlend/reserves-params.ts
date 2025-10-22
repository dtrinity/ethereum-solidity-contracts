import { IReserveParams } from "../types";
import {
  rateStrategyHighLiquidityStable,
  rateStrategyHighLiquidityVolatile,
  rateStrategyMediumLiquidityStable,
  rateStrategyMediumLiquidityVolatile,
} from "./interest-rate-strategies";

// dUSD reserve parameters
export const strategyDUSD: IReserveParams = {
  aTokenImpl: "ATokenImpl",
  reserveFactor: "1000", // 10%
  supplyCap: "1000000", // 1M
  borrowingEnabled: true,
  stableBorrowRateEnabled: false, // Disabled due to exploit concerns
  reserveDecimals: "18",
  borrowCap: "800000", // 800K
  debtCeiling: "0", // No isolation mode
  borrowableIsolation: false,
  flashLoanEnabled: true,
  baseLTVAsCollateral: "0", // dSTABLEs are not accepted as collateral
  liquidationThreshold: "0",
  liquidationBonus: "0",
  liquidationProtocolFee: "1000", // 10%
  strategy: rateStrategyHighLiquidityStable,
};

// dETH reserve parameters
export const strategyDETH: IReserveParams = {
  aTokenImpl: "ATokenImpl",
  reserveFactor: "1500", // 15%
  supplyCap: "500", // 500 dETH
  borrowingEnabled: true,
  stableBorrowRateEnabled: false,
  reserveDecimals: "18",
  borrowCap: "400", // 400 dETH
  debtCeiling: "0",
  borrowableIsolation: false,
  flashLoanEnabled: true,
  baseLTVAsCollateral: "0",
  liquidationThreshold: "0",
  liquidationBonus: "0",
  liquidationProtocolFee: "1000",
  strategy: rateStrategyMediumLiquidityVolatile,
};

// WETH reserve parameters
export const strategyWETH: IReserveParams = {
  aTokenImpl: "ATokenImpl",
  reserveFactor: "1000", // 10%
  supplyCap: "1000", // 1K WETH
  borrowingEnabled: true,
  stableBorrowRateEnabled: false,
  reserveDecimals: "18",
  borrowCap: "800", // 800 WETH
  debtCeiling: "0",
  borrowableIsolation: false,
  flashLoanEnabled: true,
  baseLTVAsCollateral: "8000", // 80%
  liquidationThreshold: "8250", // 82.5%
  liquidationBonus: "10500", // 5%
  liquidationProtocolFee: "1000",
  strategy: rateStrategyHighLiquidityVolatile,
};

// stETH reserve parameters
export const strategySTETH: IReserveParams = {
  aTokenImpl: "ATokenImpl",
  reserveFactor: "1500", // 15%
  supplyCap: "1000", // 1K stETH
  borrowingEnabled: true,
  stableBorrowRateEnabled: false,
  reserveDecimals: "18",
  borrowCap: "200", // 200 stETH (lower due to volatility)
  debtCeiling: "0",
  borrowableIsolation: false,
  flashLoanEnabled: true,
  baseLTVAsCollateral: "6900", // 69%
  liquidationThreshold: "7900", // 79%
  liquidationBonus: "10750", // 7.5%
  liquidationProtocolFee: "1000",
  strategy: rateStrategyMediumLiquidityVolatile,
};

// sfrxUSD reserve parameters
export const strategySFRXUSD: IReserveParams = {
  aTokenImpl: "ATokenImpl",
  reserveFactor: "2000", // 20%
  supplyCap: "500000", // 500K sfrxUSD
  borrowingEnabled: true,
  stableBorrowRateEnabled: false,
  reserveDecimals: "18",
  borrowCap: "400000", // 400K sfrxUSD
  debtCeiling: "0",
  borrowableIsolation: false,
  flashLoanEnabled: true,
  baseLTVAsCollateral: "7500", // 75%
  liquidationThreshold: "8000", // 80%
  liquidationBonus: "10600", // 6%
  liquidationProtocolFee: "1000",
  strategy: rateStrategyMediumLiquidityStable,
};
