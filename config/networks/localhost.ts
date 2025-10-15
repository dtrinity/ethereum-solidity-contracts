import { ZeroAddress } from "ethers";
import { HardhatRuntimeEnvironment } from "hardhat/types";

import { ONE_PERCENT_BPS } from "../../typescript/common/bps_constants";
import {
  DETH_TOKEN_ID,
  DUSD_TOKEN_ID,
  ETH_API3_WRAPPER_V1_1_ID,
  ETH_CHAINLINK_FEED_WRAPPER_V1_1_ID,
  ETH_CHAINLINK_RATE_COMPOSITE_WRAPPER_V1_1_ID,
  ETH_HARD_PEG_WRAPPER_V1_1_ID,
  INCENTIVES_PROXY_ID,
  SDUSD_DSTAKE_TOKEN_ID,
  USD_API3_WRAPPER_V1_1_ID,
  USD_CHAINLINK_FEED_WRAPPER_V1_1_ID,
  USD_CHAINLINK_RATE_COMPOSITE_WRAPPER_V1_1_ID,
  USD_HARD_PEG_WRAPPER_V1_1_ID,
} from "../../typescript/deploy-ids";
import { ORACLE_AGGREGATOR_BASE_CURRENCY_UNIT, ORACLE_AGGREGATOR_PRICE_DECIMALS } from "../../typescript/oracle_aggregator/constants";
import {
  rateStrategyHighLiquidityStable,
  rateStrategyHighLiquidityVolatile,
  rateStrategyMediumLiquidityStable,
  rateStrategyMediumLiquidityVolatile,
} from "../dlend/interest-rate-strategies";
import { strategyDETH, strategyDUSD, strategySFRXUSD, strategySTETH, strategyWETH } from "../dlend/reserves-params";
import { ChainlinkFeedAssetConfig, Config, HardPegAssetConfig, OracleAssetRoutingConfig } from "../types";

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
  const USDSDeployment = await _hre.deployments.getOrNull("USDS");
  const sUSDSDeployment = await _hre.deployments.getOrNull("sUSDS");
  const frxUSDDeployment = await _hre.deployments.getOrNull("frxUSD");
  const sfrxUSDDeployment = await _hre.deployments.getOrNull("sfrxUSD");
  const WETHDeployment = await _hre.deployments.getOrNull("WETH");
  const stETHDeployment = await _hre.deployments.getOrNull("stETH");

  // Fetch deployed dLend StaticATokenLM wrappers
  const dLendATokenWrapperDUSDDeployment = await _hre.deployments.getOrNull("dLend_ATokenWrapper_dUSD");
  const dLendATokenWrapperDSDeployment = await _hre.deployments.getOrNull("dLend_ATokenWrapper_dETH");

  // Fetch deployed dLend RewardsController
  const rewardsControllerDeployment = await _hre.deployments.getOrNull(INCENTIVES_PROXY_ID);

  // Fetch deployed dLend aTokens
  const aTokenDUSDDeployment = await _hre.deployments.getOrNull("dLEND-dUSD");

  // Fetch deployed dSTAKE tokens for vesting
  const sdUSDDeployment = await _hre.deployments.getOrNull(SDUSD_DSTAKE_TOKEN_ID);

  // Get the named accounts
  const { deployer, user1 } = await _hre.getNamedAccounts();

  const defaultHeartbeat = 60;
  const defaultMaxStale = 600;
  const usdDefaultDeviationBps = 500;
  const ethDefaultDeviationBps = 300;

  const chainlinkUsdAssets: Record<string, ChainlinkFeedAssetConfig> = {};

  if (WETHDeployment?.address) {
    chainlinkUsdAssets[WETHDeployment.address] = {
      feed: "mock:chainlink:WETH_USD",
      heartbeat: defaultHeartbeat,
      maxStaleTime: defaultMaxStale,
      maxDeviationBps: 1_000,
      mock: {
        id: "WETH_USD",
        decimals: 8,
        value: "2500",
        description: "WETH / USD",
      },
    };
  }

  if (dETHDeployment?.address) {
    chainlinkUsdAssets[dETHDeployment.address] = {
      feed: "mock:chainlink:dETH_USD",
      heartbeat: defaultHeartbeat,
      maxStaleTime: defaultMaxStale,
      maxDeviationBps: 1_000,
      mock: {
        id: "dETH_USD",
        decimals: 8,
        value: "2500",
        description: "dETH / USD",
      },
    };
  }

  if (USDCDeployment?.address) {
    chainlinkUsdAssets[USDCDeployment.address] = {
      feed: "mock:chainlink:USDC_USD",
      heartbeat: defaultHeartbeat,
      maxStaleTime: defaultMaxStale,
      maxDeviationBps: usdDefaultDeviationBps,
      mock: {
        id: "USDC_USD",
        decimals: 8,
        value: "1",
        description: "USDC / USD",
      },
    };
  }

  if (USDSDeployment?.address) {
    chainlinkUsdAssets[USDSDeployment.address] = {
      feed: "mock:chainlink:USDS_USD",
      heartbeat: defaultHeartbeat,
      maxStaleTime: defaultMaxStale,
      maxDeviationBps: usdDefaultDeviationBps,
      mock: {
        id: "USDS_USD",
        decimals: 8,
        value: "1",
        description: "USDS / USD",
      },
    };
  }

  if (sUSDSDeployment?.address) {
    chainlinkUsdAssets[sUSDSDeployment.address] = {
      feed: "mock:chainlink:sUSDS_USD",
      heartbeat: defaultHeartbeat,
      maxStaleTime: defaultMaxStale,
      maxDeviationBps: usdDefaultDeviationBps,
      mock: {
        id: "sUSDS_USD",
        decimals: 8,
        value: "1.1",
        description: "sUSDS / USD",
      },
    };
  }

  if (frxUSDDeployment?.address) {
    chainlinkUsdAssets[frxUSDDeployment.address] = {
      feed: "mock:chainlink:frxUSD_USD",
      heartbeat: defaultHeartbeat,
      maxStaleTime: defaultMaxStale,
      maxDeviationBps: usdDefaultDeviationBps,
      mock: {
        id: "frxUSD_USD",
        decimals: 8,
        value: "1",
        description: "frxUSD / USD",
      },
    };
  }

  if (sfrxUSDDeployment?.address) {
    chainlinkUsdAssets[sfrxUSDDeployment.address] = {
      feed: "mock:chainlink:sfrxUSD_USD",
      heartbeat: defaultHeartbeat,
      maxStaleTime: defaultMaxStale,
      maxDeviationBps: usdDefaultDeviationBps,
      mock: {
        id: "sfrxUSD_USD",
        decimals: 8,
        value: "1.1",
        description: "sfrxUSD / USD",
      },
    };
  }

  if (stETHDeployment?.address) {
    chainlinkUsdAssets[stETHDeployment.address] = {
      feed: "mock:chainlink:stETH_USD",
      heartbeat: defaultHeartbeat,
      maxStaleTime: defaultMaxStale,
      maxDeviationBps: 1_000,
      mock: {
        id: "stETH_USD",
        decimals: 8,
        value: "2600",
        description: "stETH / USD",
      },
    };
  }

  const hardPegUsdAssets: Record<string, HardPegAssetConfig> = {};
  hardPegUsdAssets[ZeroAddress] = {
    pricePeg: ORACLE_AGGREGATOR_BASE_CURRENCY_UNIT,
    lowerGuard: ORACLE_AGGREGATOR_BASE_CURRENCY_UNIT,
    upperGuard: ORACLE_AGGREGATOR_BASE_CURRENCY_UNIT,
  };

  if (dUSDDeployment?.address) {
    hardPegUsdAssets[dUSDDeployment.address] = {
      pricePeg: ORACLE_AGGREGATOR_BASE_CURRENCY_UNIT,
      lowerGuard: (ORACLE_AGGREGATOR_BASE_CURRENCY_UNIT * 99n) / 100n,
      upperGuard: (ORACLE_AGGREGATOR_BASE_CURRENCY_UNIT * 101n) / 100n,
    };
  }

  const usdAggregatorAssets: Record<string, OracleAssetRoutingConfig> = {};
  usdAggregatorAssets[ZeroAddress] = {
    primaryWrapperId: USD_HARD_PEG_WRAPPER_V1_1_ID,
    risk: {
      maxDeviationBps: 0,
    },
  };

  if (dUSDDeployment?.address) {
    usdAggregatorAssets[dUSDDeployment.address] = {
      primaryWrapperId: USD_HARD_PEG_WRAPPER_V1_1_ID,
      risk: {
        maxDeviationBps: 100,
      },
    };
  }

  if (USDCDeployment?.address) {
    usdAggregatorAssets[USDCDeployment.address] = {
      primaryWrapperId: USD_CHAINLINK_FEED_WRAPPER_V1_1_ID,
      risk: {
        maxStaleTime: defaultMaxStale,
        maxDeviationBps: usdDefaultDeviationBps,
      },
    };
  }

  if (USDSDeployment?.address) {
    usdAggregatorAssets[USDSDeployment.address] = {
      primaryWrapperId: USD_CHAINLINK_FEED_WRAPPER_V1_1_ID,
      risk: {
        maxStaleTime: defaultMaxStale,
        maxDeviationBps: usdDefaultDeviationBps,
      },
    };
  }

  if (sUSDSDeployment?.address) {
    usdAggregatorAssets[sUSDSDeployment.address] = {
      primaryWrapperId: USD_CHAINLINK_FEED_WRAPPER_V1_1_ID,
      risk: {
        maxStaleTime: defaultMaxStale,
        maxDeviationBps: usdDefaultDeviationBps,
      },
    };
  }

  if (frxUSDDeployment?.address) {
    usdAggregatorAssets[frxUSDDeployment.address] = {
      primaryWrapperId: USD_CHAINLINK_FEED_WRAPPER_V1_1_ID,
      risk: {
        maxStaleTime: defaultMaxStale,
        maxDeviationBps: usdDefaultDeviationBps,
      },
    };
  }

  if (sfrxUSDDeployment?.address) {
    usdAggregatorAssets[sfrxUSDDeployment.address] = {
      primaryWrapperId: USD_CHAINLINK_FEED_WRAPPER_V1_1_ID,
      risk: {
        maxStaleTime: defaultMaxStale,
        maxDeviationBps: usdDefaultDeviationBps,
      },
    };
  }

  if (WETHDeployment?.address) {
    usdAggregatorAssets[WETHDeployment.address] = {
      primaryWrapperId: USD_CHAINLINK_FEED_WRAPPER_V1_1_ID,
      risk: {
        maxStaleTime: defaultMaxStale,
        maxDeviationBps: 1_000,
      },
    };
  }

  if (dETHDeployment?.address) {
    usdAggregatorAssets[dETHDeployment.address] = {
      primaryWrapperId: USD_CHAINLINK_FEED_WRAPPER_V1_1_ID,
      risk: {
        maxStaleTime: defaultMaxStale,
        maxDeviationBps: 1_000,
      },
    };
  }

  if (stETHDeployment?.address) {
    usdAggregatorAssets[stETHDeployment.address] = {
      primaryWrapperId: USD_CHAINLINK_FEED_WRAPPER_V1_1_ID,
      risk: {
        maxStaleTime: defaultMaxStale,
        maxDeviationBps: 1_000,
      },
    };
  }

  const chainlinkEthAssets: Record<string, ChainlinkFeedAssetConfig> = {};

  if (stETHDeployment?.address) {
    chainlinkEthAssets[stETHDeployment.address] = {
      feed: "mock:chainlink:stETH_WETH",
      heartbeat: defaultHeartbeat,
      maxStaleTime: defaultMaxStale,
      maxDeviationBps: ethDefaultDeviationBps,
      mock: {
        id: "stETH_WETH",
        decimals: 18,
        value: "1.1",
        description: "stETH / WETH",
      },
    };
  }

  const hardPegEthAssets: Record<string, HardPegAssetConfig> = {};

  if (WETHDeployment?.address) {
    hardPegEthAssets[WETHDeployment.address] = {
      pricePeg: ORACLE_AGGREGATOR_BASE_CURRENCY_UNIT,
      lowerGuard: (ORACLE_AGGREGATOR_BASE_CURRENCY_UNIT * 99n) / 100n,
      upperGuard: (ORACLE_AGGREGATOR_BASE_CURRENCY_UNIT * 101n) / 100n,
    };
  }

  if (dETHDeployment?.address) {
    hardPegEthAssets[dETHDeployment.address] = {
      pricePeg: ORACLE_AGGREGATOR_BASE_CURRENCY_UNIT,
      lowerGuard: (ORACLE_AGGREGATOR_BASE_CURRENCY_UNIT * 99n) / 100n,
      upperGuard: (ORACLE_AGGREGATOR_BASE_CURRENCY_UNIT * 101n) / 100n,
    };
  }

  const ethAggregatorAssets: Record<string, OracleAssetRoutingConfig> = {};

  if (WETHDeployment?.address) {
    ethAggregatorAssets[WETHDeployment.address] = {
      primaryWrapperId: ETH_HARD_PEG_WRAPPER_V1_1_ID,
      risk: {
        maxDeviationBps: 100,
      },
    };
  }

  if (dETHDeployment?.address) {
    ethAggregatorAssets[dETHDeployment.address] = {
      primaryWrapperId: ETH_HARD_PEG_WRAPPER_V1_1_ID,
      risk: {
        maxDeviationBps: 100,
      },
    };
  }

  if (stETHDeployment?.address) {
    ethAggregatorAssets[stETHDeployment.address] = {
      primaryWrapperId: ETH_CHAINLINK_FEED_WRAPPER_V1_1_ID,
      risk: {
        maxStaleTime: defaultMaxStale,
        maxDeviationBps: ethDefaultDeviationBps,
      },
    };
  }

  return {
    MOCK_ONLY: {
      tokens: {
        USDC: {
          name: "USD Coin",
          address: USDCDeployment?.address,
          decimals: 6,
          initialSupply: 1e6,
        },
        USDS: {
          name: "USDS Stablecoin",
          address: USDSDeployment?.address,
          decimals: 18,
          initialSupply: 1e6,
        },
        sUSDS: {
          name: "Savings USDS",
          address: sUSDSDeployment?.address,
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
      USDS: emptyStringIfUndefined(USDSDeployment?.address),
    },
    walletAddresses: {
      governanceMultisig: deployer,
      incentivesVault: deployer,
    },
    dStables: {
      dUSD: {
        collaterals: [
          USDCDeployment?.address || ZeroAddress,
          USDSDeployment?.address || ZeroAddress,
          sUSDSDeployment?.address || ZeroAddress,
          frxUSDDeployment?.address || ZeroAddress,
          sfrxUSDDeployment?.address || ZeroAddress,
        ],
        initialFeeReceiver: deployer,
        initialRedemptionFeeBps: 0.4 * ONE_PERCENT_BPS, // Default for stablecoins
        collateralRedemptionFees: {
          // Stablecoins: 0.4%
          [USDCDeployment?.address || ZeroAddress]: 0.4 * ONE_PERCENT_BPS,
          [USDSDeployment?.address || ZeroAddress]: 0.4 * ONE_PERCENT_BPS,
          [frxUSDDeployment?.address || ZeroAddress]: 0.4 * ONE_PERCENT_BPS,
          // Yield bearing stablecoins: 0.5%
          [sUSDSDeployment?.address || ZeroAddress]: 0.5 * ONE_PERCENT_BPS,
          [sfrxUSDDeployment?.address || ZeroAddress]: 0.5 * ONE_PERCENT_BPS,
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
        roles: {
          admins: [deployer],
          oracleManagers: [deployer],
          guardians: [user1],
          globalMaxStaleTime: 3600,
        },
        wrappers: {
          chainlink: {
            deploymentId: USD_CHAINLINK_FEED_WRAPPER_V1_1_ID,
            initialAdmin: deployer,
            assets: chainlinkUsdAssets,
          },
          api3: {
            deploymentId: USD_API3_WRAPPER_V1_1_ID,
            initialAdmin: deployer,
            assets: {},
          },
          rateComposite: {
            deploymentId: USD_CHAINLINK_RATE_COMPOSITE_WRAPPER_V1_1_ID,
            initialAdmin: deployer,
            assets: {},
          },
          hardPeg: {
            deploymentId: USD_HARD_PEG_WRAPPER_V1_1_ID,
            initialAdmin: deployer,
            assets: hardPegUsdAssets,
          },
        },
        assets: usdAggregatorAssets,
      },
      ETH: {
        hardDStablePeg: 1n * ORACLE_AGGREGATOR_BASE_CURRENCY_UNIT,
        priceDecimals: ORACLE_AGGREGATOR_PRICE_DECIMALS,
        baseCurrency: WETHDeployment?.address || ZeroAddress,
        roles: {
          admins: [deployer],
          oracleManagers: [deployer],
          guardians: [user1],
          globalMaxStaleTime: 3600,
        },
        wrappers: {
          chainlink: {
            deploymentId: ETH_CHAINLINK_FEED_WRAPPER_V1_1_ID,
            initialAdmin: deployer,
            assets: chainlinkEthAssets,
          },
          api3: {
            deploymentId: ETH_API3_WRAPPER_V1_1_ID,
            initialAdmin: deployer,
            assets: {},
          },
          rateComposite: {
            deploymentId: ETH_CHAINLINK_RATE_COMPOSITE_WRAPPER_V1_1_ID,
            initialAdmin: deployer,
            assets: {},
          },
          hardPeg: {
            deploymentId: ETH_HARD_PEG_WRAPPER_V1_1_ID,
            initialAdmin: deployer,
            assets: hardPegEthAssets,
          },
        },
        assets: ethAggregatorAssets,
      },
    },
    dLend: {
      providerID: 1, // Arbitrary as long as we don't repeat
      flashLoanPremium: {
        total: 0.0005e4, // 0.05%
        protocol: 0.0004e4, // 0.04%
      },
      rateStrategies: [
        rateStrategyHighLiquidityVolatile,
        rateStrategyMediumLiquidityVolatile,
        rateStrategyHighLiquidityStable,
        rateStrategyMediumLiquidityStable,
      ],
      reservesConfig: {
        dUSD: strategyDUSD,
        dETH: strategyDETH,
        WETH: strategyWETH,
        stETH: strategySTETH,
        sfrxUSD: strategySFRXUSD,
      },
    },
    odos: {
      router: "", // Odos doesn't work on localhost
    },
    dStake: {
      sdUSD: {
        dStable: emptyStringIfUndefined(dUSDDeployment?.address),
        name: "Staked dUSD",
        symbol: "sdUSD",
        initialAdmin: user1,
        initialFeeManager: user1,
        initialWithdrawalFeeBps: 10,
        adapters: [
          {
            vaultAsset: emptyStringIfUndefined(dLendATokenWrapperDUSDDeployment?.address),
            adapterContract: "WrappedDLendConversionAdapter",
          },
        ],
        defaultDepositVaultAsset: emptyStringIfUndefined(dLendATokenWrapperDUSDDeployment?.address),
        collateralVault: "DStakeCollateralVault_sdUSD",
        collateralExchangers: [user1],
        dLendRewardManager: {
          managedVaultAsset: emptyStringIfUndefined(dLendATokenWrapperDUSDDeployment?.address), // This should be the deployed StaticATokenLM address for dUSD
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
        initialAdmin: user1,
        initialFeeManager: user1,
        initialWithdrawalFeeBps: 10,
        adapters: [
          {
            vaultAsset: emptyStringIfUndefined(dLendATokenWrapperDSDeployment?.address),
            adapterContract: "WrappedDLendConversionAdapter",
          },
        ],
        defaultDepositVaultAsset: emptyStringIfUndefined(dLendATokenWrapperDSDeployment?.address),
        collateralVault: "DStakeCollateralVault_sdETH",
        collateralExchangers: [user1],
        dLendRewardManager: {
          managedVaultAsset: emptyStringIfUndefined(dLendATokenWrapperDSDeployment?.address), // This should be the deployed StaticATokenLM address for dETH
          dLendAssetToClaimFor: emptyStringIfUndefined(dETHDeployment?.address), // Use the dETH underlying asset address as a placeholder
          dLendRewardsController: emptyStringIfUndefined(rewardsControllerDeployment?.address), // This will be fetched after dLend incentives deployment
          treasury: user1, // Or a dedicated treasury address
          maxTreasuryFeeBps: 5 * ONE_PERCENT_BPS, // Example: 5%
          initialTreasuryFeeBps: 1 * ONE_PERCENT_BPS, // Example: 1%
          initialExchangeThreshold: 100n * 10n ** 18n, // 100 dStable (reduced to stay within 500 supply cap)
          initialAdmin: user1, // Optional: specific admin for this reward manager
          initialRewardsManager: user1, // Optional: specific rewards manager role holder
        },
      },
    },
    dLoop: {
      dUSDAddress: dUSDDeployment?.address || "",
      coreVaults: {
        "3x_sFRAX_dUSD": {
          venue: "dlend",
          name: "dLOOP 3X sfrxUSD dLEND",
          symbol: "3X-sfrxUSD",
          underlyingAsset: sfrxUSDDeployment?.address || "",
          dStable: dUSDDeployment?.address || "",
          targetLeverageBps: 300 * ONE_PERCENT_BPS, // 300% leverage, meaning 3x leverage
          lowerBoundTargetLeverageBps: 200 * ONE_PERCENT_BPS, // 200% leverage, meaning 2x leverage
          upperBoundTargetLeverageBps: 400 * ONE_PERCENT_BPS, // 400% leverage, meaning 4x leverage
          maxSubsidyBps: 2 * ONE_PERCENT_BPS, // 2% subsidy
          minDeviationBps: 2 * ONE_PERCENT_BPS, // 2% deviation
          withdrawalFeeBps: 0.4 * ONE_PERCENT_BPS, // 0.4% withdrawal fee
          extraParams: {
            targetStaticATokenWrapper: dLendATokenWrapperDUSDDeployment?.address,
            treasury: user1,
            maxTreasuryFeeBps: 1000,
            initialTreasuryFeeBps: 500,
            initialExchangeThreshold: 100n,
          },
        },
        "3x_stETH_dETH": {
          venue: "dlend",
          name: "dLOOP 3X stETH dLEND",
          symbol: "3X-stETH",
          underlyingAsset: stETHDeployment?.address || "",
          dStable: dETHDeployment?.address || "",
          targetLeverageBps: 300 * ONE_PERCENT_BPS, // 300% leverage, meaning 3x leverage
          lowerBoundTargetLeverageBps: 200 * ONE_PERCENT_BPS, // 200% leverage, meaning 2x leverage
          upperBoundTargetLeverageBps: 400 * ONE_PERCENT_BPS, // 400% leverage, meaning 4x leverage
          maxSubsidyBps: 2 * ONE_PERCENT_BPS, // 2% subsidy
          minDeviationBps: 2 * ONE_PERCENT_BPS, // 2% deviation
          withdrawalFeeBps: 0.4 * ONE_PERCENT_BPS, // 0.4% withdrawal fee
          extraParams: {
            targetStaticATokenWrapper: dLendATokenWrapperDSDeployment?.address,
            treasury: user1,
            maxTreasuryFeeBps: 1000,
            initialTreasuryFeeBps: 500,
            initialExchangeThreshold: 100n,
          },
        },
      },
      depositors: {
        odos: {
          router: "", // Odos doesn't work on localhost
        },
      },
      redeemers: {
        odos: {
          router: "", // Odos doesn't work on localhost
        },
      },
      decreaseLeverage: {
        odos: {
          router: "", // Odos doesn't work on localhost
        },
      },
      increaseLeverage: {
        odos: {
          router: "", // Odos doesn't work on localhost
        },
      },
    },
    vesting: {
      name: "dBOOST sdUSD Season 1",
      symbol: "sdUSD-S1",
      dstakeToken: emptyStringIfUndefined(sdUSDDeployment?.address), // Use sdUSD as the vesting token
      vestingPeriod: 180 * 24 * 60 * 60, // 6 months in seconds
      maxTotalSupply: _hre.ethers.parseUnits("1000000", 18).toString(), // 1 million tokens
      initialOwner: user1,
      minDepositThreshold: _hre.ethers.parseUnits("100000", 18).toString(), // 100,000 tokens
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
