import { Address } from "hardhat-deploy/types";

import { SafeConfig } from "../typescript/safe/types";
import { DLendConfig } from "./dlend/types";

export interface Config {
  readonly MOCK_ONLY?: MockConfig;
  readonly tokenAddresses: TokenAddresses;
  readonly walletAddresses: WalletAddresses;
  readonly safeConfig?: SafeConfig;
  readonly oracleAggregators: {
    [key: string]: OracleAggregatorConfig;
  };
  readonly dStables: {
    [key: string]: DStableConfig;
  };
  readonly dLend?: DLendConfig;
  readonly odos?: {
    readonly router: string;
  };
  readonly pendle?: PendleConfig;
  readonly dStake?: {
    [key: string]: DStakeInstanceConfig; // e.g., sdUSD, sdETH
  };
  readonly vesting?: VestingConfig;
  readonly morpho?: MorphoConfig;
}

// Configuration for mocking infrastructure on local and test networks
export interface MockConfig {
  readonly tokens: {
    [key: string]: {
      readonly name: string;
      readonly address?: string;
      readonly decimals: number;
      readonly initialSupply: number;
    };
  };
  readonly curvePools: {
    [key: string]: {
      readonly name: string;
      readonly token0: string;
      readonly token1: string;
      readonly fee: number;
    };
  };
}

export interface DStableConfig {
  readonly collaterals: Address[];
  readonly initialFeeReceiver?: string;
  readonly initialRedemptionFeeBps?: number;
  readonly collateralRedemptionFees?: {
    [collateralAddress: string]: number;
  };
}

export interface TokenAddresses {
  readonly WETH: string;
  readonly dUSD: string;
  readonly dETH: string;
  readonly [key: string]: string; // dLEND assets must be defined as well
}

export interface WalletAddresses {
  readonly governanceMultisig: string;
  readonly incentivesVault: string;
}

export interface OracleWrapperDeploymentConfig<TAssetConfig> {
  readonly deploymentId: string;
  readonly adminRole?: string;
  readonly assets?: {
    [assetAddress: string]: TAssetConfig;
  };
}

export interface ChainlinkFeedMockConfig {
  readonly id?: string;
  readonly description?: string;
  readonly decimals: number;
  readonly value: string;
  readonly timestampOffsetSeconds?: number;
}

export interface ChainlinkFeedAssetConfig {
  readonly feed?: string;
  readonly feedDeploymentId?: string;
  readonly heartbeat?: number;
  readonly maxStaleTime?: number;
  readonly maxDeviationBps?: number;
  readonly minAnswer?: bigint;
  readonly maxAnswer?: bigint;
  readonly mock?: ChainlinkFeedMockConfig;
}

export interface ChainlinkRateCompositeAssetConfig {
  readonly priceFeed: string; // Spot feed priced in the aggregator base currency (e.g. USDS/USD)
  readonly rateProvider?: string; // Optional on-chain rate provider; overrides rateFeed/mockRate if provided
  readonly rateProviderDeploymentId?: string; // Optional deployment id when auto-deploying mock rate providers
  readonly rateFeed?: string; // Optional feed used to derive the rate when no rateProvider is supplied (e.g. sUSDS/USDS)
  readonly priceFeedDecimals?: number; // Optional override for price feed decimals; defaults to on-chain value
  readonly rateFeedDecimals?: number; // Optional override for rate feed decimals; defaults to on-chain value
  readonly rateDecimals?: number; // Target decimals for the rate provider value (defaults to 18)
  readonly priceHeartbeat?: number; // Optional heartbeat override for the price feed
  readonly rateHeartbeat?: number; // Optional heartbeat override for the rate provider
  readonly maxStaleTime?: number;
  readonly maxDeviationBps?: number;
  readonly minAnswer?: bigint;
  readonly maxAnswer?: bigint;
  readonly mockRate?: {
    readonly value: string; // Fallback rate when neither rateProvider nor rateFeed set
    readonly decimals: number;
    readonly updatedAtOffsetSeconds?: number;
  };
}

export interface Api3FeedAssetConfig {
  readonly proxy?: string;
  readonly lowerThreshold?: bigint;
  readonly fixedPrice?: bigint;
  readonly mock?: {
    readonly id?: string;
    readonly description?: string;
    readonly decimals: number;
    readonly value: string;
    readonly timestampOffsetSeconds?: number;
  };
}

export interface HardPegAssetConfig {
  readonly pricePeg: bigint;
  readonly lowerGuard?: bigint;
  readonly upperGuard?: bigint;
}

export interface OracleAssetRiskConfig {
  readonly maxStaleTime?: number;
  readonly heartbeatOverride?: number;
  readonly maxDeviationBps?: number;
  readonly minAnswer?: bigint;
  readonly maxAnswer?: bigint;
}

export interface OracleAssetRouting {
  readonly primaryWrapperId: string;
  readonly fallbackWrapperId?: string;
  readonly risk?: OracleAssetRiskConfig;
}

export interface OracleAggregatorConfig {
  readonly priceDecimals: number;
  readonly hardDStablePeg: bigint;
  readonly baseCurrency: string;
  readonly api3OracleAssets: {
    plainApi3OracleWrappers: {
      [key: string]: string;
    };
    api3OracleWrappersWithThresholding: {
      [key: string]: {
        proxy: string;
        lowerThreshold: bigint;
        fixedPrice: bigint;
      };
    };
    compositeApi3OracleWrappersWithThresholding: {
      [key: string]: {
        feedAsset: string;
        proxy1: string;
        proxy2: string;
        lowerThresholdInBase1: bigint;
        fixedPriceInBase1: bigint;
        lowerThresholdInBase2: bigint;
        fixedPriceInBase2: bigint;
      };
    };
  };
  readonly redstoneOracleAssets: {
    plainRedstoneOracleWrappers: {
      [key: string]: string;
    };
    redstoneOracleWrappersWithThresholding: {
      [key: string]: {
        feed: string;
        lowerThreshold: bigint;
        fixedPrice: bigint;
      };
    };
    compositeRedstoneOracleWrappersWithThresholding: {
      [key: string]: {
        feedAsset: string;
        feed1: string;
        feed2: string;
        lowerThresholdInBase1: bigint;
        fixedPriceInBase1: bigint;
        lowerThresholdInBase2: bigint;
        fixedPriceInBase2: bigint;
      };
    };
  };
  readonly chainlinkCompositeAggregator?: {
    [assetAddress: string]: ChainlinkCompositeAggregatorConfig;
  };
  readonly wrappers?: {
    chainlink?: OracleWrapperDeploymentConfig<ChainlinkFeedAssetConfig>;
    api3?: OracleWrapperDeploymentConfig<Api3FeedAssetConfig>;
    rateComposite?: OracleWrapperDeploymentConfig<ChainlinkRateCompositeAssetConfig>;
    hardPeg?: OracleWrapperDeploymentConfig<HardPegAssetConfig>;
  };
  readonly assets?: {
    [assetAddress: string]: OracleAssetRouting;
  };
  readonly roles?: {
    admins: string[];
    oracleManagers: string[];
    guardians: string[];
    globalMaxStaleTime: number;
  };
}

export interface IInterestRateStrategyParams {
  readonly name: string;
  readonly optimalUsageRatio: string;
  readonly baseVariableBorrowRate: string;
  readonly variableRateSlope1: string;
  readonly variableRateSlope2: string;
  readonly stableRateSlope1: string;
  readonly stableRateSlope2: string;
  readonly baseStableRateOffset: string;
  readonly stableRateExcessOffset: string;
  readonly optimalStableToTotalDebtRatio: string;
}

export interface IReserveBorrowParams {
  readonly borrowingEnabled: boolean;
  readonly stableBorrowRateEnabled: boolean;
  readonly reserveDecimals: string;
  readonly borrowCap: string;
  readonly debtCeiling: string;
  readonly borrowableIsolation: boolean;
  readonly flashLoanEnabled: boolean;
}

export interface IReserveCollateralParams {
  readonly baseLTVAsCollateral: string;
  readonly liquidationThreshold: string;
  readonly liquidationBonus: string;
  readonly liquidationProtocolFee?: string;
}

export interface IReserveParams extends IReserveBorrowParams, IReserveCollateralParams {
  readonly aTokenImpl: string;
  readonly reserveFactor: string;
  readonly supplyCap: string;
  readonly strategy: IInterestRateStrategyParams;
}

// --- dStake Types ---

export interface DStakeAdapterConfig {
  readonly strategyShare: Address; // Address of the strategy share token (e.g., wddUSD)
  readonly adapterContract: string; // Contract name for deployment (e.g., dLendConversionAdapter)
  readonly vaultAsset?: Address; // Underlying asset handled by the adapter (if applicable)
  readonly targetBps?: number; // Optional allocation target in basis points (1e6 = 100%)
}

export interface DStakeIdleVaultConfig {
  readonly name?: string; // Optional name override for the idle vault token
  readonly symbol?: string; // Optional symbol override for the idle vault token
  readonly admin?: Address; // Optional admin override; defaults to the instance initialAdmin
  readonly rewardManager?: Address; // Optional reward manager override; defaults to admin
  readonly emissionStart?: number; // Optional initial emission start timestamp
  readonly emissionEnd?: number; // Optional initial emission end timestamp
  readonly emissionPerSecond?: string; // Optional initial emission rate (string to avoid precision issues)
}

export interface DLendRewardManagerConfig {
  readonly managedStrategyShare: Address; // Address of the StaticATokenLM wrapper this manager handles (e.g. wddUSD)
  readonly dLendAssetToClaimFor: Address; // Address of the underlying aToken in dLEND (e.g. aDUSD)
  readonly dLendRewardsController: Address; // Address of the dLEND RewardsController
  readonly treasury: Address; // Address for treasury fees
  readonly maxTreasuryFeeBps: number;
  readonly initialTreasuryFeeBps: number;
  readonly initialExchangeThreshold: bigint; // Min stable amount to trigger compounding
  readonly initialAdmin?: Address; // Optional: admin for this DStakeRewardManagerDLend instance
  readonly initialRewardsManager?: Address; // Optional: holder of REWARDS_MANAGER_ROLE for this instance
}

export interface DStakeInstanceConfig {
  readonly dStable: Address; // Address of the underlying stable token (e.g., dUSD, dETH)
  readonly name: string; // Name for DStakeTokenV2 (e.g., "Staked dUSD")
  readonly symbol: string; // Symbol for DStakeTokenV2 (e.g., "sdUSD")
  readonly initialAdmin: Address;
  readonly initialFeeManager: Address;
  readonly initialWithdrawalFeeBps: number;
  readonly adapters: DStakeAdapterConfig[]; // List of supported adapters/strategy shares
  readonly defaultDepositStrategyShare: Address; // Initial default strategy share for deposits
  readonly defaultDepositVaultAsset?: Address; // Asset used for vault deposits when configuring adapters
  readonly collateralExchangers: Address[]; // List of allowed exchanger addresses
  readonly collateralVault?: Address; // The DStakeCollateralVaultV2 for this instance (needed for adapter deployment)
  readonly dLendRewardManager?: DLendRewardManagerConfig; // Added for dLend rewards
  readonly idleVault?: DStakeIdleVaultConfig; // Optional idle vault configuration
}

export interface VestingConfig {
  readonly name: string; // Name of the NFT collection
  readonly symbol: string; // Symbol of the NFT collection
  readonly dstakeToken: Address; // Address of the dSTAKE token to vest
  readonly vestingPeriod: number; // Vesting period in seconds (e.g., 6 months)
  readonly maxTotalSupply: string; // Maximum total dSTAKE that can be deposited (as string for big numbers)
  readonly initialOwner: Address; // Initial owner of the vesting contract
  readonly minDepositThreshold: string; // Minimum total dSTAKE that must be deposited per deposit
}

// --- Pendle PT Token Types ---

export interface PTTokenConfig {
  readonly name: string; // Human-readable name (e.g., "PT-aUSDC-14AUG2025")
  readonly ptToken: Address; // PT token address
  readonly market: Address; // Pendle market address
  readonly oracleType: "PT_TO_ASSET" | "PT_TO_SY"; // Oracle pricing type
  readonly twapDuration: number; // TWAP duration in seconds (e.g., 900)
}

export interface PendleConfig {
  readonly ptYtLpOracleAddress: Address; // Universal Pendle PT/YT/LP Oracle address (0x9a9Fa8338dd5E5B2188006f1Cd2Ef26d921650C2)
  readonly ptTokens: PTTokenConfig[]; // List of PT tokens to configure
}

// --- Chainlink Composite Wrapper Types ---

export interface ChainlinkCompositeAggregatorConfig {
  readonly name: string; // Name of the composite wrapper (e.g., "OS_S_USD")
  readonly feedAsset: Address; // Address of the asset being priced (e.g., wOS address)
  readonly sourceFeed1: Address; // Address of the first Chainlink price feed (e.g., OS/S)
  readonly sourceFeed2: Address; // Address of the second Chainlink price feed (e.g., S/USD)
  readonly lowerThresholdInBase1: bigint; // Lower threshold for sourceFeed1 (e.g., 99000000n for 0.99)
  readonly fixedPriceInBase1: bigint; // Fixed price for sourceFeed1 when threshold is exceeded (e.g., 100000000n for 1.00)
  readonly lowerThresholdInBase2: bigint; // Lower threshold for sourceFeed2 (e.g., 98000000n for 0.98)
  readonly fixedPriceInBase2: bigint; // Fixed price for sourceFeed2 when threshold is exceeded (e.g., 100000000n for 1.00)
}

// --- Morpho Types ---

export interface MorphoMarketConfig {
  readonly name: string; // Human-readable name for the market
  readonly symbol: string; // Symbol for the vault token
  readonly loanToken: Address; // The token being supplied/borrowed (e.g., dUSD)
  readonly collateralToken: Address; // The collateral token (can be zero address for pure supply)
  readonly oracle: Address; // Oracle address for the market
  readonly irm: Address; // Interest rate model address
  readonly lltv: number; // Loan-to-value ratio (in basis points or as configured by Morpho)
}

export interface MorphoConfig {
  readonly morphoAddress: Address; // Address of the Morpho Blue contract
  readonly markets: {
    [key: string]: MorphoMarketConfig; // e.g., "dUSD_market"
  };
}
