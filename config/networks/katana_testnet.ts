import { ZeroAddress } from "ethers";
import { HardhatRuntimeEnvironment } from "hardhat/types";

import { ONE_PERCENT_BPS } from "../../typescript/common/bps_constants";
import { DETH_TOKEN_ID, DUSD_TOKEN_ID } from "../../typescript/deploy-ids";
import { ORACLE_AGGREGATOR_BASE_CURRENCY_UNIT, ORACLE_AGGREGATOR_PRICE_DECIMALS } from "../../typescript/oracle_aggregator/constants";
import { Config } from "../types";

/**
 * Get the configuration for the network
 *
 * @param _hre - Hardhat Runtime Environment
 * @returns The configuration for the network
 */
export async function getConfig(_hre: HardhatRuntimeEnvironment): Promise<Config> {
  // Token info will only be populated after their deployment
  const dUSDDeployment = await _hre.deployments.getOrNull(DUSD_TOKEN_ID);
  const dETHDeployment = await _hre.deployments.getOrNull(DETH_TOKEN_ID);
  const USDCDeployment = await _hre.deployments.getOrNull("USDC");
  const USDTDeployment = await _hre.deployments.getOrNull("USDT");
  const AUSDDeployment = await _hre.deployments.getOrNull("AUSD");
  const yUSDDeployment = await _hre.deployments.getOrNull("yUSD");
  const frxUSDDeployment = await _hre.deployments.getOrNull("frxUSD");
  const sfrxUSDDeployment = await _hre.deployments.getOrNull("sfrxUSD");
  const WETHDeployment = await _hre.deployments.getOrNull("WETH");
  const stETHDeployment = await _hre.deployments.getOrNull("stETH");

  // // Fetch deployed dSTAKE tokens for vesting
  // const sdUSDDeployment = await _hre.deployments.getOrNull(SDUSD_DSTAKE_TOKEN_ID);

  // Get mock oracle deployments
  const mockOracleNameToAddress: Record<string, string> = {};

  // Get mock oracle addresses
  const mockOracleAddressesDeployment = await _hre.deployments.getOrNull("MockOracleNameToAddress");

  // Mock oracles won't exist initially, so we need to check if they do
  if (mockOracleAddressesDeployment?.linkedData) {
    Object.assign(mockOracleNameToAddress, mockOracleAddressesDeployment.linkedData);
  }

  // Get the named accounts
  const namedAccounts = await _hre.getNamedAccounts();
  const deployer = namedAccounts.deployer;
  // Use deployer as governance for testnet since we may not have multiple accounts
  const governanceAddress = deployer;

  return {
    MOCK_ONLY: {
      tokens: {
        USDC: {
          name: "USD Coin",
          address: USDCDeployment?.address,
          decimals: 6,
          initialSupply: 1e6,
        },
        USDT: {
          name: "Tether USD",
          address: USDTDeployment?.address,
          decimals: 6,
          initialSupply: 1e6,
        },
        AUSD: {
          name: "AUSD Stablecoin",
          address: AUSDDeployment?.address,
          decimals: 18,
          initialSupply: 1e6,
        },
        yUSD: {
          name: "Yield USD",
          address: yUSDDeployment?.address,
          decimals: 18,
          initialSupply: 1e6,
        },
        frxUSD: {
          name: "Frax USD",
          address: frxUSDDeployment?.address,
          decimals: 18,
          initialSupply: 1e6,
        },
        sfrxUSD: {
          name: "Staked Frax USD",
          address: sfrxUSDDeployment?.address,
          decimals: 18,
          initialSupply: 1e6,
        },
        WETH: {
          name: "Wrapped ETH",
          address: WETHDeployment?.address,
          decimals: 18,
          initialSupply: 1e6,
        },
        stETH: {
          name: "Staked ETH",
          address: stETHDeployment?.address,
          decimals: 18,
          initialSupply: 1e6,
        },
      },
      curvePools: {},
    },
    tokenAddresses: {
      dUSD: emptyStringIfUndefined(dUSDDeployment?.address),
      dETH: emptyStringIfUndefined(dETHDeployment?.address),
      WETH: emptyStringIfUndefined(WETHDeployment?.address),
      stETH: emptyStringIfUndefined(stETHDeployment?.address),
      frxUSD: emptyStringIfUndefined(frxUSDDeployment?.address),
      sfrxUSD: emptyStringIfUndefined(sfrxUSDDeployment?.address),
      USDC: emptyStringIfUndefined(USDCDeployment?.address),
      USDT: emptyStringIfUndefined(USDTDeployment?.address),
      AUSD: emptyStringIfUndefined(AUSDDeployment?.address),
      yUSD: emptyStringIfUndefined(yUSDDeployment?.address),
    },
    walletAddresses: {
      governanceMultisig: governanceAddress,
      incentivesVault: deployer,
    },
    dStables: {
      dUSD: {
        collaterals: [
          USDCDeployment?.address || ZeroAddress,
          USDTDeployment?.address || ZeroAddress,
          AUSDDeployment?.address || ZeroAddress,
          frxUSDDeployment?.address || ZeroAddress,
          sfrxUSDDeployment?.address || ZeroAddress,
          yUSDDeployment?.address || ZeroAddress,
        ],
        initialFeeReceiver: deployer,
        initialRedemptionFeeBps: 0.4 * ONE_PERCENT_BPS, // Default for stablecoins
        collateralRedemptionFees: {
          // Stablecoins: 0.4%
          [USDCDeployment?.address || ZeroAddress]: 0.4 * ONE_PERCENT_BPS,
          [USDTDeployment?.address || ZeroAddress]: 0.4 * ONE_PERCENT_BPS,
          [AUSDDeployment?.address || ZeroAddress]: 0.4 * ONE_PERCENT_BPS,
          [frxUSDDeployment?.address || ZeroAddress]: 0.4 * ONE_PERCENT_BPS,
          // Yield bearing stablecoins: 0.5%
          [sfrxUSDDeployment?.address || ZeroAddress]: 0.5 * ONE_PERCENT_BPS,
          [yUSDDeployment?.address || ZeroAddress]: 0.5 * ONE_PERCENT_BPS,
        },
      },
      dETH: {
        collaterals: [WETHDeployment?.address || ZeroAddress, stETHDeployment?.address || ZeroAddress],
        initialFeeReceiver: deployer,
        initialRedemptionFeeBps: 0.4 * ONE_PERCENT_BPS, // Default for stablecoins
        collateralRedemptionFees: {
          // Stablecoins: 0.4%
          [WETHDeployment?.address || ZeroAddress]: 0.4 * ONE_PERCENT_BPS,
          // Yield bearing stablecoins: 0.5%
          [stETHDeployment?.address || ZeroAddress]: 0.5 * ONE_PERCENT_BPS,
        },
      },
    },
    oracleAggregators: {
      USD: {
        hardDStablePeg: 1n * ORACLE_AGGREGATOR_BASE_CURRENCY_UNIT,
        priceDecimals: ORACLE_AGGREGATOR_PRICE_DECIMALS,
        baseCurrency: ZeroAddress,
        api3OracleAssets: {
          plainApi3OracleWrappers: {},
          api3OracleWrappersWithThresholding: {
            ...(frxUSDDeployment?.address && mockOracleNameToAddress["frxUSD_USD"]
              ? {
                  [frxUSDDeployment.address]: {
                    proxy: mockOracleNameToAddress["frxUSD_USD"],
                    lowerThreshold: ORACLE_AGGREGATOR_BASE_CURRENCY_UNIT,
                    fixedPrice: ORACLE_AGGREGATOR_BASE_CURRENCY_UNIT,
                  },
                }
              : {}),
          },
          compositeApi3OracleWrappersWithThresholding: {
            ...(sfrxUSDDeployment?.address && mockOracleNameToAddress["sfrxUSD_frxUSD"] && mockOracleNameToAddress["frxUSD_USD"]
              ? {
                  [sfrxUSDDeployment.address]: {
                    feedAsset: sfrxUSDDeployment.address,
                    proxy1: mockOracleNameToAddress["sfrxUSD_frxUSD"],
                    proxy2: mockOracleNameToAddress["frxUSD_USD"],
                    lowerThresholdInBase1: 0n,
                    fixedPriceInBase1: 0n,
                    lowerThresholdInBase2: ORACLE_AGGREGATOR_BASE_CURRENCY_UNIT,
                    fixedPriceInBase2: ORACLE_AGGREGATOR_BASE_CURRENCY_UNIT,
                  },
                }
              : {}),
          },
        },
        redstoneOracleAssets: {
          plainRedstoneOracleWrappers: {
            ...(WETHDeployment?.address && mockOracleNameToAddress["WETH_USD"]
              ? {
                  [WETHDeployment.address]: mockOracleNameToAddress["WETH_USD"],
                }
              : {}),
            ...(dETHDeployment?.address && mockOracleNameToAddress["WETH_USD"]
              ? {
                  [dETHDeployment.address]: mockOracleNameToAddress["WETH_USD"], // Peg dETH to ETH
                }
              : {}),
            ...(yUSDDeployment?.address && mockOracleNameToAddress["yUSD_USD"]
              ? {
                  [yUSDDeployment.address]: mockOracleNameToAddress["yUSD_USD"],
                }
              : {}),
          },
          redstoneOracleWrappersWithThresholding: {
            ...(USDCDeployment?.address && mockOracleNameToAddress["USDC_USD"]
              ? {
                  [USDCDeployment.address]: {
                    feed: mockOracleNameToAddress["USDC_USD"],
                    lowerThreshold: ORACLE_AGGREGATOR_BASE_CURRENCY_UNIT,
                    fixedPrice: ORACLE_AGGREGATOR_BASE_CURRENCY_UNIT,
                  },
                }
              : {}),
            ...(USDTDeployment?.address && mockOracleNameToAddress["USDT_USD"]
              ? {
                  [USDTDeployment.address]: {
                    feed: mockOracleNameToAddress["USDT_USD"],
                    lowerThreshold: ORACLE_AGGREGATOR_BASE_CURRENCY_UNIT,
                    fixedPrice: ORACLE_AGGREGATOR_BASE_CURRENCY_UNIT,
                  },
                }
              : {}),
            ...(AUSDDeployment?.address && mockOracleNameToAddress["AUSD_USD"]
              ? {
                  [AUSDDeployment.address]: {
                    feed: mockOracleNameToAddress["AUSD_USD"],
                    lowerThreshold: ORACLE_AGGREGATOR_BASE_CURRENCY_UNIT,
                    fixedPrice: ORACLE_AGGREGATOR_BASE_CURRENCY_UNIT,
                  },
                }
              : {}),
          },
          compositeRedstoneOracleWrappersWithThresholding: {
            ...(stETHDeployment?.address && mockOracleNameToAddress["stETH_WETH"] && mockOracleNameToAddress["WETH_USD"]
              ? {
                  [stETHDeployment.address]: {
                    feedAsset: stETHDeployment.address,
                    feed1: mockOracleNameToAddress["stETH_WETH"],
                    feed2: mockOracleNameToAddress["WETH_USD"],
                    lowerThresholdInBase1: 0n,
                    fixedPriceInBase1: 0n,
                    lowerThresholdInBase2: 0n,
                    fixedPriceInBase2: 0n,
                  },
                }
              : {}),
          },
        },
      },
      ETH: {
        hardDStablePeg: 1n * ORACLE_AGGREGATOR_BASE_CURRENCY_UNIT,
        priceDecimals: ORACLE_AGGREGATOR_PRICE_DECIMALS,
        baseCurrency: WETHDeployment?.address || ZeroAddress, // Base currency is WETH
        api3OracleAssets: {
          plainApi3OracleWrappers: {},
          api3OracleWrappersWithThresholding: {},
          compositeApi3OracleWrappersWithThresholding: {},
        },
        redstoneOracleAssets: {
          plainRedstoneOracleWrappers: {
            ...(stETHDeployment?.address && mockOracleNameToAddress["stETH_WETH"]
              ? {
                  [stETHDeployment.address]: mockOracleNameToAddress["stETH_WETH"],
                }
              : {}),
          },
          redstoneOracleWrappersWithThresholding: {},
          compositeRedstoneOracleWrappersWithThresholding: {},
        },
      },
    },
  };
}

/**
 * Return an empty string if the value is undefined
 *
 * @param value - The value to check
 * @returns An empty string if the value is undefined, otherwise the value itself
 */
function emptyStringIfUndefined(value: string | undefined): string {
  return value || "";
}
