import { BaseContract, ZeroAddress } from "ethers";
import { HardhatRuntimeEnvironment } from "hardhat/types";

import { Config } from "../../config/types";

export const ROLLOUT_COLLATERAL_SYMBOLS = [
  "WETH",
  "wstETH",
  "rETH",
  "sfrxETH",
  "sUSDe",
  "sUSDS",
  "syrupUSDC",
  "syrupUSDT",
  "sfrxUSD",
  "LBTC",
  "WBTC",
  "cbBTC",
  "PAXG",
] as const;

export const INIT_BATCH_ONE_SYMBOLS = ROLLOUT_COLLATERAL_SYMBOLS.slice(0, 7);
export const INIT_BATCH_TWO_SYMBOLS = ROLLOUT_COLLATERAL_SYMBOLS.slice(7);

export type DecodedReserveConfig = {
  ltv: bigint;
  liquidationThreshold: bigint;
  liquidationBonus: bigint;
  decimals: bigint;
  reserveFactor: bigint;
  active: boolean;
  frozen: boolean;
  borrowingEnabled: boolean;
  stableBorrowingEnabled: boolean;
  paused: boolean;
  borrowableInIsolation: boolean;
  siloedBorrowing: boolean;
  flashLoanEnabled: boolean;
  borrowCap: bigint;
  supplyCap: bigint;
  liquidationProtocolFee: bigint;
  eModeCategory: bigint;
  unbackedMintCap: bigint;
  debtCeiling: bigint;
};

export type PriceOracleLike = BaseContract & {
  getSourceOfAsset(asset: string): Promise<string>;
  getAssetPrice(asset: string): Promise<bigint>;
};

export type OracleReadinessParams = {
  hre: HardhatRuntimeEnvironment;
  signer: any;
  priceOracleAddress: string;
  priceOracle: PriceOracleLike;
  verifiedOracleAssets: Set<string>;
  expectedOracleAssets: Set<string>;
  symbol: string;
  asset: string;
  allowMissingWrapperWhenExpected?: boolean;
};

/**
 * Splits a list into smaller chunks.
 *
 * @param items Source list to split.
 * @param size Chunk size.
 */
export function chunkArray<T>(items: T[], size: number): T[][] {
  const chunks: T[][] = [];

  for (let i = 0; i < items.length; i += size) {
    chunks.push(items.slice(i, i + size));
  }

  return chunks;
}

/**
 * Normalizes an address or symbol for case-insensitive comparisons.
 *
 * @param value Value to normalize.
 */
export function normalize(value: string): string {
  return value.trim().toLowerCase();
}

/**
 * Returns a deduplicated list while preserving input order.
 *
 * @param values Source values.
 */
export function uniqueValues(values: string[]): string[] {
  const seen = new Set<string>();
  const out: string[] = [];

  for (const value of values) {
    const normalized = normalize(value);

    if (seen.has(normalized)) {
      continue;
    }

    seen.add(normalized);
    out.push(value);
  }

  return out;
}

/**
 * Returns a normalized symbol key.
 *
 * @param value Symbol value.
 */
export function normalizeSymbol(value: string): string {
  return normalize(value);
}

/**
 * Reads one slice from the packed reserve bitmap.
 *
 * @param value Packed bitmap.
 * @param start Start bit.
 * @param width Width in bits.
 */
export function bit(value: bigint, start: bigint, width = 1n): bigint {
  return (value >> start) & ((1n << width) - 1n);
}

/**
 * Decodes a raw reserve configuration bitmap.
 *
 * @param data Packed reserve config.
 */
export function decodeReserveConfig(data: bigint): DecodedReserveConfig {
  return {
    ltv: bit(data, 0n, 16n),
    liquidationThreshold: bit(data, 16n, 16n),
    liquidationBonus: bit(data, 32n, 16n),
    decimals: bit(data, 48n, 8n),
    active: bit(data, 56n) === 1n,
    frozen: bit(data, 57n) === 1n,
    borrowingEnabled: bit(data, 58n) === 1n,
    stableBorrowingEnabled: bit(data, 59n) === 1n,
    paused: bit(data, 60n) === 1n,
    borrowableInIsolation: bit(data, 61n) === 1n,
    siloedBorrowing: bit(data, 62n) === 1n,
    flashLoanEnabled: bit(data, 63n) === 1n,
    reserveFactor: bit(data, 64n, 16n),
    borrowCap: bit(data, 80n, 36n),
    supplyCap: bit(data, 116n, 36n),
    liquidationProtocolFee: bit(data, 152n, 16n),
    eModeCategory: bit(data, 168n, 8n),
    unbackedMintCap: bit(data, 176n, 36n),
    debtCeiling: bit(data, 212n, 40n),
  };
}

/**
 * Reads and decodes the current reserve configuration from the pool.
 *
 * @param pool Pool contract.
 * @param asset Reserve asset.
 */
export async function getDecodedReserveConfig(pool: BaseContract, asset: string): Promise<DecodedReserveConfig> {
  const raw = (await pool.getConfiguration(asset)) as { data: bigint | { toString(): string } };
  return decodeReserveConfig(BigInt(raw.data.toString()));
}

/**
 * Returns true when a reserve is in the intended staged posture.
 *
 * @param reserveConfig Current decoded reserve config.
 */
export function isReserveStaged(reserveConfig: DecodedReserveConfig): boolean {
  return (
    reserveConfig.active &&
    !reserveConfig.paused &&
    !reserveConfig.frozen &&
    reserveConfig.ltv === 0n &&
    reserveConfig.liquidationThreshold === 0n &&
    reserveConfig.liquidationBonus === 0n &&
    !reserveConfig.borrowingEnabled &&
    !reserveConfig.stableBorrowingEnabled &&
    !reserveConfig.flashLoanEnabled &&
    reserveConfig.borrowCap === 0n &&
    !reserveConfig.borrowableInIsolation
  );
}

/**
 * Returns true when a reserve already has any live-market behaviour enabled.
 *
 * @param reserveConfig Current decoded reserve config.
 */
export function hasLiveMarketFeatures(reserveConfig: DecodedReserveConfig): boolean {
  return (
    reserveConfig.ltv !== 0n ||
    reserveConfig.liquidationThreshold !== 0n ||
    reserveConfig.liquidationBonus !== 0n ||
    reserveConfig.borrowingEnabled ||
    reserveConfig.stableBorrowingEnabled ||
    reserveConfig.flashLoanEnabled ||
    reserveConfig.borrowCap !== 0n ||
    reserveConfig.borrowableInIsolation
  );
}

/**
 * Reads a boolean env var with a default fallback.
 *
 * @param name Env var name.
 * @param defaultValue Fallback value.
 */
export function parseBooleanEnv(name: string, defaultValue: boolean): boolean {
  const raw = process.env[name];

  if (!raw) {
    return defaultValue;
  }

  return raw.toLowerCase() === "true";
}

/**
 * Reads a JSON string-array env var and deduplicates entries.
 *
 * @param name Env var name.
 */
export function parseStringArrayEnv(name: string): string[] {
  const raw = process.env[name];

  if (!raw) {
    return [];
  }

  const parsed = JSON.parse(raw) as string[];
  return uniqueValues(parsed.map((value) => value.trim()).filter(Boolean));
}

/**
 * Reads a JSON object env var and normalizes the keys for case-insensitive lookup.
 *
 * @param name Env var name.
 */
export function parseNormalizedBigIntMapEnv(name: string): Record<string, bigint> {
  const raw = process.env[name];

  if (!raw) {
    return {};
  }

  const parsed = JSON.parse(raw) as Record<string, string | number>;
  const out: Record<string, bigint> = {};

  for (const [key, value] of Object.entries(parsed)) {
    out[normalizeSymbol(key)] = BigInt(value.toString());
  }

  return out;
}

/**
 * Resolves token addresses from config first, then from deployments as fallback.
 *
 * @param hre Hardhat runtime used for deployment lookups.
 * @param symbol Token symbol to resolve.
 * @param tokenMap Token address map from config.
 */
export async function resolveTokenAddress(
  hre: HardhatRuntimeEnvironment,
  symbol: string,
  tokenMap: Record<string, string>,
): Promise<string | null> {
  const fromConfig = tokenMap[symbol];

  if (fromConfig) {
    return fromConfig;
  }

  const fallback = await hre.deployments.getOrNull(symbol);
  return fallback?.address ?? null;
}

/**
 * Builds the set of assets expected to exist in oracle wrapper config.
 *
 * @param config Network config.
 */
export function buildExpectedOracleAssets(config: Config): Set<string> {
  const expectedOracleAssets = new Set<string>();

  for (const asset of Object.keys(config.oracleAggregators.USD.redstoneOracleAssets.plainRedstoneOracleWrappers ?? {})) {
    expectedOracleAssets.add(normalize(asset));
  }

  for (const asset of Object.keys(config.oracleAggregators.USD.redstoneOracleAssets.redstoneOracleWrappersWithThresholding ?? {})) {
    expectedOracleAssets.add(normalize(asset));
  }

  for (const [asset, compositeConfig] of Object.entries(
    config.oracleAggregators.USD.redstoneOracleAssets.compositeRedstoneOracleWrappersWithThresholding ?? {},
  )) {
    expectedOracleAssets.add(normalize(asset));
    expectedOracleAssets.add(normalize(compositeConfig.feedAsset));
  }

  for (const asset of Object.keys(config.oracleAggregators.USD.chainlinkErc4626OracleAssets ?? {})) {
    expectedOracleAssets.add(normalize(asset));
  }

  for (const asset of Object.keys(config.oracleAggregators.ETH.redstoneOracleAssets.plainRedstoneOracleWrappers ?? {})) {
    expectedOracleAssets.add(normalize(asset));
  }

  for (const asset of Object.keys(config.oracleAggregators.ETH.erc4626OracleAssets ?? {})) {
    expectedOracleAssets.add(normalize(asset));
  }

  if (config.oracleAggregators.ETH.frxEthFundamentalOracle?.asset) {
    expectedOracleAssets.add(normalize(config.oracleAggregators.ETH.frxEthFundamentalOracle.asset));
  }

  return expectedOracleAssets;
}

/**
 * Verifies that a reserve already has a live oracle route and a non-zero price.
 *
 * @param params Oracle assertion params.
 */
export async function assertReserveOracleReadiness(params: OracleReadinessParams): Promise<void> {
  const {
    hre,
    signer,
    priceOracleAddress,
    priceOracle,
    verifiedOracleAssets,
    expectedOracleAssets,
    symbol,
    asset,
    allowMissingWrapperWhenExpected = false,
  } = params;
  const normalizedAsset = normalize(asset);

  if (verifiedOracleAssets.has(normalizedAsset)) {
    return;
  }

  const assetSource = await priceOracle.getSourceOfAsset(asset);

  if (normalize(assetSource) === normalize(ZeroAddress)) {
    throw new Error(
      [`[oracle-check] Missing price source for reserve ${symbol}.`, `asset=${asset}`, `oracle=${priceOracleAddress}`].join(" "),
    );
  }

  const oracleAggregator = await hre.ethers.getContractAt(["function assetOracles(address) view returns (address)"], assetSource, signer);
  const mappedWrapper = (await oracleAggregator.assetOracles(asset)) as string;

  if (normalize(mappedWrapper) === normalize(ZeroAddress)) {
    if (!expectedOracleAssets.has(normalizedAsset)) {
      throw new Error(
        [
          `[oracle-check] Asset ${symbol} has no oracle wrapper configured in the source aggregator.`,
          `asset=${asset}`,
          `source=${assetSource}`,
          "Missing oracle rollout config entry for this reserve.",
        ].join(" "),
      );
    }

    if (!allowMissingWrapperWhenExpected) {
      throw new Error(
        [
          `[oracle-check] Asset ${symbol} wrapper is still missing from the source aggregator.`,
          `asset=${asset}`,
          `source=${assetSource}`,
          "Execute the oracle rollout Safe batches before generating reserve batches.",
        ].join(" "),
      );
    }

    verifiedOracleAssets.add(normalizedAsset);
    return;
  }

  let assetPrice: bigint;

  try {
    assetPrice = await priceOracle.getAssetPrice(asset);
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    throw new Error(
      [
        `[oracle-check] Price lookup reverted for reserve ${symbol}.`,
        `asset=${asset}`,
        `wrapper=${mappedWrapper}`,
        `source=${assetSource}`,
        `reason=${message.split("\n")[0]}`,
      ].join(" "),
    );
  }

  if (assetPrice <= 0n) {
    throw new Error(
      [
        `[oracle-check] Non-positive price for reserve ${symbol}.`,
        `asset=${asset}`,
        `wrapper=${mappedWrapper}`,
        `source=${assetSource}`,
        `price=${assetPrice.toString()}`,
      ].join(" "),
    );
  }

  verifiedOracleAssets.add(normalizedAsset);
}

/** No-op deploy entry for this shared module; real deploy scripts import from ./common. */
export default async function (): Promise<void> {}
