import { ZeroAddress } from "ethers";
import { HardhatRuntimeEnvironment } from "hardhat/types";

import { ORACLE_AGGREGATOR_BASE_CURRENCY_UNIT, ORACLE_AGGREGATOR_PRICE_DECIMALS } from "../../typescript/oracle_aggregator/constants";
import { Config } from "../types";

/**
 * Lightweight configuration for Ethereum test environments.
 * Replace placeholder addresses as on-chain deployments become available.
 *
 * @param _hre - Hardhat runtime environment (unused placeholder for future wiring).
 */
export async function getConfig(_hre: HardhatRuntimeEnvironment): Promise<Config> {
  return {
    MOCK_ONLY: {
      tokens: {},
      curvePools: {},
    },
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
        baseCurrency: "USD",
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
