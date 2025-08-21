import { ZeroAddress } from "ethers";
import { HardhatRuntimeEnvironment } from "hardhat/types";

import { ONE_PERCENT_BPS } from "../../typescript/common/bps_constants";
import {
  DETH_TOKEN_ID,
  DUSD_TOKEN_ID,
  INCENTIVES_PROXY_ID,
} from "../../typescript/deploy-ids";
import {
  ORACLE_AGGREGATOR_BASE_CURRENCY_UNIT,
  ORACLE_AGGREGATOR_PRICE_DECIMALS,
} from "../../typescript/oracle_aggregator/constants";
import { fetchTokenInfo } from "../../typescript/token/utils";
import {
  rateStrategyHighLiquidityStable,
  rateStrategyHighLiquidityVolatile,
  rateStrategyMediumLiquidityStable,
  rateStrategyMediumLiquidityVolatile,
} from "../dlend/interest-rate-strategies";
import {
  strategyDS,
  strategyDUSD,
  strategyPTaUSDC,
  strategyPTwstkscUSD,
  strategyscETH,
  strategySfrxUSD,
  strategyStS,
  strategyWETH,
  strategywOS,
  strategywstkscETH,
  strategyWstkscUSD,
  // strategyWstkscUSD,
} from "../dlend/reserves-params";
import { Config } from "../types";

/**
 * Get the configuration for the network
 *
 * @param _hre - Hardhat Runtime Environment
 * @returns The configuration for the network
 */
export async function getConfig(
  _hre: HardhatRuntimeEnvironment,
): Promise<Config> {
  const dUSDDeployment = await _hre.deployments.getOrNull(DUSD_TOKEN_ID);
  const dETHDeployment = await _hre.deployments.getOrNull(DETH_TOKEN_ID);

  // IMPORTANT: All addresses below are placeholders (0x0000...)
  // These MUST be replaced with actual Ethereum mainnet addresses before deployment
  const wETHAddress = "0x0000000000000000000000000000000000000000"; // Wrapped Ethereum
  const stETHAddress = "0x0000000000000000000000000000000000000000"; // Lido Staked ETH
  const frxUSDAddress = "0x0000000000000000000000000000000000000000"; // Frax USD
  const sfrxUSDAddress = "0x0000000000000000000000000000000000000000"; // Staked Frax USD
  const wstkscUSDAddress = "0x0000000000000000000000000000000000000000"; // Placeholder - update for Ethereum equivalent
  const USDCAddress = "0x0000000000000000000000000000000000000000"; // USD Coin
  const scUSDAddress = "0x0000000000000000000000000000000000000000"; // Placeholder - update for Ethereum equivalent
  const scETHAddress = "0x0000000000000000000000000000000000000000"; // Placeholder - update for Ethereum equivalent
  const wstkscETHAddress = "0x0000000000000000000000000000000000000000"; // Placeholder - update for Ethereum equivalent
  const ptaUSDCAddress = "0x0000000000000000000000000000000000000000"; // Pendle PT aUSDC - update for Ethereum
  const ptwstkscUSDAddress = "0x0000000000000000000000000000000000000000"; // Placeholder - update for Ethereum equivalent
  const wOSAddress = "0x0000000000000000000000000000000000000000"; // Placeholder - update for Ethereum equivalent
  const osAddress = "0x0000000000000000000000000000000000000000"; // Placeholder - update for Ethereum equivalent

  const odoRouterV2Address = "0x0000000000000000000000000000000000000000"; // Odos Router V2 - update for Ethereum

  const governanceSafeMultisig = "0x0000000000000000000000000000000000000000"; // Placeholder - set governance multisig

  // Safe configuration for governance multisig
  const safeOwners = [
    "0x0000000000000000000000000000000000000000", // Placeholder - set actual owners
    "0x0000000000000000000000000000000000000000", // Placeholder - set actual owners
    "0x0000000000000000000000000000000000000000", // Placeholder - set actual owners
  ];
  const safeThreshold = 2; // 2 of 3 multisig

  // Fetch deployed dLend StaticATokenLM wrapper, aToken and RewardsController (may be undefined prior to deployment)
  const dLendATokenWrapperDUSDDeployment = await _hre.deployments.getOrNull(
    "dLend_ATokenWrapper_dUSD",
  );
  const rewardsControllerDeployment =
    await _hre.deployments.getOrNull(INCENTIVES_PROXY_ID);
  const aTokenDUSDDeployment = await _hre.deployments.getOrNull("dLEND-dUSD");

  // Fetch dUSD token decimals from the contract if deployed
  let dUSDDecimals = 0;

  if (dUSDDeployment?.address) {
    const dUSDTokenInfo = await fetchTokenInfo(_hre, dUSDDeployment.address);
    dUSDDecimals = dUSDTokenInfo.decimals;

    if (dUSDDecimals < 1) {
      throw Error("dUSD token decimals must be greater than 0");
    }
  }

  return {
    safeConfig: {
      safeAddress: governanceSafeMultisig,
      owners: safeOwners,
      threshold: safeThreshold,
      chainId: 1, // Ethereum mainnet chain ID
      rpcUrl: "https://eth-mainnet.g.alchemy.com/v2/YOUR_API_KEY", // Replace with actual RPC
      // Ethereum mainnet Safe Transaction Service
      txServiceUrl: "https://safe-transaction-mainnet.safe.global",
    },
    tokenAddresses: {
      dUSD: emptyStringIfUndefined(dUSDDeployment?.address),
      dETH: emptyStringIfUndefined(dETHDeployment?.address),
      wS: wETHAddress, // Using WETH as the base asset for Ethereum
      stS: stETHAddress, // Using stETH as the staked asset
      frxUSD: frxUSDAddress,
      sfrxUSD: sfrxUSDAddress,
      wstkscUSD: wstkscUSDAddress,
      USDCe: USDCAddress,
      scUSD: scUSDAddress,
      WETH: wETHAddress,
      scETH: scETHAddress,
      wstkscETH: wstkscETHAddress,
      PTaUSDC: ptaUSDCAddress,
      PTwstkscUSD: ptwstkscUSDAddress,
      wOS: wOSAddress,
      OS: osAddress,
    },
    walletAddresses: {
      governanceMultisig: governanceSafeMultisig,
      incentivesVault: "0x0000000000000000000000000000000000000000", // Placeholder - set incentives vault
    },
    pendle: {
      ptYtLpOracleAddress: "0x0000000000000000000000000000000000000000", // Placeholder - Pendle Oracle for Ethereum
      ptTokens: [
        {
          name: "PT-aUSDC-PLACEHOLDER", // Update with actual Ethereum PT token
          ptToken: "0x0000000000000000000000000000000000000000",
          market: "0x0000000000000000000000000000000000000000",
          oracleType: "PT_TO_ASSET",
          twapDuration: 900,
        },
        {
          name: "PT-PLACEHOLDER-2", // Update with actual Ethereum PT token
          ptToken: "0x0000000000000000000000000000000000000000",
          market: "0x0000000000000000000000000000000000000000",
          oracleType: "PT_TO_ASSET",
          twapDuration: 900,
        },
      ],
    },
    dStables: {
      dUSD: {
        collaterals: [
          frxUSDAddress,
          sfrxUSDAddress,
          // wstkscUSDAddress,
          USDCAddress,
          scUSDAddress,
        ],
        initialFeeReceiver: governanceSafeMultisig,
        initialRedemptionFeeBps: 0.4 * ONE_PERCENT_BPS, // Default for stablecoins
        collateralRedemptionFees: {
          // Stablecoins: 0.4%
          [frxUSDAddress]: 0.4 * ONE_PERCENT_BPS,
          [USDCAddress]: 0.4 * ONE_PERCENT_BPS,
          [scUSDAddress]: 0.4 * ONE_PERCENT_BPS,
          // Yield bearing stablecoins: 0.5%
          [sfrxUSDAddress]: 0.5 * ONE_PERCENT_BPS,
          [wstkscUSDAddress]: 0.5 * ONE_PERCENT_BPS,
        },
      },
      dETH: {
        collaterals: [wETHAddress, stETHAddress], // Updated for Ethereum
        initialFeeReceiver: governanceSafeMultisig,
        initialRedemptionFeeBps: 0.4 * ONE_PERCENT_BPS, // Default for stablecoins
        collateralRedemptionFees: {
          // Base assets: 0.4%
          [wETHAddress]: 0.4 * ONE_PERCENT_BPS,
          // Yield bearing assets: 0.5%
          [stETHAddress]: 0.5 * ONE_PERCENT_BPS,
        },
      },
    },
    dLoop: {
      dUSDAddress: dUSDDeployment?.address || "",
      coreVaults: {
        "3x_sfrxUSD_dUSD": {
          venue: "dlend",
          name: "dLOOP 3X sfrxUSD dLEND",
          symbol: "3X-sfrxUSD",
          underlyingAsset: sfrxUSDAddress,
          dStable: dUSDDeployment?.address || "",
          targetLeverageBps: 300 * ONE_PERCENT_BPS, // 300% leverage, meaning 3x leverage
          lowerBoundTargetLeverageBps: 200 * ONE_PERCENT_BPS, // 200% leverage, meaning 2x leverage
          upperBoundTargetLeverageBps: 400 * ONE_PERCENT_BPS, // 400% leverage, meaning 4x leverage
          maxSubsidyBps: 2 * ONE_PERCENT_BPS, // 2% subsidy
          minDeviationBps: 2 * ONE_PERCENT_BPS, // 2% deviation
          withdrawalFeeBps: 0.4 * ONE_PERCENT_BPS, // 0.4% withdrawal fee
          extraParams: {
            targetStaticATokenWrapper:
              dLendATokenWrapperDUSDDeployment?.address,
            treasury: governanceSafeMultisig,
            maxTreasuryFeeBps: "1000",
            initialTreasuryFeeBps: "500",
            initialExchangeThreshold: 1n * 10n ** BigInt(dUSDDecimals), // 1 dStable token
          },
        },
      },
      depositors: {
        odos: {
          router: odoRouterV2Address,
        },
      },
      redeemers: {
        odos: {
          router: odoRouterV2Address,
        },
      },
      decreaseLeverage: {
        odos: {
          router: odoRouterV2Address,
        },
      },
      increaseLeverage: {
        odos: {
          router: odoRouterV2Address,
        },
      },
    },
    oracleAggregators: {
      USD: {
        baseCurrency: ZeroAddress, // Note that USD is represented by the zero address, per Aave's convention
        hardDStablePeg: 10n ** BigInt(ORACLE_AGGREGATOR_PRICE_DECIMALS),
        priceDecimals: ORACLE_AGGREGATOR_PRICE_DECIMALS,
        redstoneOracleAssets: {
          plainRedstoneOracleWrappers: {},
          redstoneOracleWrappersWithThresholding: {
            // PLACEHOLDER: All oracle feed addresses must be updated for Ethereum
            [frxUSDAddress]: {
              feed: "0x0000000000000000000000000000000000000000", // frxUSD/USD Feed
              lowerThreshold: ORACLE_AGGREGATOR_BASE_CURRENCY_UNIT,
              fixedPrice: ORACLE_AGGREGATOR_BASE_CURRENCY_UNIT,
            },
            [USDCAddress]: {
              feed: "0x0000000000000000000000000000000000000000", // USDC/USD Feed
              lowerThreshold: ORACLE_AGGREGATOR_BASE_CURRENCY_UNIT,
              fixedPrice: ORACLE_AGGREGATOR_BASE_CURRENCY_UNIT,
            },
            [wETHAddress]: {
              feed: "0x0000000000000000000000000000000000000000", // WETH/USD Feed
              lowerThreshold: 0n, // No thresholding
              fixedPrice: 0n,
            },
            [scETHAddress]: {
              feed: "0x0000000000000000000000000000000000000000", // Placeholder - ETH equivalent
              lowerThreshold: 0n, // No thresholding
              fixedPrice: 0n,
            },
          },
          compositeRedstoneOracleWrappersWithThresholding: {
            // PLACEHOLDER: All composite oracle configurations need Ethereum addresses
            [sfrxUSDAddress]: {
              feedAsset: sfrxUSDAddress,
              feed1: "0x0000000000000000000000000000000000000000", // sfrxUSD/frxUSD Feed
              feed2: "0x0000000000000000000000000000000000000000", // frxUSD/USD Feed
              lowerThresholdInBase1: 0n,
              fixedPriceInBase1: 0n,
              lowerThresholdInBase2: ORACLE_AGGREGATOR_BASE_CURRENCY_UNIT,
              fixedPriceInBase2: ORACLE_AGGREGATOR_BASE_CURRENCY_UNIT,
            },
            [stETHAddress]: {
              feedAsset: stETHAddress,
              feed1: "0x0000000000000000000000000000000000000000", // stETH/ETH Feed
              feed2: "0x0000000000000000000000000000000000000000", // ETH/USD Feed
              lowerThresholdInBase1: 0n,
              fixedPriceInBase1: 0n,
              lowerThresholdInBase2: 0n,
              fixedPriceInBase2: 0n,
            },
          },
        },
        chainlinkCompositeAggregator: {
          // PLACEHOLDER: Update with Ethereum equivalent composite feeds
          [osAddress]: {
            name: "PLACEHOLDER_COMPOSITE",
            feedAsset: osAddress,
            sourceFeed1: "0x0000000000000000000000000000000000000000",
            sourceFeed2: "0x0000000000000000000000000000000000000000",
            lowerThresholdInBase1: 0n,
            fixedPriceInBase1: 0n,
            lowerThresholdInBase2: 0n,
            fixedPriceInBase2: 0n,
          },
        },
      },
      S: {
        hardDStablePeg: 10n ** BigInt(ORACLE_AGGREGATOR_PRICE_DECIMALS),
        priceDecimals: ORACLE_AGGREGATOR_PRICE_DECIMALS,
        baseCurrency: wETHAddress, // Using WETH as base currency for Ethereum
        redstoneOracleAssets: {
          plainRedstoneOracleWrappers: {
            // PLACEHOLDER: Update with actual Ethereum oracle addresses
            [stETHAddress]: "0x0000000000000000000000000000000000000000", // stETH/ETH Feed
          },
          redstoneOracleWrappersWithThresholding: {},
          compositeRedstoneOracleWrappersWithThresholding: {},
        },
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
        dETH: strategyDS,
        stS: strategyStS, // Update key to match Ethereum equivalent
        sfrxUSD: strategySfrxUSD,
        wstkscUSD: strategyWstkscUSD, // Update if different on Ethereum
        WETH: strategyWETH,
        scETH: strategyscETH, // Update key if different on Ethereum
        wstkscETH: strategywstkscETH, // Update key if different on Ethereum
        PTaUSDC: strategyPTaUSDC, // Update for Ethereum Pendle tokens
        PTwstkscUSD: strategyPTwstkscUSD, // Update for Ethereum Pendle tokens
        wOS: strategywOS, // Update key if different on Ethereum
      },
    },
    odos: {
      router: odoRouterV2Address,
    },
    dStake: {
      sdUSD: {
        dStable: emptyStringIfUndefined(dUSDDeployment?.address),
        name: "Staked dUSD",
        symbol: "sdUSD",
        initialAdmin: governanceSafeMultisig,
        initialFeeManager: governanceSafeMultisig,
        initialWithdrawalFeeBps: 0.1 * ONE_PERCENT_BPS, // 0.1%
        adapters: [
          {
            vaultAsset: emptyStringIfUndefined(
              dLendATokenWrapperDUSDDeployment?.address,
            ),
            adapterContract: "WrappedDLendConversionAdapter",
          },
        ],
        defaultDepositVaultAsset: emptyStringIfUndefined(
          dLendATokenWrapperDUSDDeployment?.address,
        ),
        collateralVault: "DStakeCollateralVault_sdUSD", // Keep in sync with deploy ID constants
        collateralExchangers: [governanceSafeMultisig],
        dLendRewardManager: {
          managedVaultAsset: emptyStringIfUndefined(
            dLendATokenWrapperDUSDDeployment?.address,
          ), // StaticATokenLM wrapper
          dLendAssetToClaimFor: emptyStringIfUndefined(
            aTokenDUSDDeployment?.address,
          ), // dLEND aToken for dUSD
          dLendRewardsController: emptyStringIfUndefined(
            rewardsControllerDeployment?.address,
          ), // RewardsController proxy
          treasury: governanceSafeMultisig,
          maxTreasuryFeeBps: 20 * ONE_PERCENT_BPS, // 20%
          initialTreasuryFeeBps: 0 * ONE_PERCENT_BPS, // 0%
          initialExchangeThreshold: 100n * 10n ** BigInt(dUSDDecimals), // 100 sdUSD
        },
      },
    },
    // Not launching dBOOST yet, so keep disabled for now
    // vesting: {
    //   name: "dBOOST sdUSD Season 1",
    //   symbol: "sdUSD-S1",
    //   dstakeToken: emptyStringIfUndefined(sdUSDDeployment?.address),
    //   vestingPeriod: 180 * 24 * 60 * 60, // 6 months
    //   maxTotalSupply: _hre.ethers.parseUnits("20000000", 18).toString(), // 20M tokens
    //   initialOwner: governanceSafeMultisig,
    //   minDepositThreshold: _hre.ethers.parseUnits("250000", 18).toString(), // 250k tokens
    // },
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
