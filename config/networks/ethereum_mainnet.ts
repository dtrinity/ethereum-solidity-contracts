import { ZeroAddress } from "ethers";
import { HardhatRuntimeEnvironment } from "hardhat/types";

import { ORACLE_AGGREGATOR_BASE_CURRENCY_UNIT, ORACLE_AGGREGATOR_PRICE_DECIMALS } from "../../typescript/oracle_aggregator/constants";
import { Config } from "../types";

/**
 * Placeholder Ethereum mainnet configuration.
 * Actual contract addresses and oracle wiring will be filled in once deployments are scheduled.
 *
 * @param _hre - Hardhat runtime environment (unused placeholder for future wiring).
 */
export async function getConfig(_hre: HardhatRuntimeEnvironment): Promise<Config> {
  return {
    tokenAddresses: {
      WETH: ZeroAddress,
      dUSD: "",
      dETH: "",
    },
    walletAddresses: {
      governanceMultisig: ZeroAddress,
      incentivesVault: ZeroAddress,
    },
    oracleAggregators: {
      USD: {
        priceDecimals: ORACLE_AGGREGATOR_PRICE_DECIMALS,
        hardDStablePeg: ORACLE_AGGREGATOR_BASE_CURRENCY_UNIT,
        baseCurrency: ZeroAddress,
        api3OracleAssets: {
          plainApi3OracleWrappers: {},
          api3OracleWrappersWithThresholding: {},
          compositeApi3OracleWrappersWithThresholding: {},
        },
        redstoneOracleAssets: {
          plainRedstoneOracleWrappers: {},
          redstoneOracleWrappersWithThresholding: {},
          compositeRedstoneOracleWrappersWithThresholding: {},
        },
      },
    },
    dStables: {
      dUSD: {
        collaterals: [],
        initialFeeReceiver: ZeroAddress,
        initialRedemptionFeeBps: 0,
        collateralRedemptionFees: {},
      },
      dETH: {
        collaterals: [],
        initialFeeReceiver: ZeroAddress,
        initialRedemptionFeeBps: 0,
        collateralRedemptionFees: {},
      },
    },
  };
}
