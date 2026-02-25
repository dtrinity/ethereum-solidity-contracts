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
import {
  strategyCBBTC,
  strategyDETH,
  strategyDUSD,
  strategyLBTC,
  strategyPAXG,
  strategyRETH,
  strategySFRXETH,
  strategySFRXUSD,
  strategySTETH,
  strategySUSDE,
  strategySUSDS,
  strategySYRUPUSDC,
  strategySYRUPUSDT,
  strategyWBTC,
  strategyWETH,
} from "../dlend/reserves-params";
import { Config } from "../types";

const STABLE_THRESHOLD = ORACLE_AGGREGATOR_BASE_CURRENCY_UNIT;

// Known production token addresses
const WETH_ADDRESS = "0xC02aaA39b223FE8D0A0e5C4F27eAD9083C756Cc2";
const WSTETH_ADDRESS = "0x7f39C581F595B53c5cb19bD0b3f8dA6c935E2Ca0";
const RETH_ADDRESS = "0xae78736Cd615f374D3085123A210448E74Fc6393";
const FRXETH_ADDRESS = "0x5E8422345238F34275888049021821E8E08CAa1f";
const SFRXETH_ADDRESS = "0xac3E018457B222d93114458476f3E3416Abbe38F";

const USDC_ADDRESS = "0xA0b86991c6218b36c1d19D4a2e9Eb0cE3606eB48";
const USDT_ADDRESS = "0xdAC17F958D2ee523a2206206994597C13D831ec7";
const USDS_ADDRESS = "0xdC035D45d973E3EC169d2276DDab16f1e407384F";
const SUSDS_ADDRESS = "0xa3931d71877C0E7a3148CB7Eb4463524FEc27fbD";
const SUSDE_ADDRESS = "0x9D39A5DE30e57443BfF2A8307A4256c8797A3497";
const SYRUP_USDC_ADDRESS = "0x80ac24aa929eaf5013f6436cda2a7ba190f5cc0b";
const SYRUP_USDT_ADDRESS = "0x356b8d89c1e1239cbbb9de4815c39a1474d5ba7d";
const FRXUSD_ADDRESS = "0xCAcd6fd266aF91b8AeD52aCCc382b4e165586E29";
const SFRXUSD_ADDRESS = "0xcf62F905562626CfcDD2261162a51fd02Fc9c5b6";

const LBTC_ADDRESS = "0x8236a87084f8B84306f72007F36F2618A5634494";
const WBTC_ADDRESS = "0x2260FAC5E5542a773Aa44fBCfeDf7C193bc2C599";
const CBBTC_ADDRESS = "0xcBb7C0000aB88B473b1f5AFD9eF808440Eed33BF";
const PAXG_ADDRESS = "0x45804880De22913dAFE09f4980848ECE6EcbAf78";

// Safe wallets
const GOVERNANCE_SAFE = "0xE83c188a7BE46B90715C757A06cF917175f30262";
const INCENTIVES_SAFE = "0x4B4B5cC616be4cd1947B93f2304d36b3e80D3ef6";

// Chainlink feeds (known)
const ETH_USD_FEED = "0x5f4eC3Df9cbd43714FE2740f5E3616155c5b8419";
const BTC_USD_FEED = "0xF4030086522a5bEEa4988F8cA5B36dbC97BeE88c";
const USDC_USD_FEED = "0x8fFfFfd4AfB6115b954Bd326cbe7B4BA576818f6";
const USDT_USD_FEED = "0x3E7d1eAB13ad0104d2750B8863b489D65364e32D";
const FRXUSD_USD_FEED = "0x9B4a96210bc8D9D55b1908B465D8B0de68B7fF83";
const USDS_USD_FEED = "0xfF30586cD0F29eD462364C7e81375FC0C71219b1";
const USDE_USD_FEED = "0xa569d910839Ae8865Da8F8e70FfFb0cBA869F961";
const RETH_ETH_FEED = "0x536218f9E9Eb48863970252233c8F271f554C2d0";
const LBTC_BTC_FEED = "0x5c29868C58b6e15e2b962943278969Ab6a7D3212";
const WBTC_BTC_FEED = "0xfdFD9C85aD200c506Cf9e21F1FD8dd01932FBB23";
const CBBTC_USD_FEED = "0x2665701293fCbEB223D11A08D826563EDcCE423A";
const PAXG_USD_FEED = "0x9944D86CEB9160aF5C5feB251FD671923323f8C3";

// ETH-denominated feeds (known)
const WSTETH_STETH_FEED = "0x4F67e4d9BD67eFa28236013288737D39AeF48e79";

/**
 * Returns Ethereum mainnet deployment configuration for protocol modules.
 *
 * @param hre
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

  const governanceAddress = GOVERNANCE_SAFE ?? deployer;
  const incentivesVault = INCENTIVES_SAFE ?? governanceAddress;

  const dUSDCollateralFees: Record<string, number> = {};
  const dETHCollateralFees: Record<string, number> = {};

  addCollateralFee(dUSDCollateralFees, SUSDS_ADDRESS, 0.5 * ONE_PERCENT_BPS);
  addCollateralFee(dUSDCollateralFees, SFRXUSD_ADDRESS, 0.5 * ONE_PERCENT_BPS);

  addCollateralFee(dETHCollateralFees, WSTETH_ADDRESS, 0.5 * ONE_PERCENT_BPS);
  addCollateralFee(dETHCollateralFees, SFRXETH_ADDRESS, 0.5 * ONE_PERCENT_BPS);
  addCollateralFee(dETHCollateralFees, FRXETH_ADDRESS, 0.5 * ONE_PERCENT_BPS);

  const usdPlainRedstoneFeeds: Record<string, string> = {};
  addPlainFeed(usdPlainRedstoneFeeds, WETH_ADDRESS, ETH_USD_FEED);
  addPlainFeed(usdPlainRedstoneFeeds, dETHDeployment?.address, ETH_USD_FEED);
  addPlainFeed(usdPlainRedstoneFeeds, CBBTC_ADDRESS, CBBTC_USD_FEED);
  addPlainFeed(usdPlainRedstoneFeeds, PAXG_ADDRESS, PAXG_USD_FEED);

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

  addCompositeFeed(usdCompositeRedstoneFeeds, WSTETH_ADDRESS, WSTETH_ADDRESS, WSTETH_STETH_FEED, ETH_USD_FEED, 0n, 0n, 0n, 0n);
  addCompositeFeed(usdCompositeRedstoneFeeds, RETH_ADDRESS, RETH_ADDRESS, RETH_ETH_FEED, ETH_USD_FEED, 0n, 0n, 0n, 0n);
  addCompositeFeed(usdCompositeRedstoneFeeds, LBTC_ADDRESS, LBTC_ADDRESS, LBTC_BTC_FEED, BTC_USD_FEED, 0n, 0n, 0n, 0n);
  addCompositeFeed(usdCompositeRedstoneFeeds, WBTC_ADDRESS, WBTC_ADDRESS, WBTC_BTC_FEED, BTC_USD_FEED, 0n, 0n, 0n, 0n);

  const usdChainlinkErc4626Feeds: Record<string, { vault: string; feed: string }> = {};
  addErc4626Feed(usdChainlinkErc4626Feeds, SUSDE_ADDRESS, SUSDE_ADDRESS, USDE_USD_FEED);
  addErc4626Feed(usdChainlinkErc4626Feeds, SUSDS_ADDRESS, SUSDS_ADDRESS, USDS_USD_FEED);
  addErc4626Feed(usdChainlinkErc4626Feeds, SYRUP_USDC_ADDRESS, SYRUP_USDC_ADDRESS, USDC_USD_FEED);
  addErc4626Feed(usdChainlinkErc4626Feeds, SYRUP_USDT_ADDRESS, SYRUP_USDT_ADDRESS, USDT_USD_FEED);
  addErc4626Feed(usdChainlinkErc4626Feeds, SFRXUSD_ADDRESS, SFRXUSD_ADDRESS, FRXUSD_USD_FEED);
  addErc4626Feed(usdChainlinkErc4626Feeds, SFRXETH_ADDRESS, SFRXETH_ADDRESS, ETH_USD_FEED);

  const ethPlainRedstoneFeeds: Record<string, string> = {};
  addPlainFeed(ethPlainRedstoneFeeds, WSTETH_ADDRESS, WSTETH_STETH_FEED);

  const ethErc4626OracleAssets: Record<string, string> = {};
  addSimpleErc4626Asset(ethErc4626OracleAssets, SFRXETH_ADDRESS, SFRXETH_ADDRESS);

  const frxEthFundamentalOracle = {
    asset: FRXETH_ADDRESS,
    etherRouter: "0x5acAf61d339dd123e60ba450Ea38fbC49445007C",
    redemptionQueue: "0xfDC69e6BE352BD5644C438302DE4E311AAD5565b",
  };

  return {
    tokenAddresses: {
      WETH: WETH_ADDRESS,
      dUSD: stringOrEmpty(dUSDDeployment?.address),
      dETH: stringOrEmpty(dETHDeployment?.address),
      USDC: USDC_ADDRESS,
      USDT: USDT_ADDRESS,
      USDS: stringOrEmpty(USDS_ADDRESS),
      sUSDS: stringOrEmpty(SUSDS_ADDRESS),
      sUSDe: SUSDE_ADDRESS,
      syrupUSDC: SYRUP_USDC_ADDRESS,
      syrupUSDT: SYRUP_USDT_ADDRESS,
      frxUSD: stringOrEmpty(FRXUSD_ADDRESS),
      sfrxUSD: stringOrEmpty(SFRXUSD_ADDRESS),
      wstETH: WSTETH_ADDRESS,
      rETH: RETH_ADDRESS,
      frxETH: FRXETH_ADDRESS,
      sfrxETH: SFRXETH_ADDRESS,
      LBTC: LBTC_ADDRESS,
      WBTC: WBTC_ADDRESS,
      cbBTC: CBBTC_ADDRESS,
      PAXG: PAXG_ADDRESS,
    },
    walletAddresses: {
      governanceMultisig: governanceAddress,
      incentivesVault,
    },
    safeConfig: {
      safeAddress: GOVERNANCE_SAFE,
      owners: [
        "0x4B58fF1AAE6AdD7465A5584eBCaeb876ec8f21FD",
        "0xDC672ba6e55B71b39FA5423D42B88E7aDF9d24A4",
        "0x9E0c8376940aBE845A89b7304147a95c72644f59",
      ],
      threshold: 2,
      chainId: 1,
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
        frxEthFundamentalOracle,
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
        collaterals: filterAddresses([WETH_ADDRESS, WSTETH_ADDRESS, SFRXETH_ADDRESS, FRXETH_ADDRESS]),
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
        dUSD: strategyDUSD,
        dETH: strategyDETH,

        WETH: strategyWETH,
        wstETH: strategySTETH,
        rETH: strategyRETH,
        sfrxETH: strategySFRXETH,

        sUSDe: strategySUSDE,
        sUSDS: strategySUSDS,
        syrupUSDC: strategySYRUPUSDC,
        syrupUSDT: strategySYRUPUSDT,
        sfrxUSD: strategySFRXUSD,

        LBTC: strategyLBTC,
        WBTC: strategyWBTC,
        cbBTC: strategyCBBTC,
        PAXG: strategyPAXG,
      },
    },
    dStake: {
      sdUSD: {
        dStable: stringOrEmpty(dUSDDeployment?.address),
        name: "Staked dUSD",
        symbol: "sdUSD",
        initialWithdrawalFeeBps: 10 * ONE_BPS_UNIT,
        adapters: [
          {
            strategyShare: stringOrEmpty(idleVaultSdUSDDeployment?.address),
            adapterContract: "GenericERC4626ConversionAdapter",
            vaultAsset: stringOrEmpty(idleVaultSdUSDDeployment?.address),
            targetBps: ONE_HUNDRED_PERCENT_BPS,
          },
          {
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
          rewardManager: incentivesVault,
        },
      },
      sdETH: {
        dStable: stringOrEmpty(dETHDeployment?.address),
        name: "Staked dETH",
        symbol: "sdETH",
        initialWithdrawalFeeBps: 10 * ONE_BPS_UNIT,
        adapters: [
          {
            strategyShare: stringOrEmpty(idleVaultSdETHDeployment?.address),
            adapterContract: "GenericERC4626ConversionAdapter",
            vaultAsset: stringOrEmpty(idleVaultSdETHDeployment?.address),
            targetBps: ONE_HUNDRED_PERCENT_BPS,
          },
          {
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
          rewardManager: incentivesVault,
        },
      },
    },
  };
}

/**
 * Returns the provided address string or an empty fallback when undefined.
 *
 * @param value
 */
function stringOrEmpty(value: string | undefined): string {
  return value ?? "";
}

/**
 * Adds a collateral fee override when the token address is defined.
 *
 * @param fees
 * @param address
 * @param feeBps
 */
function addCollateralFee(fees: Record<string, number>, address: string | undefined, feeBps: number): void {
  if (address) {
    fees[address] = feeBps;
  }
}

/**
 * Adds a plain feed mapping when both asset and feed are defined.
 *
 * @param feeds
 * @param asset
 * @param feed
 */
function addPlainFeed(feeds: Record<string, string>, asset: string | undefined, feed: string | undefined): void {
  if (asset && feed) {
    feeds[asset] = feed;
  }
}

/**
 * Adds a threshold feed mapping when both asset and feed are defined.
 *
 * @param feeds
 * @param asset
 * @param feed
 * @param threshold
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
 * Filters undefined entries from an address list.
 *
 * @param addresses
 */
function filterAddresses(addresses: (string | undefined)[]): string[] {
  return addresses.filter((value): value is string => Boolean(value));
}

/**
 * Adds an ERC4626 feed config when asset, vault and feed are defined.
 *
 * @param feeds
 * @param asset
 * @param vault
 * @param feed
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
 * Adds a simple ERC4626 asset mapping when asset and vault are defined.
 *
 * @param assets
 * @param asset
 * @param vault
 */
function addSimpleErc4626Asset(assets: Record<string, string>, asset: string | undefined, vault: string | undefined): void {
  if (asset && vault) {
    assets[asset] = vault;
  }
}

/**
 * Adds a composite feed mapping when required addresses are defined.
 *
 * @param feeds
 * @param asset
 * @param feedAsset
 * @param feed1
 * @param feed2
 * @param lowerThresholdInBase1
 * @param fixedPriceInBase1
 * @param lowerThresholdInBase2
 * @param fixedPriceInBase2
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
