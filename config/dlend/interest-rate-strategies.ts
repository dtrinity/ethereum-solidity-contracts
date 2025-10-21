import { IInterestRateStrategyParams } from "../types";

// Rate strategy for high liquidity volatile assets (like ETH, BTC)
export const rateStrategyHighLiquidityVolatile: IInterestRateStrategyParams = {
  name: "rateStrategyHighLiquidityVolatile",
  optimalUsageRatio: "0.8", // 80%
  baseVariableBorrowRate: "0.01", // 1%
  variableRateSlope1: "0.04", // 4%
  variableRateSlope2: "0.75", // 75%
  stableRateSlope1: "0.04", // 4%
  stableRateSlope2: "0.75", // 75%
  baseStableRateOffset: "0.02", // 2%
  stableRateExcessOffset: "0.08", // 8%
  optimalStableToTotalDebtRatio: "0.2", // 20%
};

// Rate strategy for medium liquidity volatile assets
export const rateStrategyMediumLiquidityVolatile: IInterestRateStrategyParams = {
  name: "rateStrategyMediumLiquidityVolatile",
  optimalUsageRatio: "0.7", // 70%
  baseVariableBorrowRate: "0.015", // 1.5%
  variableRateSlope1: "0.06", // 6%
  variableRateSlope2: "1.0", // 100%
  stableRateSlope1: "0.06", // 6%
  stableRateSlope2: "1.0", // 100%
  baseStableRateOffset: "0.03", // 3%
  stableRateExcessOffset: "0.1", // 10%
  optimalStableToTotalDebtRatio: "0.15", // 15%
};

// Rate strategy for high liquidity stable assets (like USDC, USDT)
export const rateStrategyHighLiquidityStable: IInterestRateStrategyParams = {
  name: "rateStrategyHighLiquidityStable",
  optimalUsageRatio: "0.9", // 90%
  baseVariableBorrowRate: "0.005", // 0.5%
  variableRateSlope1: "0.02", // 2%
  variableRateSlope2: "0.5", // 50%
  stableRateSlope1: "0.02", // 2%
  stableRateSlope2: "0.5", // 50%
  baseStableRateOffset: "0.01", // 1%
  stableRateExcessOffset: "0.05", // 5%
  optimalStableToTotalDebtRatio: "0.25", // 25%
};

// Rate strategy for medium liquidity stable assets
export const rateStrategyMediumLiquidityStable: IInterestRateStrategyParams = {
  name: "rateStrategyMediumLiquidityStable",
  optimalUsageRatio: "0.85", // 85%
  baseVariableBorrowRate: "0.01", // 1%
  variableRateSlope1: "0.03", // 3%
  variableRateSlope2: "0.75", // 75%
  stableRateSlope1: "0.03", // 3%
  stableRateSlope2: "0.75", // 75%
  baseStableRateOffset: "0.015", // 1.5%
  stableRateExcessOffset: "0.08", // 8%
  optimalStableToTotalDebtRatio: "0.2", // 20%
};
