import "hardhat-deploy/dist/src/type-extensions";

import { ZeroAddress } from "ethers";
import type { HardhatRuntimeEnvironment } from "hardhat/types";

import { ONE_PERCENT_BPS } from "../../typescript/common/bps_constants";
import { DETH_TOKEN_ID, DUSD_TOKEN_ID } from "../../typescript/deploy-ids";
import {
  DEFAULT_ORACLE_HEARTBEAT_SECONDS,
  ORACLE_AGGREGATOR_BASE_CURRENCY_UNIT,
  ORACLE_AGGREGATOR_PRICE_DECIMALS,
} from "../../typescript/oracle_aggregator/constants";
import { rateStrategyHighLiquidityStable, rateStrategyMediumLiquidityVolatile } from "../dlend/interest-rate-strategies";
import { strategyDUSD, strategySFRXETH } from "../dlend/reserves-params";
import { Config } from "../types";

const STABLE_THRESHOLD = ORACLE_AGGREGATOR_BASE_CURRENCY_UNIT;

/**
 * Ethereum testnet configuration built around mock collateral assets and oracle feeds.
 * Tokens and feeds are deployed via the `deploy-mocks` helpers wired up to the MOCK_ONLY section.
 *
 * @param hre - Hardhat runtime environment
 */
export async function getConfig(hre: HardhatRuntimeEnvironment): Promise<Config> {
  const { deployer } = await hre.getNamedAccounts();

  const [
    dUSDDeployment,
    dETHDeployment,
    WETHDeployment,
    stETHDeployment,
    sfrxETHDeployment,
    rETHDeployment,
    USDCDeployment,
    USDTDeployment,
    USDSDeployment,
    sUSDSDeployment,
    frxUSDDeployment,
    sfrxUSDDeployment,
    fxUSDDeployment,
    fxSAVEDeployment,
    aUSDCDeployment,
    aUSDTDeployment,
  ] = await Promise.all([
    hre.deployments.getOrNull(DUSD_TOKEN_ID),
    hre.deployments.getOrNull(DETH_TOKEN_ID),
    hre.deployments.getOrNull("WETH"),
    hre.deployments.getOrNull("stETH"),
    hre.deployments.getOrNull("sfrxETH"),
    hre.deployments.getOrNull("rETH"),
    hre.deployments.getOrNull("USDC"),
    hre.deployments.getOrNull("USDT"),
    hre.deployments.getOrNull("USDS"),
    hre.deployments.getOrNull("sUSDS"),
    hre.deployments.getOrNull("frxUSD"),
    hre.deployments.getOrNull("sfrxUSD"),
    hre.deployments.getOrNull("fxUSD"),
    hre.deployments.getOrNull("fxSAVE"),
    hre.deployments.getOrNull("aUSDC"),
    hre.deployments.getOrNull("aUSDT"),
  ]);

  const mockOracleNameToAddress: Record<string, string> = {};
  const mockOracleAddressesDeployment = await hre.deployments.getOrNull("MockOracleNameToAddress");

  if (mockOracleAddressesDeployment?.linkedData) {
    Object.assign(mockOracleNameToAddress, mockOracleAddressesDeployment.linkedData as Record<string, string>);
  }

  const usdPlainRedstoneFeeds = {
    ...(WETHDeployment?.address && mockOracleNameToAddress["WETH_USD"]
      ? { [WETHDeployment.address]: mockOracleNameToAddress["WETH_USD"] }
      : {}),
    ...(dETHDeployment?.address && mockOracleNameToAddress["WETH_USD"]
      ? { [dETHDeployment.address]: mockOracleNameToAddress["WETH_USD"] }
      : {}),
  };

  const usdThresholdRedstoneFeeds = {
    ...(USDCDeployment?.address && mockOracleNameToAddress["USDC_USD"]
      ? {
          [USDCDeployment.address]: {
            feed: mockOracleNameToAddress["USDC_USD"],
            lowerThreshold: STABLE_THRESHOLD,
            fixedPrice: STABLE_THRESHOLD,
          },
        }
      : {}),
    ...(USDTDeployment?.address && mockOracleNameToAddress["USDT_USD"]
      ? {
          [USDTDeployment.address]: {
            feed: mockOracleNameToAddress["USDT_USD"],
            lowerThreshold: STABLE_THRESHOLD,
            fixedPrice: STABLE_THRESHOLD,
          },
        }
      : {}),
    ...(USDSDeployment?.address && mockOracleNameToAddress["USDS_USD"]
      ? {
          [USDSDeployment.address]: {
            feed: mockOracleNameToAddress["USDS_USD"],
            lowerThreshold: STABLE_THRESHOLD,
            fixedPrice: STABLE_THRESHOLD,
          },
        }
      : {}),
    ...(frxUSDDeployment?.address && mockOracleNameToAddress["frxUSD_USD"]
      ? {
          [frxUSDDeployment.address]: {
            feed: mockOracleNameToAddress["frxUSD_USD"],
            lowerThreshold: STABLE_THRESHOLD,
            fixedPrice: STABLE_THRESHOLD,
          },
        }
      : {}),
    ...(fxUSDDeployment?.address && mockOracleNameToAddress["fxUSD_USD"]
      ? {
          [fxUSDDeployment.address]: {
            feed: mockOracleNameToAddress["fxUSD_USD"],
            lowerThreshold: STABLE_THRESHOLD,
            fixedPrice: STABLE_THRESHOLD,
          },
        }
      : {}),
    ...(aUSDCDeployment?.address && mockOracleNameToAddress["aUSDC_USD"]
      ? {
          [aUSDCDeployment.address]: {
            feed: mockOracleNameToAddress["aUSDC_USD"],
            lowerThreshold: STABLE_THRESHOLD,
            fixedPrice: STABLE_THRESHOLD,
          },
        }
      : {}),
    ...(aUSDTDeployment?.address && mockOracleNameToAddress["aUSDT_USD"]
      ? {
          [aUSDTDeployment.address]: {
            feed: mockOracleNameToAddress["aUSDT_USD"],
            lowerThreshold: STABLE_THRESHOLD,
            fixedPrice: STABLE_THRESHOLD,
          },
        }
      : {}),
  };

  const usdCompositeRedstoneFeeds = {
    ...(sUSDSDeployment?.address && mockOracleNameToAddress["sUSDS_USDS"] && mockOracleNameToAddress["USDS_USD"]
      ? {
          [sUSDSDeployment.address]: {
            feedAsset: sUSDSDeployment.address,
            feed1: mockOracleNameToAddress["sUSDS_USDS"],
            feed2: mockOracleNameToAddress["USDS_USD"],
            lowerThresholdInBase1: 0n,
            fixedPriceInBase1: 0n,
            lowerThresholdInBase2: STABLE_THRESHOLD,
            fixedPriceInBase2: STABLE_THRESHOLD,
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
            lowerThresholdInBase2: STABLE_THRESHOLD,
            fixedPriceInBase2: STABLE_THRESHOLD,
          },
        }
      : {}),
    ...(fxSAVEDeployment?.address && mockOracleNameToAddress["fxSAVE_fxUSD"] && mockOracleNameToAddress["fxUSD_USD"]
      ? {
          [fxSAVEDeployment.address]: {
            feedAsset: fxSAVEDeployment.address,
            feed1: mockOracleNameToAddress["fxSAVE_fxUSD"],
            feed2: mockOracleNameToAddress["fxUSD_USD"],
            lowerThresholdInBase1: 0n,
            fixedPriceInBase1: 0n,
            lowerThresholdInBase2: STABLE_THRESHOLD,
            fixedPriceInBase2: STABLE_THRESHOLD,
          },
        }
      : {}),
  };

  const usdChainlinkWrapperAssets = {
    ...(USDCDeployment?.address && mockOracleNameToAddress["USDC_USD"]
      ? {
          [USDCDeployment.address]: {
            feed: mockOracleNameToAddress["USDC_USD"],
            heartbeat: DEFAULT_ORACLE_HEARTBEAT_SECONDS,
            maxDeviationBps: 200,
          },
        }
      : {}),
    ...(USDTDeployment?.address && mockOracleNameToAddress["USDT_USD"]
      ? {
          [USDTDeployment.address]: {
            feed: mockOracleNameToAddress["USDT_USD"],
            heartbeat: DEFAULT_ORACLE_HEARTBEAT_SECONDS,
            maxDeviationBps: 200,
          },
        }
      : {}),
    ...(USDSDeployment?.address && mockOracleNameToAddress["USDS_USD"]
      ? {
          [USDSDeployment.address]: {
            feed: mockOracleNameToAddress["USDS_USD"],
            heartbeat: DEFAULT_ORACLE_HEARTBEAT_SECONDS,
            maxDeviationBps: 200,
          },
        }
      : {}),
    ...(frxUSDDeployment?.address && mockOracleNameToAddress["frxUSD_USD"]
      ? {
          [frxUSDDeployment.address]: {
            feed: mockOracleNameToAddress["frxUSD_USD"],
            heartbeat: DEFAULT_ORACLE_HEARTBEAT_SECONDS,
            maxDeviationBps: 200,
          },
        }
      : {}),
    ...(fxUSDDeployment?.address && mockOracleNameToAddress["fxUSD_USD"]
      ? {
          [fxUSDDeployment.address]: {
            feed: mockOracleNameToAddress["fxUSD_USD"],
            heartbeat: DEFAULT_ORACLE_HEARTBEAT_SECONDS,
            maxDeviationBps: 250,
          },
        }
      : {}),
    ...(aUSDCDeployment?.address && mockOracleNameToAddress["aUSDC_USD"]
      ? {
          [aUSDCDeployment.address]: {
            feed: mockOracleNameToAddress["aUSDC_USD"],
            heartbeat: DEFAULT_ORACLE_HEARTBEAT_SECONDS,
            maxDeviationBps: 250,
          },
        }
      : {}),
    ...(aUSDTDeployment?.address && mockOracleNameToAddress["aUSDT_USD"]
      ? {
          [aUSDTDeployment.address]: {
            feed: mockOracleNameToAddress["aUSDT_USD"],
            heartbeat: DEFAULT_ORACLE_HEARTBEAT_SECONDS,
            maxDeviationBps: 250,
          },
        }
      : {}),
    ...(WETHDeployment?.address && mockOracleNameToAddress["WETH_USD"]
      ? {
          [WETHDeployment.address]: {
            feed: mockOracleNameToAddress["WETH_USD"],
            heartbeat: DEFAULT_ORACLE_HEARTBEAT_SECONDS,
            maxDeviationBps: 1000,
          },
        }
      : {}),
    ...(dETHDeployment?.address && mockOracleNameToAddress["WETH_USD"]
      ? {
          [dETHDeployment.address]: {
            feed: mockOracleNameToAddress["WETH_USD"],
            heartbeat: DEFAULT_ORACLE_HEARTBEAT_SECONDS,
            maxDeviationBps: 1000,
          },
        }
      : {}),
  };

  const usdCompositeWrapperAssets = {
    ...(sUSDSDeployment?.address && mockOracleNameToAddress["USDS_USD"] && mockOracleNameToAddress["sUSDS_USDS"]
      ? {
          [sUSDSDeployment.address]: {
            priceFeed: mockOracleNameToAddress["USDS_USD"],
            rateFeed: mockOracleNameToAddress["sUSDS_USDS"],
            rateDecimals: 18,
            priceHeartbeat: DEFAULT_ORACLE_HEARTBEAT_SECONDS,
            rateHeartbeat: DEFAULT_ORACLE_HEARTBEAT_SECONDS,
            maxDeviationBps: 300,
          },
        }
      : {}),
    ...(sfrxUSDDeployment?.address && mockOracleNameToAddress["frxUSD_USD"] && mockOracleNameToAddress["sfrxUSD_frxUSD"]
      ? {
          [sfrxUSDDeployment.address]: {
            priceFeed: mockOracleNameToAddress["frxUSD_USD"],
            rateFeed: mockOracleNameToAddress["sfrxUSD_frxUSD"],
            rateDecimals: 18,
            priceHeartbeat: DEFAULT_ORACLE_HEARTBEAT_SECONDS,
            rateHeartbeat: DEFAULT_ORACLE_HEARTBEAT_SECONDS,
            maxDeviationBps: 300,
          },
        }
      : {}),
    ...(fxSAVEDeployment?.address && mockOracleNameToAddress["fxUSD_USD"] && mockOracleNameToAddress["fxSAVE_fxUSD"]
      ? {
          [fxSAVEDeployment.address]: {
            priceFeed: mockOracleNameToAddress["fxUSD_USD"],
            rateFeed: mockOracleNameToAddress["fxSAVE_fxUSD"],
            rateDecimals: 18,
            priceHeartbeat: DEFAULT_ORACLE_HEARTBEAT_SECONDS,
            rateHeartbeat: DEFAULT_ORACLE_HEARTBEAT_SECONDS,
            maxDeviationBps: 350,
          },
        }
      : {}),
  };

  const usdOracleRouting = {
    ...(USDCDeployment?.address
      ? {
          [USDCDeployment.address]: {
            primaryWrapperId: "USD_ChainlinkWrapperV1_1",
            risk: { maxDeviationBps: 200 },
          },
        }
      : {}),
    ...(USDTDeployment?.address
      ? {
          [USDTDeployment.address]: {
            primaryWrapperId: "USD_ChainlinkWrapperV1_1",
            risk: { maxDeviationBps: 200 },
          },
        }
      : {}),
    ...(USDSDeployment?.address
      ? {
          [USDSDeployment.address]: {
            primaryWrapperId: "USD_ChainlinkWrapperV1_1",
            risk: { maxDeviationBps: 200 },
          },
        }
      : {}),
    ...(frxUSDDeployment?.address
      ? {
          [frxUSDDeployment.address]: {
            primaryWrapperId: "USD_ChainlinkWrapperV1_1",
            risk: { maxDeviationBps: 200 },
          },
        }
      : {}),
    ...(fxUSDDeployment?.address
      ? {
          [fxUSDDeployment.address]: {
            primaryWrapperId: "USD_ChainlinkWrapperV1_1",
            risk: { maxDeviationBps: 250 },
          },
        }
      : {}),
    ...(aUSDCDeployment?.address
      ? {
          [aUSDCDeployment.address]: {
            primaryWrapperId: "USD_ChainlinkWrapperV1_1",
            risk: { maxDeviationBps: 250 },
          },
        }
      : {}),
    ...(aUSDTDeployment?.address
      ? {
          [aUSDTDeployment.address]: {
            primaryWrapperId: "USD_ChainlinkWrapperV1_1",
            risk: { maxDeviationBps: 250 },
          },
        }
      : {}),
    ...(WETHDeployment?.address
      ? {
          [WETHDeployment.address]: {
            primaryWrapperId: "USD_ChainlinkWrapperV1_1",
            risk: { maxDeviationBps: 1000 },
          },
        }
      : {}),
    ...(dETHDeployment?.address
      ? {
          [dETHDeployment.address]: {
            primaryWrapperId: "USD_ChainlinkWrapperV1_1",
            risk: { maxDeviationBps: 1000 },
          },
        }
      : {}),
    ...(sUSDSDeployment?.address
      ? {
          [sUSDSDeployment.address]: {
            primaryWrapperId: "USD_ChainlinkRateCompositeWrapperV1_1",
            risk: { maxDeviationBps: 300 },
          },
        }
      : {}),
    ...(sfrxUSDDeployment?.address
      ? {
          [sfrxUSDDeployment.address]: {
            primaryWrapperId: "USD_ChainlinkRateCompositeWrapperV1_1",
            risk: { maxDeviationBps: 300 },
          },
        }
      : {}),
    ...(fxSAVEDeployment?.address
      ? {
          [fxSAVEDeployment.address]: {
            primaryWrapperId: "USD_ChainlinkRateCompositeWrapperV1_1",
            risk: { maxDeviationBps: 350 },
          },
        }
      : {}),
  };

  const ethPlainRedstoneFeeds = {
    ...(stETHDeployment?.address && mockOracleNameToAddress["stETH_WETH"]
      ? { [stETHDeployment.address]: mockOracleNameToAddress["stETH_WETH"] }
      : {}),
    ...(sfrxETHDeployment?.address && mockOracleNameToAddress["sfrxETH_WETH"]
      ? { [sfrxETHDeployment.address]: mockOracleNameToAddress["sfrxETH_WETH"] }
      : {}),
    ...(rETHDeployment?.address && mockOracleNameToAddress["rETH_WETH"]
      ? { [rETHDeployment.address]: mockOracleNameToAddress["rETH_WETH"] }
      : {}),
  };

  const ethChainlinkWrapperAssets = {
    ...(stETHDeployment?.address && mockOracleNameToAddress["stETH_WETH"]
      ? {
          [stETHDeployment.address]: {
            feed: mockOracleNameToAddress["stETH_WETH"],
            heartbeat: DEFAULT_ORACLE_HEARTBEAT_SECONDS,
            maxDeviationBps: 500,
          },
        }
      : {}),
    ...(sfrxETHDeployment?.address && mockOracleNameToAddress["sfrxETH_WETH"]
      ? {
          [sfrxETHDeployment.address]: {
            feed: mockOracleNameToAddress["sfrxETH_WETH"],
            heartbeat: DEFAULT_ORACLE_HEARTBEAT_SECONDS,
            maxDeviationBps: 500,
          },
        }
      : {}),
    ...(rETHDeployment?.address && mockOracleNameToAddress["rETH_WETH"]
      ? {
          [rETHDeployment.address]: {
            feed: mockOracleNameToAddress["rETH_WETH"],
            heartbeat: DEFAULT_ORACLE_HEARTBEAT_SECONDS,
            maxDeviationBps: 500,
          },
        }
      : {}),
  };

  const ethOracleRouting = {
    ...(stETHDeployment?.address
      ? {
          [stETHDeployment.address]: {
            primaryWrapperId: "ETH_ChainlinkWrapperV1_1",
            risk: { maxDeviationBps: 500 },
          },
        }
      : {}),
    ...(sfrxETHDeployment?.address
      ? {
          [sfrxETHDeployment.address]: {
            primaryWrapperId: "ETH_ChainlinkWrapperV1_1",
            risk: { maxDeviationBps: 500 },
          },
        }
      : {}),
    ...(rETHDeployment?.address
      ? {
          [rETHDeployment.address]: {
            primaryWrapperId: "ETH_ChainlinkWrapperV1_1",
            risk: { maxDeviationBps: 500 },
          },
        }
      : {}),
  };

  const governanceAddress = deployer ?? ZeroAddress;

  const dUSDCollateralFees: Record<string, number> = {};
  const dETHCollateralFees: Record<string, number> = {};

  addCollateralFee(dUSDCollateralFees, USDCDeployment?.address, 0.4 * ONE_PERCENT_BPS);
  addCollateralFee(dUSDCollateralFees, USDTDeployment?.address, 0.4 * ONE_PERCENT_BPS);
  addCollateralFee(dUSDCollateralFees, USDSDeployment?.address, 0.4 * ONE_PERCENT_BPS);
  addCollateralFee(dUSDCollateralFees, frxUSDDeployment?.address, 0.4 * ONE_PERCENT_BPS);
  addCollateralFee(dUSDCollateralFees, fxUSDDeployment?.address, 0.4 * ONE_PERCENT_BPS);
  addCollateralFee(dUSDCollateralFees, aUSDCDeployment?.address, 0.4 * ONE_PERCENT_BPS);
  addCollateralFee(dUSDCollateralFees, aUSDTDeployment?.address, 0.4 * ONE_PERCENT_BPS);
  addCollateralFee(dUSDCollateralFees, sUSDSDeployment?.address, 0.5 * ONE_PERCENT_BPS);
  addCollateralFee(dUSDCollateralFees, sfrxUSDDeployment?.address, 0.5 * ONE_PERCENT_BPS);
  addCollateralFee(dUSDCollateralFees, fxSAVEDeployment?.address, 0.5 * ONE_PERCENT_BPS);

  addCollateralFee(dETHCollateralFees, WETHDeployment?.address, 0.4 * ONE_PERCENT_BPS);
  addCollateralFee(dETHCollateralFees, stETHDeployment?.address, 0.5 * ONE_PERCENT_BPS);
  addCollateralFee(dETHCollateralFees, sfrxETHDeployment?.address, 0.5 * ONE_PERCENT_BPS);
  addCollateralFee(dETHCollateralFees, rETHDeployment?.address, 0.5 * ONE_PERCENT_BPS);

  return {
    MOCK_ONLY: {
      tokens: {
        USDC: {
          name: "USD Coin",
          address: USDCDeployment?.address,
          decimals: 6,
          initialSupply: 1_000_000,
        },
        USDT: {
          name: "Tether USD",
          address: USDTDeployment?.address,
          decimals: 6,
          initialSupply: 1_000_000,
        },
        USDS: {
          name: "USDS",
          address: USDSDeployment?.address,
          decimals: 18,
          initialSupply: 1_000_000,
        },
        sUSDS: {
          name: "Staked USDS",
          address: sUSDSDeployment?.address,
          decimals: 18,
          initialSupply: 1_000_000,
        },
        frxUSD: {
          name: "Frax USD",
          address: frxUSDDeployment?.address,
          decimals: 18,
          initialSupply: 1_000_000,
        },
        sfrxUSD: {
          name: "Staked Frax USD",
          address: sfrxUSDDeployment?.address,
          decimals: 18,
          initialSupply: 1_000_000,
        },
        fxUSD: {
          name: "Flux USD",
          address: fxUSDDeployment?.address,
          decimals: 18,
          initialSupply: 1_000_000,
        },
        fxSAVE: {
          name: "Flux Save",
          address: fxSAVEDeployment?.address,
          decimals: 18,
          initialSupply: 1_000_000,
        },
        aUSDC: {
          name: "Aave aUSDC",
          address: aUSDCDeployment?.address,
          decimals: 6,
          initialSupply: 1_000_000,
        },
        aUSDT: {
          name: "Aave aUSDT",
          address: aUSDTDeployment?.address,
          decimals: 6,
          initialSupply: 1_000_000,
        },
        WETH: {
          name: "Wrapped Ether",
          address: WETHDeployment?.address,
          decimals: 18,
          initialSupply: 1_000_000,
        },
        stETH: {
          name: "Lido Staked Ether",
          address: stETHDeployment?.address,
          decimals: 18,
          initialSupply: 1_000_000,
        },
        sfrxETH: {
          name: "Staked Frax Ether",
          address: sfrxETHDeployment?.address,
          decimals: 18,
          initialSupply: 1_000_000,
        },
        rETH: {
          name: "Rocket Pool Ether",
          address: rETHDeployment?.address,
          decimals: 18,
          initialSupply: 1_000_000,
        },
      },
      curvePools: {},
    },
    tokenAddresses: {
      WETH: stringOrEmpty(WETHDeployment?.address),
      dUSD: stringOrEmpty(dUSDDeployment?.address),
      dETH: stringOrEmpty(dETHDeployment?.address),
      dS: stringOrEmpty(dETHDeployment?.address),
      USDC: stringOrEmpty(USDCDeployment?.address),
      USDT: stringOrEmpty(USDTDeployment?.address),
      USDS: stringOrEmpty(USDSDeployment?.address),
      sUSDS: stringOrEmpty(sUSDSDeployment?.address),
      frxUSD: stringOrEmpty(frxUSDDeployment?.address),
      sfrxUSD: stringOrEmpty(sfrxUSDDeployment?.address),
      fxUSD: stringOrEmpty(fxUSDDeployment?.address),
      fxSAVE: stringOrEmpty(fxSAVEDeployment?.address),
      aUSDC: stringOrEmpty(aUSDCDeployment?.address),
      aUSDT: stringOrEmpty(aUSDTDeployment?.address),
      stETH: stringOrEmpty(stETHDeployment?.address),
      sfrxETH: stringOrEmpty(sfrxETHDeployment?.address),
      rETH: stringOrEmpty(rETHDeployment?.address),
    },
    walletAddresses: {
      governanceMultisig: governanceAddress,
      incentivesVault: governanceAddress,
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
        wrappers: {
          ...(Object.keys(usdChainlinkWrapperAssets).length > 0
            ? {
                chainlink: {
                  deploymentId: "USD_ChainlinkWrapperV1_1",
                  assets: usdChainlinkWrapperAssets,
                },
              }
            : {}),
          ...(Object.keys(usdCompositeWrapperAssets).length > 0
            ? {
                rateComposite: {
                  deploymentId: "USD_ChainlinkRateCompositeWrapperV1_1",
                  assets: usdCompositeWrapperAssets,
                },
              }
            : {}),
        },
        assets: usdOracleRouting,
      },
      ETH: {
        priceDecimals: ORACLE_AGGREGATOR_PRICE_DECIMALS,
        hardDStablePeg: ORACLE_AGGREGATOR_BASE_CURRENCY_UNIT,
        baseCurrency: addressOrZero(WETHDeployment?.address),
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
        wrappers: {
          ...(Object.keys(ethChainlinkWrapperAssets).length > 0
            ? {
                chainlink: {
                  deploymentId: "ETH_ChainlinkWrapperV1_1",
                  assets: ethChainlinkWrapperAssets,
                },
              }
            : {}),
        },
        assets: ethOracleRouting,
      },
    },
    dStables: {
      dUSD: {
        collaterals: [
          addressOrZero(USDCDeployment?.address),
          addressOrZero(USDTDeployment?.address),
          addressOrZero(USDSDeployment?.address),
          addressOrZero(sUSDSDeployment?.address),
          addressOrZero(frxUSDDeployment?.address),
          addressOrZero(sfrxUSDDeployment?.address),
          addressOrZero(fxUSDDeployment?.address),
          addressOrZero(fxSAVEDeployment?.address),
          addressOrZero(aUSDCDeployment?.address),
          addressOrZero(aUSDTDeployment?.address),
        ],
        initialFeeReceiver: governanceAddress,
        initialRedemptionFeeBps: 0.4 * ONE_PERCENT_BPS,
        collateralRedemptionFees: dUSDCollateralFees,
      },
      dETH: {
        collaterals: [
          addressOrZero(WETHDeployment?.address),
          addressOrZero(stETHDeployment?.address),
          addressOrZero(sfrxETHDeployment?.address),
          addressOrZero(rETHDeployment?.address),
        ],
        initialFeeReceiver: governanceAddress,
        initialRedemptionFeeBps: 0.4 * ONE_PERCENT_BPS,
        collateralRedemptionFees: dETHCollateralFees,
      },
      dS: {
        collaterals: [
          addressOrZero(WETHDeployment?.address),
          addressOrZero(stETHDeployment?.address),
          addressOrZero(sfrxETHDeployment?.address),
          addressOrZero(rETHDeployment?.address),
        ],
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
        dUSD: strategyDUSD,
        sfrxETH: strategySFRXETH,
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
 * Returns the provided address or the canonical zero address when undefined.
 *
 * @param value - Address string to normalise.
 */
function addressOrZero(value: string | undefined): string {
  return value ?? ZeroAddress;
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
