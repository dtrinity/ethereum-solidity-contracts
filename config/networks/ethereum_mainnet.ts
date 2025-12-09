import "hardhat-deploy/dist/src/type-extensions";

import { ZeroAddress } from "ethers";
import type { HardhatRuntimeEnvironment } from "hardhat/types";

import { ONE_PERCENT_BPS } from "../../typescript/common/bps_constants";
import { DETH_TOKEN_ID, DUSD_TOKEN_ID } from "../../typescript/deploy-ids";
import { ORACLE_AGGREGATOR_BASE_CURRENCY_UNIT, ORACLE_AGGREGATOR_PRICE_DECIMALS } from "../../typescript/oracle_aggregator/constants";
import { rateStrategyHighLiquidityStable, rateStrategyMediumLiquidityVolatile } from "../dlend/interest-rate-strategies";
import { strategyDETH, strategyDUSD, strategySFRXETH, strategySTETH, strategyWETH } from "../dlend/reserves-params";
import { Config } from "../types";

// Stablecoins stay pegged to USD (base currency of the USD aggregator)
const STABLE_THRESHOLD = ORACLE_AGGREGATOR_BASE_CURRENCY_UNIT;

// Known production addresses
const WETH_ADDRESS = "0xC02aaA39b223FE8D0A0e5C4F27eAD9083C756Cc2";
const WSTETH_ADDRESS = "0x7f39c581f595b53c5cb5bb7d115291d9d7d5f14e";
const FRXETH_ADDRESS = "0x5E8422345238F34275888049021821E8E08CAa1f";
const SFRXETH_ADDRESS = "0xac3E018457B222d93114458476f3E3416Abbe38F";
const USDC_ADDRESS = "0xA0b86991c6218b36c1d19d4a2e9eb0ce3606eb48";
const USDT_ADDRESS = "0xdAC17F958D2ee523a2206206994597C13D831ec7";

// TODO: fill with canonical frxUSD/sfrxUSD mainnet addresses once confirmed
const FRXUSD_ADDRESS: string | undefined = undefined;
const SFRXUSD_ADDRESS: string | undefined = undefined;

// TODO: fill once contracts are deployed/confirmed on mainnet
const USDS_ADDRESS: string | undefined = undefined;
const SUSDS_ADDRESS: string | undefined = undefined;
const GOVERNANCE_SAFE: string | undefined = "0xE83c188a7BE46B90715C757A06cF917175f30262"; // Reuse cross-chain governance Safe by default
const INCENTIVES_SAFE: string | undefined = "0x4B4B5cC616be4cd1947B93f2304d36b3e80D3ef6"; // Incentives Safe used on other chains

// Chainlink feeds (kept separate so it's easy to swap to Redstone/API3 if preferred)
const ETH_USD_FEED = "0x5f4ec3df9cbd43714fe2740f5e3616155c5b8419";
const USDC_USD_FEED = "0x8fFfFfd4AfB6115b954Bd326cbe7B4BA576818f6";
const USDT_USD_FEED = "0x3E7d1eAB13ad0104d2750B8863b489D65364e32D";

// TODO: add mainnet feeds as we finalise collateral/oracle wiring
const FRXUSD_USD_FEED: string | undefined = undefined;
const USDS_USD_FEED: string | undefined = undefined;
const SFRXUSD_FRXUSD_FEED: string | undefined = undefined;
const SFRXUSD_USD_FEED: string | undefined = undefined;
const SUSDS_USDS_FEED: string | undefined = undefined;
const WSTETH_ETH_FEED: string | undefined = "0xb523AE262D20A936BC152e6023996e46FDC2A95D"; // Widely used Chainlink wstETH/ETH feed
const FRXETH_ETH_FEED: string | undefined = "0xF9680D99D6C9589e2a93a78A04A279e509205945"; // Chainlink frxETH/ETH feed
const SFRXETH_FRXETH_FEED: string | undefined = undefined;

/**
 * Ethereum mainnet configuration for production deployment.
 * Only a few addresses (notably USDS/sUSDS, sfrxUSD price feeds, and governance Safe confirmation) still need to be filled.
 *
 * @param hre - Hardhat runtime environment.
 */
export async function getConfig(hre: HardhatRuntimeEnvironment): Promise<Config> {
  const { deployer } = await hre.getNamedAccounts();
  const dUSDDeployment = await hre.deployments.getOrNull(DUSD_TOKEN_ID);
  const dETHDeployment = await hre.deployments.getOrNull(DETH_TOKEN_ID);

  // Governance defaults to the shared Safe; fall back to deployer to avoid undefined values during dry-runs
  const governanceAddress = GOVERNANCE_SAFE ?? deployer ?? ZeroAddress;
  const incentivesVault = INCENTIVES_SAFE ?? governanceAddress;

  // Collateral redemption fee overrides (fallback to defaults when not set)
  const dUSDCollateralFees: Record<string, number> = {};
  const dETHCollateralFees: Record<string, number> = {};

  addCollateralFee(dUSDCollateralFees, USDC_ADDRESS, 0.4 * ONE_PERCENT_BPS);
  addCollateralFee(dUSDCollateralFees, USDT_ADDRESS, 0.4 * ONE_PERCENT_BPS);
  addCollateralFee(dUSDCollateralFees, USDS_ADDRESS, 0.4 * ONE_PERCENT_BPS);
  addCollateralFee(dUSDCollateralFees, FRXUSD_ADDRESS, 0.4 * ONE_PERCENT_BPS);
  addCollateralFee(dUSDCollateralFees, SUSDS_ADDRESS, 0.5 * ONE_PERCENT_BPS);
  addCollateralFee(dUSDCollateralFees, SFRXUSD_ADDRESS, 0.5 * ONE_PERCENT_BPS);

  addCollateralFee(dETHCollateralFees, WETH_ADDRESS, 0.4 * ONE_PERCENT_BPS);
  addCollateralFee(dETHCollateralFees, WSTETH_ADDRESS, 0.5 * ONE_PERCENT_BPS);

  // USD oracle feeds
  const usdPlainRedstoneFeeds: Record<string, string> = {};
  addPlainFeed(usdPlainRedstoneFeeds, WETH_ADDRESS, ETH_USD_FEED);
  addPlainFeed(usdPlainRedstoneFeeds, dETHDeployment?.address, ETH_USD_FEED);

  const usdThresholdRedstoneFeeds: Record<string, { feed: string; lowerThreshold: bigint; fixedPrice: bigint }> = {};
  addThresholdFeed(usdThresholdRedstoneFeeds, USDC_ADDRESS, USDC_USD_FEED, STABLE_THRESHOLD);
  addThresholdFeed(usdThresholdRedstoneFeeds, USDT_ADDRESS, USDT_USD_FEED, STABLE_THRESHOLD);
  addThresholdFeed(usdThresholdRedstoneFeeds, USDS_ADDRESS, USDS_USD_FEED, STABLE_THRESHOLD);
  addThresholdFeed(usdThresholdRedstoneFeeds, FRXUSD_ADDRESS, FRXUSD_USD_FEED, STABLE_THRESHOLD);

  const usdCompositeRedstoneFeeds: Record<
    string,
    {
      feedAsset: string;
      feed1: string;
      feed2: string;
      lowerThresholdInBase1: bigint;
      fixedPriceInBase1: bigint;
      lowerThresholdInBase2: bigint;
      fixedPriceInBase2: bigint;
    }
  > = {};

  addCompositeFeed(
    usdCompositeRedstoneFeeds,
    SUSDS_ADDRESS,
    SUSDS_ADDRESS,
    SUSDS_USDS_FEED,
    USDS_USD_FEED,
    0n,
    0n,
    STABLE_THRESHOLD,
    STABLE_THRESHOLD,
  );

  // sfrxUSD is a yield-bearing stable, so price via sfrxUSD/frxUSD * frxUSD/USD
  addCompositeFeed(
    usdCompositeRedstoneFeeds,
    SFRXUSD_ADDRESS,
    SFRXUSD_ADDRESS,
    SFRXUSD_FRXUSD_FEED,
    FRXUSD_USD_FEED ?? SFRXUSD_USD_FEED,
    0n,
    0n,
    STABLE_THRESHOLD,
    STABLE_THRESHOLD,
  );

  // ETH oracle feeds
  const ethPlainRedstoneFeeds: Record<string, string> = {};
  addPlainFeed(ethPlainRedstoneFeeds, WSTETH_ADDRESS, WSTETH_ETH_FEED);

  const ethCompositeRedstoneFeeds: Record<
    string,
    {
      feedAsset: string;
      feed1: string;
      feed2: string;
      lowerThresholdInBase1: bigint;
      fixedPriceInBase1: bigint;
      lowerThresholdInBase2: bigint;
      fixedPriceInBase2: bigint;
    }
  > = {};

  addCompositeFeed(ethCompositeRedstoneFeeds, SFRXETH_ADDRESS, SFRXETH_ADDRESS, SFRXETH_FRXETH_FEED, FRXETH_ETH_FEED, 0n, 0n, 0n, 0n);

  return {
    tokenAddresses: {
      WETH: WETH_ADDRESS,
      dUSD: stringOrEmpty(dUSDDeployment?.address),
      dETH: stringOrEmpty(dETHDeployment?.address),
      USDC: USDC_ADDRESS,
      USDT: USDT_ADDRESS,
      USDS: stringOrEmpty(USDS_ADDRESS),
      sUSDS: stringOrEmpty(SUSDS_ADDRESS),
      frxUSD: stringOrEmpty(FRXUSD_ADDRESS),
      sfrxUSD: stringOrEmpty(SFRXUSD_ADDRESS),
      wstETH: WSTETH_ADDRESS,
      frxETH: FRXETH_ADDRESS,
      sfrxETH: SFRXETH_ADDRESS,
    },
    walletAddresses: {
      governanceMultisig: governanceAddress,
      incentivesVault,
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
          plainRedstoneOracleWrappers: usdPlainRedstoneFeeds,
          redstoneOracleWrappersWithThresholding: usdThresholdRedstoneFeeds,
          compositeRedstoneOracleWrappersWithThresholding: usdCompositeRedstoneFeeds,
        },
      },
      ETH: {
        priceDecimals: ORACLE_AGGREGATOR_PRICE_DECIMALS,
        hardDStablePeg: ORACLE_AGGREGATOR_BASE_CURRENCY_UNIT,
        baseCurrency: WETH_ADDRESS,
        api3OracleAssets: {
          plainApi3OracleWrappers: {},
          api3OracleWrappersWithThresholding: {},
          compositeApi3OracleWrappersWithThresholding: {},
        },
        redstoneOracleAssets: {
          plainRedstoneOracleWrappers: ethPlainRedstoneFeeds,
          redstoneOracleWrappersWithThresholding: {},
          compositeRedstoneOracleWrappersWithThresholding: ethCompositeRedstoneFeeds,
        },
      },
    },
    dStables: {
      dUSD: {
        collaterals: filterAddresses([USDC_ADDRESS, USDT_ADDRESS, USDS_ADDRESS, SUSDS_ADDRESS, FRXUSD_ADDRESS, SFRXUSD_ADDRESS]),
        initialFeeReceiver: governanceAddress,
        initialRedemptionFeeBps: 0.4 * ONE_PERCENT_BPS,
        collateralRedemptionFees: dUSDCollateralFees,
      },
      dETH: {
        collaterals: filterAddresses([WETH_ADDRESS, WSTETH_ADDRESS]),
        initialFeeReceiver: governanceAddress,
        initialRedemptionFeeBps: 0.4 * ONE_PERCENT_BPS,
        collateralRedemptionFees: dETHCollateralFees,
      },
    },
    dLend: {
      providerID: 1,
      flashLoanPremium: {
        total: 0.0005e4,
        protocol: 0.0004e4,
      },
      rateStrategies: [rateStrategyHighLiquidityStable, rateStrategyMediumLiquidityVolatile],
      reservesConfig: {
        dUSD: strategyDUSD, // Borrowable only
        dETH: strategyDETH, // Borrowable only
        WETH: strategyWETH,
        wstETH: strategySTETH,
        sfrxETH: strategySFRXETH, // Collateral-only per strategy definition
      },
    },
  };
}

/**
 * Returns the provided address string or an empty fallback when undefined.
 *
 * @param value - Address string to normalise.
 */
function stringOrEmpty(value: string | undefined): string {
  return value ?? "";
}

/**
 * Adds the given collateral fee in basis points when the address is defined.
 *
 * @param fees - Mutable map of collateral fee overrides.
 * @param address - Collateral token address.
 * @param feeBps - Redemption fee in basis points.
 */
function addCollateralFee(fees: Record<string, number>, address: string | undefined, feeBps: number): void {
  if (address) {
    fees[address] = feeBps;
  }
}

/**
 * Adds a plain oracle feed to the supplied map when both asset and feed are present.
 *
 * @param feeds - Mutable feed map.
 * @param asset - Asset address to price.
 * @param feed - Oracle feed address.
 */
function addPlainFeed(feeds: Record<string, string>, asset: string | undefined, feed: string | undefined): void {
  if (asset && feed) {
    feeds[asset] = feed;
  }
}

/**
 * Adds a thresholded oracle feed when inputs are available.
 *
 * @param feeds - Mutable feed map.
 * @param asset - Asset address to price.
 * @param feed - Oracle feed address.
 * @param threshold - Threshold price to pin at.
 */
function addThresholdFeed(
  feeds: Record<string, { feed: string; lowerThreshold: bigint; fixedPrice: bigint }>,
  asset: string | undefined,
  feed: string | undefined,
  threshold: bigint,
): void {
  if (asset && feed) {
    feeds[asset] = {
      feed,
      lowerThreshold: threshold,
      fixedPrice: threshold,
    };
  }
}

/**
 * Adds a composite oracle feed configuration when all inputs are specified.
 *
 * @param feeds - Mutable feed map.
 * @param asset - Asset address to price.
 * @param feedAsset - Asset address used by the feed contract.
 * @param feed1 - First leg feed (e.g., sfrxUSD/frxUSD).
 * @param feed2 - Second leg feed (e.g., frxUSD/USD).
 * @param lower1 - Lower threshold for feed1.
 * @param fixed1 - Fixed price for feed1 when below the threshold.
 * @param lower2 - Lower threshold for feed2.
 * @param fixed2 - Fixed price for feed2 when below the threshold.
 */
function addCompositeFeed(
  feeds: Record<
    string,
    {
      feedAsset: string;
      feed1: string;
      feed2: string;
      lowerThresholdInBase1: bigint;
      fixedPriceInBase1: bigint;
      lowerThresholdInBase2: bigint;
      fixedPriceInBase2: bigint;
    }
  >,
  asset: string | undefined,
  feedAsset: string | undefined,
  feed1: string | undefined,
  feed2: string | undefined,
  lower1: bigint,
  fixed1: bigint,
  lower2: bigint,
  fixed2: bigint,
): void {
  if (asset && feedAsset && feed1 && feed2) {
    feeds[asset] = {
      feedAsset,
      feed1,
      feed2,
      lowerThresholdInBase1: lower1,
      fixedPriceInBase1: fixed1,
      lowerThresholdInBase2: lower2,
      fixedPriceInBase2: fixed2,
    };
  }
}

/**
 * Filters undefined/empty entries from address lists to avoid accidentally wiring the zero address.
 *
 * @param addresses - Candidate address list.
 */
function filterAddresses(addresses: (string | undefined)[]): string[] {
  return addresses.filter((value): value is string => Boolean(value));
}
