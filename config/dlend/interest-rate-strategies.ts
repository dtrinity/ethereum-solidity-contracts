import { ethers } from "ethers";

import { IInterestRateStrategyParams } from "../types";

/**
 * Convert a human-readable decimal rate string into a ray-encoded string representation.
 *
 * @param value Human-readable decimal value (e.g. "0.8" for 80%).
 */
function toRay(value: string): string {
  return ethers.parseUnits(value, 27).toString();
}

// Rate strategy for high liquidity volatile assets (like ETH, BTC)
export const rateStrategyHighLiquidityVolatile: IInterestRateStrategyParams = {
  name: "rateStrategyHighLiquidityVolatile",
  optimalUsageRatio: toRay("0.8"),
  baseVariableBorrowRate: toRay("0.01"),
  variableRateSlope1: toRay("0.04"),
  variableRateSlope2: toRay("0.75"),
  stableRateSlope1: toRay("0.04"),
  stableRateSlope2: toRay("0.75"),
  baseStableRateOffset: toRay("0.02"),
  stableRateExcessOffset: toRay("0.08"),
  optimalStableToTotalDebtRatio: toRay("0.2"),
};

// Rate strategy for medium liquidity volatile assets
export const rateStrategyMediumLiquidityVolatile: IInterestRateStrategyParams = {
  name: "rateStrategyMediumLiquidityVolatile",
  optimalUsageRatio: toRay("0.7"),
  baseVariableBorrowRate: toRay("0.015"),
  variableRateSlope1: toRay("0.06"),
  variableRateSlope2: toRay("1.0"),
  stableRateSlope1: toRay("0.06"),
  stableRateSlope2: toRay("1.0"),
  baseStableRateOffset: toRay("0.03"),
  stableRateExcessOffset: toRay("0.1"),
  optimalStableToTotalDebtRatio: toRay("0.15"),
};

// Rate strategy for high liquidity stable assets (like USDC, USDT)
export const rateStrategyHighLiquidityStable: IInterestRateStrategyParams = {
  name: "rateStrategyHighLiquidityStable",
  optimalUsageRatio: toRay("0.9"),
  baseVariableBorrowRate: toRay("0.005"),
  variableRateSlope1: toRay("0.02"),
  variableRateSlope2: toRay("0.5"),
  stableRateSlope1: toRay("0.02"),
  stableRateSlope2: toRay("0.5"),
  baseStableRateOffset: toRay("0.01"),
  stableRateExcessOffset: toRay("0.05"),
  optimalStableToTotalDebtRatio: toRay("0.25"),
};

// Rate strategy for medium liquidity stable assets
export const rateStrategyMediumLiquidityStable: IInterestRateStrategyParams = {
  name: "rateStrategyMediumLiquidityStable",
  optimalUsageRatio: toRay("0.85"),
  baseVariableBorrowRate: toRay("0.01"),
  variableRateSlope1: toRay("0.03"),
  variableRateSlope2: toRay("0.75"),
  stableRateSlope1: toRay("0.03"),
  stableRateSlope2: toRay("0.75"),
  baseStableRateOffset: toRay("0.015"),
  stableRateExcessOffset: toRay("0.08"),
  optimalStableToTotalDebtRatio: toRay("0.2"),
};
