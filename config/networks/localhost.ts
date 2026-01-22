import "hardhat-deploy/dist/src/type-extensions";

import { parseUnits, ZeroAddress } from "ethers";
import type { HardhatRuntimeEnvironment } from "hardhat/types";

import { ONE_HUNDRED_PERCENT_BPS, ONE_PERCENT_BPS } from "../../typescript/common/bps_constants";
import { DETH_TOKEN_ID, DUSD_TOKEN_ID, INCENTIVES_PROXY_ID, SDUSD_DSTAKE_TOKEN_ID } from "../../typescript/deploy-ids";
import { ORACLE_AGGREGATOR_BASE_CURRENCY_UNIT, ORACLE_AGGREGATOR_PRICE_DECIMALS } from "../../typescript/oracle_aggregator/constants";
import {
  rateStrategyBorrowDStable,
  rateStrategyHighLiquidityStable,
  rateStrategyHighLiquidityVolatile,
  rateStrategyMediumLiquidityStable,
  rateStrategyMediumLiquidityVolatile,
} from "../dlend/interest-rate-strategies";
import { strategyDETH, strategyDUSD, strategySFRXUSD, strategySTETH, strategyWETH } from "../dlend/reserves-params";
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
  const wstETHDeployment = await _hre.deployments.getOrNull("wstETH");

  // Fetch deployed dLend StaticATokenLM wrappers
  const dLendATokenWrapperDUSDDeployment = await _hre.deployments.getOrNull("dLend_ATokenWrapper_dUSD");
  const dLendATokenWrapperDSDeployment = await _hre.deployments.getOrNull("dLend_ATokenWrapper_dETH");

  const idleVaultSdUSDDeployment = await _hre.deployments.getOrNull("DStakeIdleVault_sdUSD");
  const idleVaultSdETHDeployment = await _hre.deployments.getOrNull("DStakeIdleVault_sdETH");

  // Fetch deployed dLend RewardsController
  const rewardsControllerDeployment = await _hre.deployments.getOrNull(INCENTIVES_PROXY_ID);

  // Fetch deployed dLend aTokens
  const aTokenDUSDDeployment = await _hre.deployments.getOrNull("dUSDAToken");
  const aTokenDETHDeployment = await _hre.deployments.getOrNull("dETHAToken");

  // Fetch deployed dSTAKE tokens for vesting
  const sdUSDDeployment = await _hre.deployments.getOrNull(SDUSD_DSTAKE_TOKEN_ID);

  // Get mock oracle deployments
  const mockOracleNameToAddress: Record<string, string> = {};

  // Get mock oracle addresses
  const mockOracleAddressesDeployment = await _hre.deployments.getOrNull("MockOracleNameToAddress");

  // Mock oracles won't exist initially, so we need to check if they do
  if (mockOracleAddressesDeployment?.linkedData) {
    Object.assign(mockOracleNameToAddress, mockOracleAddressesDeployment.linkedData);
  }

  // Get the named accounts
  const { deployer, user1 } = await _hre.getNamedAccounts();

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
          name: "AUSD",
          address: AUSDDeployment?.address,
          decimals: 18,
          initialSupply: 1e6,
        },
        yUSD: {
          name: "YieldFi yUSD",
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
        wstETH: {
          name: "Wrapped stETH",
          address: wstETHDeployment?.address,
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
      wstETH: emptyStringIfUndefined(wstETHDeployment?.address),
      frxUSD: emptyStringIfUndefined(frxUSDDeployment?.address),
      sfrxUSD: emptyStringIfUndefined(sfrxUSDDeployment?.address),
      USDC: emptyStringIfUndefined(USDCDeployment?.address),
      USDT: emptyStringIfUndefined(USDTDeployment?.address),
      AUSD: emptyStringIfUndefined(AUSDDeployment?.address),
      yUSD: emptyStringIfUndefined(yUSDDeployment?.address),
    },
    walletAddresses: {
      governanceMultisig: user1,
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
        chainlinkErc4626OracleAssets: {},
        api3OracleAssets: {
          plainApi3OracleWrappers: {},
          api3OracleWrappersWithThresholding: {},
          compositeApi3OracleWrappersWithThresholding: {},
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
            ...(frxUSDDeployment?.address && mockOracleNameToAddress["frxUSD_USD"]
              ? {
                  [frxUSDDeployment.address]: {
                    feed: mockOracleNameToAddress["frxUSD_USD"],
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
            ...(wstETHDeployment?.address &&
            mockOracleNameToAddress["wstETH_stETH"] &&
            mockOracleNameToAddress["WETH_USD"]
              ? {
                  [wstETHDeployment.address]: {
                    feedAsset: wstETHDeployment.address,
                    feed1: mockOracleNameToAddress["wstETH_stETH"],
                    feed2: mockOracleNameToAddress["WETH_USD"],
                    lowerThresholdInBase1: 0n,
                    fixedPriceInBase1: 0n,
                    lowerThresholdInBase2: 0n,
                    fixedPriceInBase2: 0n,
                  },
                }
              : {}),
            ...(sfrxUSDDeployment?.address && mockOracleNameToAddress["sfrxUSD_frxUSD"] && mockOracleNameToAddress["frxUSD_USD"]
              ? {
                  [sfrxUSDDeployment.address]: {
                    feedAsset: sfrxUSDDeployment.address,
                    feed1: mockOracleNameToAddress["sfrxUSD_frxUSD"],
                    feed2: mockOracleNameToAddress["frxUSD_USD"],
                    lowerThresholdInBase1: 0n,
                    fixedPriceInBase1: 0n,
                    lowerThresholdInBase2: ORACLE_AGGREGATOR_BASE_CURRENCY_UNIT,
                    fixedPriceInBase2: ORACLE_AGGREGATOR_BASE_CURRENCY_UNIT,
                  },
                }
              : {}),
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
        chainlinkErc4626OracleAssets: {},
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
    dLend: {
      providerID: 1,
      flashLoanPremium: {
        total: 0.0005e4,
        protocol: 0.0004e4,
      },
      rateStrategies: [
        rateStrategyBorrowDStable,
        rateStrategyHighLiquidityVolatile,
        rateStrategyMediumLiquidityVolatile,
        rateStrategyHighLiquidityStable,
        rateStrategyMediumLiquidityStable,
      ],
      reservesConfig: {
        dUSD: strategyDUSD,
        dETH: strategyDETH,
        stETH: strategySTETH,
        WETH: strategyWETH,
        sfrxUSD: strategySFRXUSD,
      },
    },
    // NOTE: dStake roles (admin, fee manager, collateral exchangers) are initialized to the deployer
    // during deployment and must be migrated to governance via separate transactions after deployment.
    dStake: {
      sdUSD: {
        dStable: emptyStringIfUndefined(dUSDDeployment?.address),
        name: "Staked dUSD",
        symbol: "sdUSD",
        initialWithdrawalFeeBps: 10,
        adapters: [
          {
            strategyShare: emptyStringIfUndefined(dLendATokenWrapperDUSDDeployment?.address),
            adapterContract: "WrappedDLendConversionAdapter",
            vaultAsset: emptyStringIfUndefined(dLendATokenWrapperDUSDDeployment?.address),
            targetBps: ONE_HUNDRED_PERCENT_BPS,
          },
          {
            strategyShare: emptyStringIfUndefined(idleVaultSdUSDDeployment?.address),
            adapterContract: "GenericERC4626ConversionAdapter",
            vaultAsset: emptyStringIfUndefined(idleVaultSdUSDDeployment?.address),
            targetBps: 0,
          },
        ],
        defaultDepositStrategyShare: emptyStringIfUndefined(idleVaultSdUSDDeployment?.address || dLendATokenWrapperDUSDDeployment?.address),
        defaultDepositVaultAsset: emptyStringIfUndefined(dLendATokenWrapperDUSDDeployment?.address),
        collateralVault: "DStakeCollateralVaultV2_sdUSD",
        idleVault: {
          rewardManager: deployer,
        },
        dLendRewardManager: {
          managedStrategyShare: emptyStringIfUndefined(dLendATokenWrapperDUSDDeployment?.address), // This should be the deployed StaticATokenLM address for dUSD
          dLendAssetToClaimFor: emptyStringIfUndefined(aTokenDUSDDeployment?.address), // Use the deployed dLEND-dUSD aToken address
          dLendRewardsController: emptyStringIfUndefined(rewardsControllerDeployment?.address), // This will be fetched after dLend incentives deployment
          treasury: user1, // Or a dedicated treasury address
          maxTreasuryFeeBps: 500, // Example: 5%
          initialTreasuryFeeBps: 100, // Example: 1%
          initialExchangeThreshold: 1_000_000n, // Example: 1 dStable (adjust based on dStable decimals)
          initialAdmin: user1, // Optional: specific admin for this reward manager
          initialRewardsManager: user1, // Optional: specific rewards manager role holder
        },
      },
      sdETH: {
        dStable: emptyStringIfUndefined(dETHDeployment?.address),
        name: "Staked dETH",
        symbol: "sdETH",
        initialWithdrawalFeeBps: 10,
        adapters: [
          {
            strategyShare: emptyStringIfUndefined(dLendATokenWrapperDSDeployment?.address),
            adapterContract: "WrappedDLendConversionAdapter",
            vaultAsset: emptyStringIfUndefined(dLendATokenWrapperDSDeployment?.address),
            targetBps: ONE_HUNDRED_PERCENT_BPS,
          },
          {
            strategyShare: emptyStringIfUndefined(idleVaultSdETHDeployment?.address),
            adapterContract: "GenericERC4626ConversionAdapter",
            vaultAsset: emptyStringIfUndefined(idleVaultSdETHDeployment?.address),
            targetBps: 0,
          },
        ],
        defaultDepositStrategyShare: emptyStringIfUndefined(idleVaultSdETHDeployment?.address || dLendATokenWrapperDSDeployment?.address),
        defaultDepositVaultAsset: emptyStringIfUndefined(dLendATokenWrapperDSDeployment?.address),
        collateralVault: "DStakeCollateralVaultV2_sdETH",
        idleVault: {
          rewardManager: deployer,
        },
        dLendRewardManager: {
          managedStrategyShare: emptyStringIfUndefined(dLendATokenWrapperDSDeployment?.address), // This should be the deployed StaticATokenLM address for dETH
          dLendAssetToClaimFor: emptyStringIfUndefined(aTokenDETHDeployment?.address), // Use the deployed dLEND-dETH aToken address
          dLendRewardsController: emptyStringIfUndefined(rewardsControllerDeployment?.address), // This will be fetched after dLend incentives deployment
          treasury: user1, // Or a dedicated treasury address
          maxTreasuryFeeBps: 5 * ONE_PERCENT_BPS, // Example: 5%
          initialTreasuryFeeBps: 1 * ONE_PERCENT_BPS, // Example: 1%
          initialExchangeThreshold: 1n * 10n ** 18n, // 1 dStable (scaled down to fit local supply caps)
          initialAdmin: user1, // Optional: specific admin for this reward manager
          initialRewardsManager: user1, // Optional: specific rewards manager role holder
        },
      },
    },
    vesting: {
      name: "dBOOST sdUSD Season 1",
      symbol: "sdUSD-S1",
      dstakeToken: emptyStringIfUndefined(sdUSDDeployment?.address), // Use sdUSD as the vesting token
      vestingPeriod: 180 * 24 * 60 * 60, // 6 months in seconds
      maxTotalSupply: parseUnits("1000000", 18).toString(), // 1 million tokens
      initialOwner: user1,
      minDepositThreshold: parseUnits("100000", 18).toString(), // 100,000 tokens
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
