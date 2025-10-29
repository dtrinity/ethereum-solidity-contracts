import "hardhat-deploy/dist/src/type-extensions";

import { ZeroAddress } from "ethers";
import type { HardhatRuntimeEnvironment } from "hardhat/types";

import { ONE_PERCENT_BPS } from "../../typescript/common/bps_constants";
import { DETH_HARD_PEG_ORACLE_WRAPPER_ID, DETH_TOKEN_ID, DUSD_HARD_PEG_ORACLE_WRAPPER_ID, DUSD_TOKEN_ID } from "../../typescript/deploy-ids";
import { ORACLE_AGGREGATOR_BASE_CURRENCY_UNIT, ORACLE_AGGREGATOR_PRICE_DECIMALS } from "../../typescript/oracle_aggregator/constants";
import { rateStrategyHighLiquidityStable, rateStrategyMediumLiquidityVolatile } from "../dlend/interest-rate-strategies";
import { strategyDUSD, strategySFRXETH } from "../dlend/reserves-params";
import type { HardPegAssetConfig, OracleAssetRouting } from "../types";
import { Config } from "../types";

const HARD_PEG_PRICE = ORACLE_AGGREGATOR_BASE_CURRENCY_UNIT;
const YIELD_BEARING_PRICE = (ORACLE_AGGREGATOR_BASE_CURRENCY_UNIT * 105n) / 100n;

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

  const usdHardPegAssets: HardPegAssetMap = {};
  const usdAssetRouting: AssetRoutingMap = {};
  const ethHardPegAssets: HardPegAssetMap = {};
  const ethAssetRouting: AssetRoutingMap = {};

  addHardPegAsset(usdHardPegAssets, usdAssetRouting, DUSD_HARD_PEG_ORACLE_WRAPPER_ID, dUSDDeployment?.address, HARD_PEG_PRICE);
  addHardPegAsset(usdHardPegAssets, usdAssetRouting, DUSD_HARD_PEG_ORACLE_WRAPPER_ID, USDCDeployment?.address, HARD_PEG_PRICE);
  addHardPegAsset(usdHardPegAssets, usdAssetRouting, DUSD_HARD_PEG_ORACLE_WRAPPER_ID, USDTDeployment?.address, HARD_PEG_PRICE);
  addHardPegAsset(usdHardPegAssets, usdAssetRouting, DUSD_HARD_PEG_ORACLE_WRAPPER_ID, USDSDeployment?.address, HARD_PEG_PRICE);
  addHardPegAsset(usdHardPegAssets, usdAssetRouting, DUSD_HARD_PEG_ORACLE_WRAPPER_ID, frxUSDDeployment?.address, HARD_PEG_PRICE);
  addHardPegAsset(usdHardPegAssets, usdAssetRouting, DUSD_HARD_PEG_ORACLE_WRAPPER_ID, fxUSDDeployment?.address, HARD_PEG_PRICE);
  addHardPegAsset(usdHardPegAssets, usdAssetRouting, DUSD_HARD_PEG_ORACLE_WRAPPER_ID, fxSAVEDeployment?.address, HARD_PEG_PRICE);
  addHardPegAsset(usdHardPegAssets, usdAssetRouting, DUSD_HARD_PEG_ORACLE_WRAPPER_ID, aUSDCDeployment?.address, HARD_PEG_PRICE);
  addHardPegAsset(usdHardPegAssets, usdAssetRouting, DUSD_HARD_PEG_ORACLE_WRAPPER_ID, aUSDTDeployment?.address, HARD_PEG_PRICE);
  addHardPegAsset(usdHardPegAssets, usdAssetRouting, DUSD_HARD_PEG_ORACLE_WRAPPER_ID, sUSDSDeployment?.address, YIELD_BEARING_PRICE);
  addHardPegAsset(usdHardPegAssets, usdAssetRouting, DUSD_HARD_PEG_ORACLE_WRAPPER_ID, sfrxUSDDeployment?.address, YIELD_BEARING_PRICE);
  addHardPegAsset(usdHardPegAssets, usdAssetRouting, DUSD_HARD_PEG_ORACLE_WRAPPER_ID, WETHDeployment?.address, HARD_PEG_PRICE);
  addHardPegAsset(usdHardPegAssets, usdAssetRouting, DUSD_HARD_PEG_ORACLE_WRAPPER_ID, dETHDeployment?.address, HARD_PEG_PRICE);
  addHardPegAsset(usdHardPegAssets, usdAssetRouting, DUSD_HARD_PEG_ORACLE_WRAPPER_ID, stETHDeployment?.address, YIELD_BEARING_PRICE);
  addHardPegAsset(usdHardPegAssets, usdAssetRouting, DUSD_HARD_PEG_ORACLE_WRAPPER_ID, sfrxETHDeployment?.address, YIELD_BEARING_PRICE);
  addHardPegAsset(usdHardPegAssets, usdAssetRouting, DUSD_HARD_PEG_ORACLE_WRAPPER_ID, rETHDeployment?.address, YIELD_BEARING_PRICE);

  addHardPegAsset(ethHardPegAssets, ethAssetRouting, DETH_HARD_PEG_ORACLE_WRAPPER_ID, WETHDeployment?.address, HARD_PEG_PRICE);
  addHardPegAsset(ethHardPegAssets, ethAssetRouting, DETH_HARD_PEG_ORACLE_WRAPPER_ID, dETHDeployment?.address, HARD_PEG_PRICE);
  addHardPegAsset(ethHardPegAssets, ethAssetRouting, DETH_HARD_PEG_ORACLE_WRAPPER_ID, stETHDeployment?.address, YIELD_BEARING_PRICE);
  addHardPegAsset(ethHardPegAssets, ethAssetRouting, DETH_HARD_PEG_ORACLE_WRAPPER_ID, sfrxETHDeployment?.address, YIELD_BEARING_PRICE);
  addHardPegAsset(ethHardPegAssets, ethAssetRouting, DETH_HARD_PEG_ORACLE_WRAPPER_ID, rETHDeployment?.address, YIELD_BEARING_PRICE);

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
          plainRedstoneOracleWrappers: {},
          redstoneOracleWrappersWithThresholding: {},
          compositeRedstoneOracleWrappersWithThresholding: {},
        },
        wrappers: {
          hardPeg: {
            deploymentId: DUSD_HARD_PEG_ORACLE_WRAPPER_ID,
            assets: usdHardPegAssets,
          },
        },
        assets: usdAssetRouting,
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
          plainRedstoneOracleWrappers: {},
          redstoneOracleWrappersWithThresholding: {},
          compositeRedstoneOracleWrappersWithThresholding: {},
        },
        wrappers: {
          hardPeg: {
            deploymentId: DETH_HARD_PEG_ORACLE_WRAPPER_ID,
            assets: ethHardPegAssets,
          },
        },
        assets: ethAssetRouting,
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

type HardPegAssetMap = Record<string, HardPegAssetConfig>;
type AssetRoutingMap = Record<string, OracleAssetRouting>;

/**
 * Adds a hard peg oracle configuration for the provided asset when the address is defined.
 *
 * @param assets - Mutable map of hard peg asset settings.
 * @param routing - Mutable map of oracle aggregator routing configuration.
 * @param wrapperId - Deployment id for the target hard peg wrapper.
 * @param address - Asset address to register.
 * @param pricePeg - Target price peg for the asset.
 * @param lowerGuard - Optional deviation lower guard.
 * @param upperGuard - Optional deviation upper guard.
 */
function addHardPegAsset(
  assets: HardPegAssetMap,
  routing: AssetRoutingMap,
  wrapperId: string,
  address: string | undefined,
  pricePeg: bigint,
  lowerGuard: bigint = 0n,
  upperGuard: bigint = 0n,
): void {
  if (!isNonZeroAddress(address)) {
    return;
  }

  assets[address] = {
    pricePeg,
    lowerGuard,
    upperGuard,
  };

  routing[address] = {
    primaryWrapperId: wrapperId,
    risk: {
      maxDeviationBps: 0,
    },
  };
}

/**
 * Returns true when the provided value is a non-zero address.
 *
 * @param value - Address candidate.
 */
function isNonZeroAddress(value: string | undefined): value is string {
  if (!value) {
    return false;
  }

  return value.toLowerCase() !== ZeroAddress.toLowerCase();
}
