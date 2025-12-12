import "hardhat-deploy/dist/src/type-extensions";

import { ZeroAddress } from "ethers";
import type { HardhatRuntimeEnvironment } from "hardhat/types";

import { ONE_BPS_UNIT, ONE_HUNDRED_PERCENT_BPS, ONE_PERCENT_BPS } from "../../typescript/common/bps_constants";
import { DETH_A_TOKEN_WRAPPER_ID, DETH_TOKEN_ID, DUSD_A_TOKEN_WRAPPER_ID, DUSD_TOKEN_ID } from "../../typescript/deploy-ids";
import { ORACLE_AGGREGATOR_BASE_CURRENCY_UNIT, ORACLE_AGGREGATOR_PRICE_DECIMALS } from "../../typescript/oracle_aggregator/constants";
import {
  rateStrategyBorrowDStable,
  rateStrategyHighLiquidityStable,
  rateStrategyHighLiquidityVolatile,
} from "../dlend/interest-rate-strategies";
import { strategyDETH, strategyDUSD, strategySFRXETH, strategySTETH, strategyWETH } from "../dlend/reserves-params";
import { Config } from "../types";

// Stablecoins stay pegged to USD (base currency of the USD aggregator)
const STABLE_THRESHOLD = ORACLE_AGGREGATOR_BASE_CURRENCY_UNIT;

// Known production addresses
const WETH_ADDRESS = "0xC02aaA39b223FE8D0A0e5C4F27eAD9083C756Cc2";
const WSTETH_ADDRESS = "0x7f39C581F595B53c5cb19bD0b3f8dA6c935E2Ca0";
const FRXETH_ADDRESS = "0x5E8422345238F34275888049021821E8E08CAa1f";
const SFRXETH_ADDRESS = "0xac3E018457B222d93114458476f3E3416Abbe38F";
const USDC_ADDRESS = "0xA0b86991c6218b36c1d19D4a2e9Eb0cE3606eB48";
const USDT_ADDRESS = "0xdAC17F958D2ee523a2206206994597C13D831ec7";
const FRXUSD_ADDRESS = "0xCAcd6fd266aF91b8AeD52aCCc382b4e165586E29";
const SFRXUSD_ADDRESS = "0xcf62F905562626CfcDD2261162a51fd02Fc9c5b6";
const USDS_ADDRESS = "0xdC035D45d973E3EC169d2276DDab16f1e407384F";
const SUSDS_ADDRESS = "0xa3931d71877C0E7a3148CB7Eb4463524FEc27fbD";

// Safe wallets
const GOVERNANCE_SAFE = "0xE83c188a7BE46B90715C757A06cF917175f30262"; // Reuse cross-chain governance Safe by default
const INCENTIVES_SAFE = "0x4B4B5cC616be4cd1947B93f2304d36b3e80D3ef6"; // Incentives Safe used on other chains

// Chainlink feeds
const ETH_USD_FEED = "0x5f4eC3Df9cbd43714FE2740f5E3616155c5b8419"; // Chainlink ETH/USD feed
const USDC_USD_FEED = "0x8fFfFfd4AfB6115b954Bd326cbe7B4BA576818f6"; // Chainlink USDC/USD feed
const USDT_USD_FEED = "0x3E7d1eAB13ad0104d2750B8863b489D65364e32D"; // Chainlink USDT/USD feed
const FRXUSD_USD_FEED = "0x9B4a96210bc8D9D55b1908B465D8B0de68B7fF83"; // Chainlink frxUSD/USD feed
const USDS_USD_FEED = "0xfF30586cD0F29eD462364C7e81375FC0C71219b1"; // Chainlink USDS/USD feed

// ETH-denominated feeds
// Lido wstETH/stETH fundamental exchange rate oracle (not market-based) deployed by Compound using Lido's helper contract
// Since stETH is 1:1 redeemable with ETH, this effectively gives wstETH/ETH
const WSTETH_STETH_FEED = "0x4F67e4d9BD67eFa28236013288737D39AeF48e79";

/**
 * Ethereum mainnet configuration for production deployment.
 * Governance defaults to the shared Safe, and incentives vault to governance.
 *
 * @param hre - Hardhat runtime environment.
 */
export async function getConfig(hre: HardhatRuntimeEnvironment): Promise<Config> {
  const { deployer } = await hre.getNamedAccounts();
  const dUSDDeployment = await hre.deployments.getOrNull(DUSD_TOKEN_ID);
  const dETHDeployment = await hre.deployments.getOrNull(DETH_TOKEN_ID);
  const [dLendATokenWrapperDUSDDeployment, dLendATokenWrapperDETHDeployment] = await Promise.all([
    hre.deployments.getOrNull(DUSD_A_TOKEN_WRAPPER_ID),
    hre.deployments.getOrNull(DETH_A_TOKEN_WRAPPER_ID),
  ]);
  const [idleVaultSdUSDDeployment, idleVaultSdETHDeployment] = await Promise.all([
    hre.deployments.getOrNull("DStakeIdleVault_sdUSD"),
    hre.deployments.getOrNull("DStakeIdleVault_sdETH"),
  ]);

  // Governance defaults to the shared Safe; fall back to deployer to avoid undefined values during dry-runs
  const governanceAddress = GOVERNANCE_SAFE ?? deployer;
  const incentivesVault = INCENTIVES_SAFE ?? governanceAddress;

  // Collateral redemption fee overrides (fallback to defaults when not set)
  const dUSDCollateralFees: Record<string, number> = {};
  const dETHCollateralFees: Record<string, number> = {};

  addCollateralFee(dUSDCollateralFees, SUSDS_ADDRESS, 0.5 * ONE_PERCENT_BPS);
  addCollateralFee(dUSDCollateralFees, SFRXUSD_ADDRESS, 0.5 * ONE_PERCENT_BPS);

  addCollateralFee(dETHCollateralFees, WSTETH_ADDRESS, 0.5 * ONE_PERCENT_BPS);
  addCollateralFee(dETHCollateralFees, SFRXETH_ADDRESS, 0.5 * ONE_PERCENT_BPS);

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

  // wstETH/USD = wstETH/stETH * ETH/USD (using stETH ≈ ETH assumption)
  // feed1 = wstETH/stETH fundamental rate from Lido
  // feed2 = ETH/USD from Chainlink
  // No thresholding needed - both are fundamental/reliable rates
  addCompositeFeed(usdCompositeRedstoneFeeds, WSTETH_ADDRESS, WSTETH_ADDRESS, WSTETH_STETH_FEED, ETH_USD_FEED, 0n, 0n, 0n, 0n);

  const usdChainlinkErc4626Feeds: Record<string, { vault: string; feed: string }> = {};

  addErc4626Feed(usdChainlinkErc4626Feeds, SUSDS_ADDRESS, SUSDS_ADDRESS, USDS_USD_FEED);
  addErc4626Feed(usdChainlinkErc4626Feeds, SFRXUSD_ADDRESS, SFRXUSD_ADDRESS, FRXUSD_USD_FEED);
  // sfrxETH/USD = sfrxETH/frxETH (from vault) * ETH/USD (using frxETH ≈ ETH assumption)
  addErc4626Feed(usdChainlinkErc4626Feeds, SFRXETH_ADDRESS, SFRXETH_ADDRESS, ETH_USD_FEED);

  // ETH oracle feeds
  const ethPlainRedstoneFeeds: Record<string, string> = {};
  // wstETH uses the Lido wstETH/stETH fundamental rate oracle
  // Since stETH is 1:1 redeemable with ETH, wstETH/stETH ≈ wstETH/ETH
  addPlainFeed(ethPlainRedstoneFeeds, WSTETH_ADDRESS, WSTETH_STETH_FEED);

  // Simple ERC4626 oracle assets - for vaults where underlying is 1:1 with base currency (ETH)
  // sfrxETH uses ERC4626OracleWrapperV1_1 which reads convertToAssets() directly
  // Since frxETH is 1:1 redeemable with ETH, no external price feed is needed
  const ethErc4626OracleAssets: Record<string, string> = {};
  addSimpleErc4626Asset(ethErc4626OracleAssets, SFRXETH_ADDRESS, SFRXETH_ADDRESS);

  // --- dSTAKE (mainnet placeholders) ---
  // NOTE:
  // - The deploy scripts will skip instances where addresses are missing/ZeroAddress.
  // - Roles (admin, fee manager, collateral exchangers) are initialized to the deployer
  //   and must be migrated to governance via separate Safe transactions after deployment.

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
        chainlinkErc4626OracleAssets: usdChainlinkErc4626Feeds,
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
        erc4626OracleAssets: ethErc4626OracleAssets,
        api3OracleAssets: {
          plainApi3OracleWrappers: {},
          api3OracleWrappersWithThresholding: {},
          compositeApi3OracleWrappersWithThresholding: {},
        },
        redstoneOracleAssets: {
          plainRedstoneOracleWrappers: ethPlainRedstoneFeeds,
          redstoneOracleWrappersWithThresholding: {},
          compositeRedstoneOracleWrappersWithThresholding: {},
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
        collaterals: filterAddresses([WETH_ADDRESS, WSTETH_ADDRESS, SFRXETH_ADDRESS]),
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
      rateStrategies: [rateStrategyBorrowDStable, rateStrategyHighLiquidityVolatile, rateStrategyHighLiquidityStable],
      reservesConfig: {
        // dSTABLEs
        dUSD: strategyDUSD,
        dETH: strategyDETH,

        // LSTs
        WETH: strategyWETH,
        wstETH: strategySTETH,
        sfrxETH: strategySFRXETH,
      },
    },
    dStake: {
      // Staked dUSD (sdUSD)
      sdUSD: {
        dStable: stringOrEmpty(dUSDDeployment?.address),
        name: "Staked dUSD",
        symbol: "sdUSD",
        initialWithdrawalFeeBps: 10 * ONE_BPS_UNIT, // 0.10%
        adapters: [
          {
            // Default strategy: idle vault (ERC4626) holding dUSD.
            strategyShare: stringOrEmpty(idleVaultSdUSDDeployment?.address),
            adapterContract: "GenericERC4626ConversionAdapter",
            vaultAsset: stringOrEmpty(idleVaultSdUSDDeployment?.address),
            targetBps: ONE_HUNDRED_PERCENT_BPS,
          },
          {
            // Whitelist dLEND wrapper at 0% initially; allocation can be raised later via setVaultConfigs().
            // If not deployed yet, the deploy scripts will try to infer it from DUSD_A_TOKEN_WRAPPER_ID.
            strategyShare: stringOrEmpty(dLendATokenWrapperDUSDDeployment?.address),
            adapterContract: "WrappedDLendConversionAdapter",
            vaultAsset: stringOrEmpty(dLendATokenWrapperDUSDDeployment?.address),
            targetBps: 0,
          },
        ],
        defaultDepositStrategyShare: stringOrEmpty(idleVaultSdUSDDeployment?.address),
        defaultDepositVaultAsset: stringOrEmpty(idleVaultSdUSDDeployment?.address),
        idleVault: {
          name: "dSTAKE Idle dUSD Vault",
          symbol: "idle-dUSD",
          rewardManager: incentivesVault, // Shared with dLEND
        },
      },
      // Staked dETH (sdETH)
      sdETH: {
        dStable: stringOrEmpty(dETHDeployment?.address),
        name: "Staked dETH",
        symbol: "sdETH",
        initialWithdrawalFeeBps: 10 * ONE_BPS_UNIT, // 0.10%
        adapters: [
          {
            // Default strategy: idle vault (ERC4626) holding dETH.
            strategyShare: stringOrEmpty(idleVaultSdETHDeployment?.address),
            adapterContract: "GenericERC4626ConversionAdapter",
            vaultAsset: stringOrEmpty(idleVaultSdETHDeployment?.address),
            targetBps: ONE_HUNDRED_PERCENT_BPS,
          },
          {
            // Whitelist dLEND wrapper at 0% initially; allocation can be raised later via setVaultConfigs().
            strategyShare: stringOrEmpty(dLendATokenWrapperDETHDeployment?.address),
            adapterContract: "WrappedDLendConversionAdapter",
            vaultAsset: stringOrEmpty(dLendATokenWrapperDETHDeployment?.address),
            targetBps: 0,
          },
        ],
        defaultDepositStrategyShare: stringOrEmpty(idleVaultSdETHDeployment?.address),
        defaultDepositVaultAsset: stringOrEmpty(idleVaultSdETHDeployment?.address),
        idleVault: {
          name: "dSTAKE Idle dETH Vault",
          symbol: "idle-dETH",
          rewardManager: incentivesVault, // Shared vault with dLEND
        },
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
 * Filters undefined/empty entries from address lists to avoid accidentally wiring the zero address.
 *
 * @param addresses - Candidate address list.
 */
function filterAddresses(addresses: (string | undefined)[]): string[] {
  return addresses.filter((value): value is string => Boolean(value));
}

/**
 * Adds an ERC4626 oracle feed configuration when all inputs are specified.
 *
 * @param feeds - Mutable feed map.
 * @param asset - Asset address to price (the vault share token).
 * @param vault - ERC4626 vault address (usually same as asset).
 * @param feed - Oracle feed address for the underlying asset.
 */
function addErc4626Feed(
  feeds: Record<string, { vault: string; feed: string }>,
  asset: string | undefined,
  vault: string | undefined,
  feed: string | undefined,
): void {
  if (asset && vault && feed) {
    feeds[asset] = { vault, feed };
  }
}

/**
 * Adds a simple ERC4626 oracle asset where the underlying is assumed 1:1 with base currency.
 *
 * @param assets - Mutable asset map.
 * @param asset - Asset address to price (the vault share token).
 * @param vault - ERC4626 vault address (usually same as asset).
 */
function addSimpleErc4626Asset(assets: Record<string, string>, asset: string | undefined, vault: string | undefined): void {
  if (asset && vault) {
    assets[asset] = vault;
  }
}

/**
 * Adds a composite oracle feed (feed1 * feed2) with optional thresholding.
 *
 * @param feeds - Mutable feed map.
 * @param asset - Asset address to price.
 * @param feedAsset - Asset address for feed lookups (usually same as asset).
 * @param feed1 - First oracle feed address (e.g., asset/intermediate).
 * @param feed2 - Second oracle feed address (e.g., intermediate/base).
 * @param lowerThresholdInBase1 - Threshold for feed1 (0 = no thresholding).
 * @param fixedPriceInBase1 - Fixed price for feed1 when above threshold.
 * @param lowerThresholdInBase2 - Threshold for feed2 (0 = no thresholding).
 * @param fixedPriceInBase2 - Fixed price for feed2 when above threshold.
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
  lowerThresholdInBase1: bigint,
  fixedPriceInBase1: bigint,
  lowerThresholdInBase2: bigint,
  fixedPriceInBase2: bigint,
): void {
  if (asset && feedAsset && feed1 && feed2) {
    feeds[asset] = {
      feedAsset,
      feed1,
      feed2,
      lowerThresholdInBase1,
      fixedPriceInBase1,
      lowerThresholdInBase2,
      fixedPriceInBase2,
    };
  }
}
