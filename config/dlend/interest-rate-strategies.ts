import { ethers } from "ethers";

import { IInterestRateStrategyParams } from "../types";

/* Intuition:
 * Borrow APR at 0% utilization: baseVariableBorrowRate
 * Borrow APR at optimal utilization: baseVariableBorrowRate + variableRateSlope1
 * Borrow APR at 100% utilization: baseVariableBorrowRate + variableRateSlope1 + variableRateSlope2
 */

export const rateStrategyBorrowDStable: IInterestRateStrategyParams = {
  name: "rateStrategyBorrowDStable",
  optimalUsageRatio: ethers.parseUnits("0.8", 27).toString(), // 80% kink
  baseVariableBorrowRate: ethers.parseUnits("0.05", 27).toString(), // 5%
  variableRateSlope1: ethers.parseUnits("0.05", 27).toString(), // 5%
  variableRateSlope2: ethers.parseUnits("0.2", 27).toString(), // 20%
  stableRateSlope1: ethers.parseUnits("0", 27).toString(),
  stableRateSlope2: ethers.parseUnits("0", 27).toString(),
  baseStableRateOffset: ethers.parseUnits("0", 27).toString(),
  stableRateExcessOffset: ethers.parseUnits("0", 27).toString(),
  optimalStableToTotalDebtRatio: ethers.parseUnits("0", 27).toString(),
};

export const rateStrategyHighLiquidityVolatile: IInterestRateStrategyParams = {
  name: "rateStrategyHighLiquidityVolatile",
  optimalUsageRatio: ethers.parseUnits("0.5", 27).toString(), // kink
  baseVariableBorrowRate: "0",
  variableRateSlope1: ethers.parseUnits("0.03", 27).toString(),
  variableRateSlope2: ethers.parseUnits("1.97", 27).toString(),
  stableRateSlope1: ethers.parseUnits("0", 27).toString(),
  stableRateSlope2: ethers.parseUnits("0", 27).toString(),
  baseStableRateOffset: ethers.parseUnits("0", 27).toString(),
  stableRateExcessOffset: ethers.parseUnits("0", 27).toString(),
  optimalStableToTotalDebtRatio: ethers.parseUnits("0", 27).toString(),
};

export const rateStrategyMediumLiquidityVolatile: IInterestRateStrategyParams = {
  name: "rateStrategyMediumLiquidityVolatile",
  optimalUsageRatio: ethers.parseUnits("0.4", 27).toString(),
  baseVariableBorrowRate: "0",
  variableRateSlope1: ethers.parseUnits("0.03", 27).toString(),
  variableRateSlope2: ethers.parseUnits("1.97", 27).toString(),
  stableRateSlope1: ethers.parseUnits("0", 27).toString(),
  stableRateSlope2: ethers.parseUnits("0", 27).toString(),
  baseStableRateOffset: ethers.parseUnits("0", 27).toString(),
  stableRateExcessOffset: ethers.parseUnits("0", 27).toString(),
  optimalStableToTotalDebtRatio: ethers.parseUnits("0", 27).toString(),
};

export const rateStrategyHighLiquidityStable: IInterestRateStrategyParams = {
  name: "rateStrategyHighLiquidityStable",
  optimalUsageRatio: ethers.parseUnits("0.9", 27).toString(),
  baseVariableBorrowRate: ethers.parseUnits("0", 27).toString(),
  variableRateSlope1: ethers.parseUnits("0.06", 27).toString(),
  variableRateSlope2: ethers.parseUnits("0.54", 27).toString(),
  stableRateSlope1: ethers.parseUnits("0", 27).toString(),
  stableRateSlope2: ethers.parseUnits("0", 27).toString(),
  baseStableRateOffset: ethers.parseUnits("0", 27).toString(),
  stableRateExcessOffset: ethers.parseUnits("0", 27).toString(),
  optimalStableToTotalDebtRatio: ethers.parseUnits("0", 27).toString(),
};

export const rateStrategyMediumLiquidityStable: IInterestRateStrategyParams = {
  name: "rateStrategyMediumLiquidityStable",
  optimalUsageRatio: ethers.parseUnits("0.8", 27).toString(),
  baseVariableBorrowRate: ethers.parseUnits("0", 27).toString(),
  variableRateSlope1: ethers.parseUnits("0.06", 27).toString(),
  variableRateSlope2: ethers.parseUnits("0.54", 27).toString(),
  stableRateSlope1: ethers.parseUnits("0", 27).toString(),
  stableRateSlope2: ethers.parseUnits("0", 27).toString(),
  baseStableRateOffset: ethers.parseUnits("0", 27).toString(),
  stableRateExcessOffset: ethers.parseUnits("0", 27).toString(),
  optimalStableToTotalDebtRatio: ethers.parseUnits("0", 27).toString(),
};

export const rateStrategyZeroBorrow: IInterestRateStrategyParams = {
  name: "rateStrategyZeroBorrow",
  optimalUsageRatio: ethers.parseUnits("0.8", 27).toString(),
  baseVariableBorrowRate: "0",
  variableRateSlope1: "0",
  variableRateSlope2: "0",
  stableRateSlope1: "0",
  stableRateSlope2: "0",
  baseStableRateOffset: "0",
  stableRateExcessOffset: "0",
  optimalStableToTotalDebtRatio: "0",
};
