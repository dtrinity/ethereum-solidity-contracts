import { BaseContract, Signer } from "ethers";
import { HardhatRuntimeEnvironment } from "hardhat/types";

const CHAINLINK_BASE_UNIT = 10n ** 8n;
const CHAINLINK_EXPECTED_FEED_DECIMALS = 8n;
const CHAINLINK_HEARTBEAT_SECONDS = 24n * 60n * 60n;

type WrapperWithHeartbeat = BaseContract & {
  BASE_CURRENCY_UNIT(): Promise<bigint>;
  heartbeatStaleTimeLimit(): Promise<bigint>;
};

type WrapperWithBaseUnit = BaseContract & {
  BASE_CURRENCY_UNIT(): Promise<bigint>;
};

type PriceFeedLike = BaseContract & {
  decimals(): Promise<bigint>;
  latestRoundData(): Promise<readonly [bigint, bigint, bigint, bigint, bigint]>;
};

type Erc4626Like = BaseContract & {
  asset(): Promise<string>;
  convertToAssets(shares: bigint): Promise<bigint>;
};

type Erc20MetadataLike = BaseContract & {
  decimals(): Promise<bigint>;
};

type DirectOracleLike = BaseContract & {
  BASE_CURRENCY_UNIT(): Promise<bigint>;
  getAssetPrice(asset: string): Promise<bigint>;
};

export type OraclePriceBounds = {
  minInBase: bigint;
  maxInBase: bigint;
};

export type CompositeFeedConfig = {
  feed1: string;
  feed2: string;
  lowerThresholdInBase1: bigint;
  fixedPriceInBase1: bigint;
  lowerThresholdInBase2: bigint;
  fixedPriceInBase2: bigint;
};

/**
 * Returns broad sanity bounds for USD-denominated prices.
 *
 * @param baseCurrencyUnit Wrapper base unit.
 */
export function getUsdOraclePriceBounds(baseCurrencyUnit: bigint): OraclePriceBounds {
  return {
    minInBase: baseCurrencyUnit / 10_000n,
    maxInBase: baseCurrencyUnit * 10_000_000n,
  };
}

/**
 * Returns broad sanity bounds for ETH-denominated prices.
 *
 * @param baseCurrencyUnit Wrapper base unit.
 */
export function getEthOraclePriceBounds(baseCurrencyUnit: bigint): OraclePriceBounds {
  return {
    minInBase: baseCurrencyUnit / 1_000n,
    maxInBase: baseCurrencyUnit * 1_000n,
  };
}

/**
 * Validates a plain Chainlink-compatible feed value against bounds.
 *
 * @param params Validation context.
 * @param params.hre
 * @param params.signer
 * @param params.wrapper
 * @param params.feed
 * @param params.bounds
 * @param params.label
 */
export async function assertPlainFeedPriceWithinBounds(params: {
  hre: HardhatRuntimeEnvironment;
  signer: Signer;
  wrapper: WrapperWithHeartbeat;
  feed: string;
  bounds: OraclePriceBounds;
  label: string;
}): Promise<void> {
  const { hre, signer, wrapper, feed, bounds, label } = params;
  const [baseUnit, staleLimit, nowTimestamp] = await Promise.all([
    wrapper.BASE_CURRENCY_UNIT(),
    wrapper.heartbeatStaleTimeLimit(),
    getLatestBlockTimestamp(hre),
  ]);

  const priceFeed = (await hre.ethers.getContractAt("IPriceFeed", feed, signer)) as unknown as PriceFeedLike;
  const [[, answer, , updatedAt], feedDecimals] = await Promise.all([priceFeed.latestRoundData(), priceFeed.decimals()]);
  assertSupportedFeedDecimals(feedDecimals, label);
  assertFresh(updatedAt, staleLimit, nowTimestamp, label);
  const priceInBase = chainlinkPriceToBase(answer, baseUnit);
  assertPriceBounds(priceInBase, bounds, baseUnit, label);
}

/**
 * Validates a composite feed value against bounds using configured thresholds.
 *
 * @param params Validation context.
 * @param params.hre
 * @param params.signer
 * @param params.wrapper
 * @param params.config
 * @param params.bounds
 * @param params.label
 */
export async function assertCompositeFeedPriceWithinBounds(params: {
  hre: HardhatRuntimeEnvironment;
  signer: Signer;
  wrapper: WrapperWithHeartbeat;
  config: CompositeFeedConfig;
  bounds: OraclePriceBounds;
  label: string;
}): Promise<void> {
  const { hre, signer, wrapper, config, bounds, label } = params;
  const [baseUnit, staleLimit, nowTimestamp] = await Promise.all([
    wrapper.BASE_CURRENCY_UNIT(),
    wrapper.heartbeatStaleTimeLimit(),
    getLatestBlockTimestamp(hre),
  ]);

  const feed1 = (await hre.ethers.getContractAt("IPriceFeed", config.feed1, signer)) as unknown as PriceFeedLike;
  const feed2 = (await hre.ethers.getContractAt("IPriceFeed", config.feed2, signer)) as unknown as PriceFeedLike;

  const [[, answer1, , updatedAt1], [, answer2, , updatedAt2], feed1Decimals, feed2Decimals] = await Promise.all([
    feed1.latestRoundData(),
    feed2.latestRoundData(),
    feed1.decimals(),
    feed2.decimals(),
  ]);
  assertSupportedFeedDecimals(feed1Decimals, `${label}:primary`);
  assertSupportedFeedDecimals(feed2Decimals, `${label}:secondary`);
  assertFresh(updatedAt1, staleLimit, nowTimestamp, `${label}:primary`);
  assertFresh(updatedAt2, staleLimit, nowTimestamp, `${label}:secondary`);

  let priceInBase1 = chainlinkPriceToBase(answer1, baseUnit);
  let priceInBase2 = chainlinkPriceToBase(answer2, baseUnit);

  priceInBase1 = applyThreshold(priceInBase1, config.lowerThresholdInBase1, config.fixedPriceInBase1);
  priceInBase2 = applyThreshold(priceInBase2, config.lowerThresholdInBase2, config.fixedPriceInBase2);

  const compositePriceInBase = (priceInBase1 * priceInBase2) / baseUnit;
  assertPriceBounds(compositePriceInBase, bounds, baseUnit, label);
}

/**
 * Validates a Chainlink+ERC4626 composed feed value against bounds.
 *
 * @param params Validation context.
 * @param params.hre
 * @param params.signer
 * @param params.wrapper
 * @param params.feed
 * @param params.vault
 * @param params.bounds
 * @param params.label
 */
export async function assertChainlinkErc4626PriceWithinBounds(params: {
  hre: HardhatRuntimeEnvironment;
  signer: Signer;
  wrapper: WrapperWithHeartbeat;
  feed: string;
  vault: string;
  bounds: OraclePriceBounds;
  label: string;
}): Promise<void> {
  const { hre, signer, wrapper, feed, vault, bounds, label } = params;
  const [baseUnit, staleLimit, nowTimestamp] = await Promise.all([
    wrapper.BASE_CURRENCY_UNIT(),
    wrapper.heartbeatStaleTimeLimit(),
    getLatestBlockTimestamp(hre),
  ]);

  const priceFeed = (await hre.ethers.getContractAt("IPriceFeed", feed, signer)) as unknown as PriceFeedLike;
  const vaultContract = (await hre.ethers.getContractAt(
    "@openzeppelin/contracts/interfaces/IERC4626.sol:IERC4626",
    vault,
    signer,
  )) as unknown as Erc4626Like;

  const [[, answer, , updatedAt], feedDecimals] = await Promise.all([priceFeed.latestRoundData(), priceFeed.decimals()]);
  assertSupportedFeedDecimals(feedDecimals, label);
  assertFresh(updatedAt, staleLimit, nowTimestamp, label);

  const shareToken = (await hre.ethers.getContractAt("IERC20Metadata", vault, signer)) as unknown as Erc20MetadataLike;
  const underlying = await vaultContract.asset();
  const underlyingToken = (await hre.ethers.getContractAt("IERC20Metadata", underlying, signer)) as unknown as Erc20MetadataLike;

  const [shareDecimals, assetDecimals] = await Promise.all([shareToken.decimals(), underlyingToken.decimals()]);
  const sharesUnit = 10n ** shareDecimals;
  const assetsPerShare = await vaultContract.convertToAssets(sharesUnit);
  const underlyingPriceInBase = chainlinkPriceToBase(answer, baseUnit);
  const assetUnit = 10n ** assetDecimals;
  const priceInBase = (underlyingPriceInBase * assetsPerShare) / assetUnit;

  assertPriceBounds(priceInBase, bounds, baseUnit, label);
}

/**
 * Validates an ERC4626-only oracle wrapper value against bounds.
 *
 * @param params Validation context.
 * @param params.hre
 * @param params.signer
 * @param params.wrapper
 * @param params.vault
 * @param params.bounds
 * @param params.label
 */
export async function assertErc4626PriceWithinBounds(params: {
  hre: HardhatRuntimeEnvironment;
  signer: Signer;
  wrapper: WrapperWithBaseUnit;
  vault: string;
  bounds: OraclePriceBounds;
  label: string;
}): Promise<void> {
  const { hre, signer, wrapper, vault, bounds, label } = params;
  const baseUnit = await wrapper.BASE_CURRENCY_UNIT();
  const vaultContract = (await hre.ethers.getContractAt(
    "@openzeppelin/contracts/interfaces/IERC4626.sol:IERC4626",
    vault,
    signer,
  )) as unknown as Erc4626Like;
  const shareToken = (await hre.ethers.getContractAt("IERC20Metadata", vault, signer)) as unknown as Erc20MetadataLike;
  const underlying = await vaultContract.asset();
  const underlyingToken = (await hre.ethers.getContractAt("IERC20Metadata", underlying, signer)) as unknown as Erc20MetadataLike;

  const [shareDecimals, assetDecimals] = await Promise.all([shareToken.decimals(), underlyingToken.decimals()]);
  const sharesUnit = 10n ** shareDecimals;
  const assetsPerShare = await vaultContract.convertToAssets(sharesUnit);
  const assetUnit = 10n ** assetDecimals;
  const priceInBase = (assetsPerShare * baseUnit) / assetUnit;

  assertPriceBounds(priceInBase, bounds, baseUnit, label);
}

/**
 * Validates a wrapper-reported price directly against bounds.
 *
 * @param params Validation context.
 * @param params.wrapper
 * @param params.asset
 * @param params.bounds
 * @param params.label
 */
export async function assertDirectWrapperPriceWithinBounds(params: {
  wrapper: DirectOracleLike;
  asset: string;
  bounds: OraclePriceBounds;
  label: string;
}): Promise<void> {
  const { wrapper, asset, bounds, label } = params;
  const [baseUnit, priceInBase] = await Promise.all([wrapper.BASE_CURRENCY_UNIT(), wrapper.getAssetPrice(asset)]);
  assertPriceBounds(priceInBase, bounds, baseUnit, label);
}

/**
 * Reads latest block timestamp from provider.
 *
 * @param hre Hardhat runtime environment.
 */
async function getLatestBlockTimestamp(hre: HardhatRuntimeEnvironment): Promise<bigint> {
  const latestBlock = await hre.ethers.provider.getBlock("latest");

  if (!latestBlock) {
    throw new Error("Unable to read latest block timestamp for oracle sanity checks.");
  }

  return BigInt(latestBlock.timestamp);
}

/**
 * Ensures feed update timestamp is still fresh.
 *
 * @param updatedAt Feed update time.
 * @param staleLimit Wrapper stale time limit.
 * @param nowTimestamp Current chain timestamp.
 * @param label Human-readable check label.
 */
function assertFresh(updatedAt: bigint, staleLimit: bigint, nowTimestamp: bigint, label: string): void {
  if (updatedAt <= 0n) {
    throw new Error(`[oracle-sanity] ${label} has invalid updatedAt=${updatedAt.toString()}.`);
  }

  const expiryTimestamp = updatedAt + CHAINLINK_HEARTBEAT_SECONDS + staleLimit;

  if (expiryTimestamp <= nowTimestamp) {
    throw new Error(
      [
        `[oracle-sanity] ${label} is stale.`,
        `updatedAt=${updatedAt.toString()} expiry=${expiryTimestamp.toString()} now=${nowTimestamp.toString()}.`,
      ].join(" "),
    );
  }
}

/**
 * Converts Chainlink 8-decimal answer into wrapper base unit.
 *
 * @param answer Raw Chainlink answer.
 * @param baseCurrencyUnit Wrapper base unit.
 */
function chainlinkPriceToBase(answer: bigint, baseCurrencyUnit: bigint): bigint {
  if (answer <= 0n) {
    throw new Error(`[oracle-sanity] Feed returned non-positive answer=${answer.toString()}.`);
  }

  return (answer * baseCurrencyUnit) / CHAINLINK_BASE_UNIT;
}

/**
 * Ensures a feed uses the decimal precision expected by wrappers relying on BaseChainlinkWrapperV1_1 conversion.
 *
 * @param feedDecimals Decimals reported by feed.decimals().
 * @param label Human-readable check label.
 */
function assertSupportedFeedDecimals(feedDecimals: bigint, label: string): void {
  if (feedDecimals !== CHAINLINK_EXPECTED_FEED_DECIMALS) {
    throw new Error(
      [
        `[oracle-sanity] ${label} has unsupported feed decimals=${feedDecimals.toString()}.`,
        `expected=${CHAINLINK_EXPECTED_FEED_DECIMALS.toString()}.`,
        "Use an 8-decimal adapter/aggregator feed for this wrapper.",
      ].join(" "),
    );
  }
}

/**
 * Applies optional lower-threshold replacement.
 *
 * @param priceInBase Candidate price.
 * @param lowerThresholdInBase Threshold trigger.
 * @param fixedPriceInBase Fallback price when below threshold.
 */
function applyThreshold(priceInBase: bigint, lowerThresholdInBase: bigint, fixedPriceInBase: bigint): bigint {
  if (lowerThresholdInBase > 0n && priceInBase < lowerThresholdInBase) {
    return fixedPriceInBase;
  }

  return priceInBase;
}

/**
 * Ensures price stays within configured sanity bounds.
 *
 * @param priceInBase Candidate price.
 * @param bounds Accepted range in base unit.
 * @param baseCurrencyUnit Wrapper base unit.
 * @param label Human-readable check label.
 */
function assertPriceBounds(priceInBase: bigint, bounds: OraclePriceBounds, baseCurrencyUnit: bigint, label: string): void {
  if (priceInBase < bounds.minInBase || priceInBase > bounds.maxInBase) {
    throw new Error(
      [
        `[oracle-sanity] ${label} price out of bounds.`,
        `price=${formatPriceInBase(priceInBase, baseCurrencyUnit)}`,
        `min=${formatPriceInBase(bounds.minInBase, baseCurrencyUnit)}`,
        `max=${formatPriceInBase(bounds.maxInBase, baseCurrencyUnit)}`,
      ].join(" "),
    );
  }
}

/**
 * Formats a base-unit value into readable decimal string.
 *
 * @param value Price value in base unit.
 * @param baseCurrencyUnit Wrapper base unit.
 */
function formatPriceInBase(value: bigint, baseCurrencyUnit: bigint): string {
  const decimals = inferUnitDecimals(baseCurrencyUnit);

  if (decimals === null) {
    return `${value.toString()} (baseUnit=${baseCurrencyUnit.toString()})`;
  }

  const denominator = 10n ** BigInt(decimals);
  const whole = value / denominator;
  const remainder = value % denominator;
  const fractional = remainder.toString().padStart(decimals, "0").replace(/0+$/, "");

  return fractional.length > 0 ? `${whole.toString()}.${fractional}` : whole.toString();
}

/**
 * Infers decimal precision from base unit when power-of-ten.
 *
 * @param baseCurrencyUnit Wrapper base unit.
 */
function inferUnitDecimals(baseCurrencyUnit: bigint): number | null {
  let decimals = 0;
  let value = baseCurrencyUnit;

  while (value > 1n && value % 10n === 0n) {
    value /= 10n;
    decimals += 1;
  }

  return value === 1n ? decimals : null;
}
