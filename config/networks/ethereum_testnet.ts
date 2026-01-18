import "hardhat-deploy/dist/src/type-extensions";

import { ZeroAddress } from "ethers";
import type { HardhatRuntimeEnvironment } from "hardhat/types";

import { ONE_HUNDRED_PERCENT_BPS, ONE_PERCENT_BPS } from "../../typescript/common/bps_constants";
import {
  DETH_A_TOKEN_WRAPPER_ID,
  DETH_TOKEN_ID,
  DUSD_A_TOKEN_WRAPPER_ID,
  DUSD_TOKEN_ID,
  INCENTIVES_PROXY_ID,
} from "../../typescript/deploy-ids";
import { ORACLE_AGGREGATOR_BASE_CURRENCY_UNIT, ORACLE_AGGREGATOR_PRICE_DECIMALS } from "../../typescript/oracle_aggregator/constants";
import {
  rateStrategyBorrowDStable,
  rateStrategyHighLiquidityStable,
  rateStrategyHighLiquidityVolatile,
} from "../dlend/interest-rate-strategies";
import { strategyDETH, strategyDUSD, strategyFRXETH, strategySFRXETH } from "../dlend/reserves-params";
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
    frxETHDeployment,
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
    dLendATokenWrapperDUSDDeployment,
    dLendATokenWrapperDETHDeployment,
    idleVaultSdUSDDeployment,
    idleVaultSdETHDeployment,
    incentivesProxyDeployment,
    aTokenDUSDDeployment,
    aTokenDETHDeployment,
  ] = await Promise.all([
    hre.deployments.getOrNull(DUSD_TOKEN_ID),
    hre.deployments.getOrNull(DETH_TOKEN_ID),
    hre.deployments.getOrNull("WETH"),
    hre.deployments.getOrNull("stETH"),
    hre.deployments.getOrNull("frxETH"),
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
    hre.deployments.getOrNull(DUSD_A_TOKEN_WRAPPER_ID),
    hre.deployments.getOrNull(DETH_A_TOKEN_WRAPPER_ID),
    hre.deployments.getOrNull("DStakeIdleVault_sdUSD"),
    hre.deployments.getOrNull("DStakeIdleVault_sdETH"),
    hre.deployments.getOrNull(INCENTIVES_PROXY_ID),
    hre.deployments.getOrNull("dUSDAToken"),
    hre.deployments.getOrNull("dETHAToken"),
  ]);

  const mockOracleNameToAddress: Record<string, string> = {};
  const mockOracleAddressesDeployment = await hre.deployments.getOrNull("MockOracleNameToAddress");
  const mockEtherRouter = await hre.deployments.getOrNull("MockFraxEtherRouter");
  const mockRedemptionQueue = await hre.deployments.getOrNull("MockFraxRedemptionQueueV2");

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

  const governanceAddress = deployer ?? ZeroAddress;
  const sdUSDDefaultStrategyShare = idleVaultSdUSDDeployment?.address ?? dLendATokenWrapperDUSDDeployment?.address ?? "";
  const sdETHDefaultStrategyShare = idleVaultSdETHDeployment?.address ?? dLendATokenWrapperDETHDeployment?.address ?? "";
  // NOTE: dStake roles (admin, fee manager, collateral exchangers) are initialized to the deployer
  // during deployment and must be migrated to governance via separate transactions after deployment.
  const dstakeAdmin = deployer ?? "";

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
  addCollateralFee(dETHCollateralFees, frxETHDeployment?.address, 0.5 * ONE_PERCENT_BPS);
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
        frxETH: {
          name: "Frax Ether",
          address: frxETHDeployment?.address,
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
      frxETH: stringOrEmpty(frxETHDeployment?.address),
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
        chainlinkErc4626OracleAssets: {},
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
        baseCurrency: addressOrZero(WETHDeployment?.address),
        chainlinkErc4626OracleAssets: {},
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
        frxEthFundamentalOracle: {
          asset: addressOrZero(frxETHDeployment?.address),
          etherRouter: addressOrZero(mockEtherRouter?.address),
          redemptionQueue: addressOrZero(mockRedemptionQueue?.address),
        },
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
          addressOrZero(frxETHDeployment?.address),
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
          addressOrZero(frxETHDeployment?.address),
          addressOrZero(sfrxETHDeployment?.address),
          addressOrZero(rETHDeployment?.address),
        ],
        initialFeeReceiver: governanceAddress,
        initialRedemptionFeeBps: 0.4 * ONE_PERCENT_BPS,
        collateralRedemptionFees: dETHCollateralFees,
      },
    },
    dStake: {
      sdUSD: {
        dStable: stringOrEmpty(dUSDDeployment?.address),
        name: "Staked dUSD",
        symbol: "sdUSD",
        initialWithdrawalFeeBps: 10,
        adapters: [
          {
            strategyShare: stringOrEmpty(dLendATokenWrapperDUSDDeployment?.address),
            adapterContract: "WrappedDLendConversionAdapter",
            vaultAsset: stringOrEmpty(dLendATokenWrapperDUSDDeployment?.address),
            targetBps: ONE_HUNDRED_PERCENT_BPS,
          },
        ],
        defaultDepositStrategyShare: stringOrEmpty(sdUSDDefaultStrategyShare),
        defaultDepositVaultAsset: stringOrEmpty(dLendATokenWrapperDUSDDeployment?.address),
        collateralVault: "DStakeCollateralVaultV2_sdUSD",
        idleVault: {
          rewardManager: dstakeAdmin || governanceAddress,
        },
        dLendRewardManager: {
          managedStrategyShare: stringOrEmpty(dLendATokenWrapperDUSDDeployment?.address),
          dLendAssetToClaimFor: stringOrEmpty(aTokenDUSDDeployment?.address),
          dLendRewardsController: stringOrEmpty(incentivesProxyDeployment?.address),
          treasury: dstakeAdmin || governanceAddress,
          maxTreasuryFeeBps: 5 * ONE_PERCENT_BPS,
          initialTreasuryFeeBps: 1 * ONE_PERCENT_BPS,
          initialExchangeThreshold: 1_000_000n,
          initialAdmin: dstakeAdmin || governanceAddress,
          initialRewardsManager: dstakeAdmin || governanceAddress,
        },
      },
      sdETH: {
        dStable: stringOrEmpty(dETHDeployment?.address),
        name: "Staked dETH",
        symbol: "sdETH",
        initialWithdrawalFeeBps: 10,
        adapters: [
          {
            strategyShare: stringOrEmpty(dLendATokenWrapperDETHDeployment?.address),
            adapterContract: "WrappedDLendConversionAdapter",
            vaultAsset: stringOrEmpty(dLendATokenWrapperDETHDeployment?.address),
            targetBps: ONE_HUNDRED_PERCENT_BPS,
          },
        ],
        defaultDepositStrategyShare: stringOrEmpty(sdETHDefaultStrategyShare),
        defaultDepositVaultAsset: stringOrEmpty(dLendATokenWrapperDETHDeployment?.address),
        collateralVault: "DStakeCollateralVaultV2_sdETH",
        idleVault: {
          rewardManager: dstakeAdmin || governanceAddress,
        },
        dLendRewardManager: {
          managedStrategyShare: stringOrEmpty(dLendATokenWrapperDETHDeployment?.address),
          dLendAssetToClaimFor: stringOrEmpty(aTokenDETHDeployment?.address),
          dLendRewardsController: stringOrEmpty(incentivesProxyDeployment?.address),
          treasury: dstakeAdmin || governanceAddress,
          maxTreasuryFeeBps: 5 * ONE_PERCENT_BPS,
          initialTreasuryFeeBps: 1 * ONE_PERCENT_BPS,
          initialExchangeThreshold: 1n * 10n ** 18n,
          initialAdmin: dstakeAdmin || governanceAddress,
          initialRewardsManager: dstakeAdmin || governanceAddress,
        },
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
        sfrxETH: strategySFRXETH,
        frxETH: strategyFRXETH,
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
