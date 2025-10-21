import { ethers } from "hardhat";
import { HardhatRuntimeEnvironment } from "hardhat/types";
import { getConfig } from "../config/networks/katana_mainnet";

const hre = require("hardhat") as HardhatRuntimeEnvironment;

// Chainlink feeds standard is 8 decimals for price feeds
const CHAINLINK_EXPECTED_DECIMALS = 8;

// Chainlink Aggregator interface for reading price data
const CHAINLINK_AGGREGATOR_ABI = [
  "function latestRoundData() external view returns (uint80 roundId, int256 answer, uint256 startedAt, uint256 updatedAt, uint80 answeredInRound)",
  "function decimals() external view returns (uint8)",
  "function description() external view returns (string memory)",
];

interface FeedInfo {
  address: string;
  description: string;
  assetAddress: string;
  assetSymbol: string;
  feedType: string;
  pairDescription: string;
  baseCurrency: string;
  actualDecimals: number;
  expectedDecimals: number;
  scalingNeeded: "none" | "upscale" | "downscale";
  scalingFactor: number;
  currentPrice: string;
  rawPrice: string;
  priceTimestamp: number;
  isStale: boolean;
}

/**
 * Get decimals, description, and current price from a Chainlink aggregator
 */
async function getFeedInfo(feedAddress: string): Promise<{
  description: string;
  decimals: number;
  currentPrice: string;
  rawPrice: string;
  timestamp: number;
  isStale: boolean;
}> {
  try {
    const feed = new ethers.Contract(feedAddress, CHAINLINK_AGGREGATOR_ABI, hre.ethers.provider);

    let description = "Unknown";
    let decimals = 8; // Default for most Chainlink feeds
    let currentPrice = "0";
    let rawPrice = "0";
    let timestamp = 0;
    let isStale = true;

    try {
      description = await feed.description();
    } catch (e) {
      console.log(`Warning: Could not get description for ${feedAddress}`);
    }

    try {
      decimals = await feed.decimals();
    } catch (e) {
      console.log(`Warning: Could not get decimals for ${feedAddress}, using default 8`);
    }

    try {
      const [, answer, , updatedAt] = await feed.latestRoundData();
      rawPrice = answer.toString();
      currentPrice = ethers.formatUnits(answer > 0 ? answer : 0, decimals);
      timestamp = Number(updatedAt);

      // Check if price is stale (older than 3600 seconds = 1 hour for Chainlink)
      const now = Math.floor(Date.now() / 1000);
      const staleThreshold = 3600; // 1 hour in seconds
      isStale = now - timestamp > staleThreshold;
    } catch (e) {
      console.log(`Warning: Could not read price from ${feedAddress}:`, e);
    }

    return { description, decimals, currentPrice, rawPrice, timestamp, isStale };
  } catch (error) {
    console.error(`Error getting info for feed ${feedAddress}:`, error);
    return { description: "Error fetching", decimals: 8, currentPrice: "0", rawPrice: "0", timestamp: 0, isStale: true };
  }
}

/**
 * Determine scaling requirements
 */
function analyzeScaling(
  actualDecimals: number,
  expectedDecimals: number,
): {
  scalingNeeded: "none" | "upscale" | "downscale";
  scalingFactor: number;
} {
  // Convert to numbers explicitly to avoid BigInt issues
  const actualDec = Number(actualDecimals);
  const expectedDec = Number(expectedDecimals);

  if (actualDec === expectedDec) {
    return { scalingNeeded: "none", scalingFactor: 1 };
  } else if (actualDec < expectedDec) {
    const factor = Math.pow(10, expectedDec - actualDec);
    return { scalingNeeded: "upscale", scalingFactor: factor };
  } else {
    const factor = Math.pow(10, actualDec - expectedDec);
    return { scalingNeeded: "downscale", scalingFactor: factor };
  }
}

/**
 * Get human-readable symbol from asset address
 */
function getAssetSymbol(address: string, config: any): string {
  const tokenMap: Record<string, string> = {
    [config.tokenAddresses.frxUSD]: "frxUSD",
    [config.tokenAddresses.sfrxUSD]: "sfrxUSD",
    [config.tokenAddresses.USDC]: "USDC",
    [config.tokenAddresses.USDT]: "USDT",
    [config.tokenAddresses.AUSD]: "AUSD",
    [config.tokenAddresses.yUSD]: "yUSD",
    [config.tokenAddresses.WETH]: "WETH/vbETH",
    [config.tokenAddresses.wstETH]: "wstETH",
    [config.tokenAddresses.weETH]: "weETH",
  };
  return tokenMap[address] || `Unknown (${address.slice(0, 8)}...)`;
}

/**
 * Extract all Chainlink/Redstone feeds from the configuration
 */
async function extractChainlinkFeeds(): Promise<FeedInfo[]> {
  const config = await getConfig(hre);
  const feeds: FeedInfo[] = [];

  for (const [baseCurrency, aggregatorConfig] of Object.entries(config.oracleAggregators)) {
    console.log(`\n🔍 Analyzing ${baseCurrency} Oracle Aggregator:`);

    const { redstoneOracleAssets } = aggregatorConfig;
    const expectedDecimals = CHAINLINK_EXPECTED_DECIMALS;

    // Plain Redstone Oracle Wrappers
    for (const [assetAddress, feedAddress] of Object.entries(redstoneOracleAssets.plainRedstoneOracleWrappers)) {
      const feedInfo = await getFeedInfo(feedAddress);
      const scaling = analyzeScaling(feedInfo.decimals, expectedDecimals);
      const assetSymbol = getAssetSymbol(assetAddress, config);

      feeds.push({
        address: feedAddress,
        description: feedInfo.description,
        assetAddress,
        assetSymbol,
        feedType: "Plain Redstone Wrapper",
        pairDescription: `${assetSymbol}/${baseCurrency}`,
        baseCurrency,
        actualDecimals: feedInfo.decimals,
        expectedDecimals,
        currentPrice: feedInfo.currentPrice,
        rawPrice: feedInfo.rawPrice,
        priceTimestamp: feedInfo.timestamp,
        isStale: feedInfo.isStale,
        ...scaling,
      });
    }

    // Redstone Oracle Wrappers With Thresholding
    for (const [assetAddress, wrapperConfig] of Object.entries(redstoneOracleAssets.redstoneOracleWrappersWithThresholding)) {
      const feedInfo = await getFeedInfo(wrapperConfig.feed);
      const scaling = analyzeScaling(feedInfo.decimals, expectedDecimals);
      const assetSymbol = getAssetSymbol(assetAddress, config);

      feeds.push({
        address: wrapperConfig.feed,
        description: feedInfo.description,
        assetAddress,
        assetSymbol,
        feedType: "Redstone Wrapper with Thresholding",
        pairDescription: `${assetSymbol}/${baseCurrency}`,
        baseCurrency,
        actualDecimals: feedInfo.decimals,
        expectedDecimals,
        currentPrice: feedInfo.currentPrice,
        rawPrice: feedInfo.rawPrice,
        priceTimestamp: feedInfo.timestamp,
        isStale: feedInfo.isStale,
        ...scaling,
      });
    }

    // Composite Redstone Oracle Wrappers With Thresholding
    for (const [assetAddress, compositeConfig] of Object.entries(redstoneOracleAssets.compositeRedstoneOracleWrappersWithThresholding)) {
      const assetSymbol = getAssetSymbol(assetAddress, config);

      // Feed 1 - typically asset/intermediary pair
      const feedInfo1 = await getFeedInfo(compositeConfig.feed1);
      const scaling1 = analyzeScaling(feedInfo1.decimals, expectedDecimals);

      feeds.push({
        address: compositeConfig.feed1,
        description: feedInfo1.description,
        assetAddress,
        assetSymbol,
        feedType: "Composite Redstone (Primary Feed)",
        pairDescription: `${assetSymbol}/intermediary (Primary)`,
        baseCurrency,
        actualDecimals: feedInfo1.decimals,
        expectedDecimals,
        currentPrice: feedInfo1.currentPrice,
        rawPrice: feedInfo1.rawPrice,
        priceTimestamp: feedInfo1.timestamp,
        isStale: feedInfo1.isStale,
        ...scaling1,
      });

      // Feed 2 - typically intermediary/base pair
      const feedInfo2 = await getFeedInfo(compositeConfig.feed2);
      const scaling2 = analyzeScaling(feedInfo2.decimals, expectedDecimals);

      feeds.push({
        address: compositeConfig.feed2,
        description: feedInfo2.description,
        assetAddress,
        assetSymbol,
        feedType: "Composite Redstone (Secondary Feed)",
        pairDescription: `intermediary/${baseCurrency} (Secondary)`,
        baseCurrency,
        actualDecimals: feedInfo2.decimals,
        expectedDecimals,
        currentPrice: feedInfo2.currentPrice,
        rawPrice: feedInfo2.rawPrice,
        priceTimestamp: feedInfo2.timestamp,
        isStale: feedInfo2.isStale,
        ...scaling2,
      });
    }
  }

  return feeds;
}

/**
 * Print analysis results
 */
function printAnalysis(feeds: FeedInfo[]) {
  console.log("\n" + "=".repeat(80));
  console.log("📊 CHAINLINK/REDSTONE FEEDS DECIMAL ANALYSIS");
  console.log("=".repeat(80));
  console.log(`Expected Chainlink Feed Decimals: ${CHAINLINK_EXPECTED_DECIMALS}`);
  console.log(`Chainlink Standard Decimals: 8 (price feeds) / 18 (some pairs)`);
  console.log("=".repeat(80));

  if (feeds.length === 0) {
    console.log("❌ No Chainlink/Redstone feeds found in the configuration.");
    return;
  }

  // Group by scaling requirements
  const noScaling = feeds.filter((f) => f.scalingNeeded === "none");
  const upscaling = feeds.filter((f) => f.scalingNeeded === "upscale");
  const downscaling = feeds.filter((f) => f.scalingNeeded === "downscale");

  console.log(`\n✅ FEEDS REQUIRING NO SCALING (${noScaling.length}):`);
  if (noScaling.length === 0) {
    console.log("  None");
  } else {
    noScaling.forEach((feed) => {
      const lastUpdate = new Date(feed.priceTimestamp * 1000);
      const staleStatus = feed.isStale ? "🔴 STALE" : "🟢 FRESH";

      console.log(`  🔗 ${feed.address}`);
      console.log(`     📝 ${feed.pairDescription}`);
      console.log(`     🏷️  ${feed.feedType}`);
      console.log(`     🪙 Asset: ${feed.assetSymbol} (${feed.assetAddress})`);
      console.log(`     💰 Base Currency: ${feed.baseCurrency}`);
      console.log(`     💲 Current Price: ${feed.currentPrice} ${staleStatus}`);
      console.log(`     🔢 Raw Price: ${feed.rawPrice}`);
      console.log(`     🕐 Last Update: ${lastUpdate.toISOString()}`);
      console.log(`     📊 ${feed.actualDecimals} decimals (matches expected ${feed.expectedDecimals})`);
      console.log("");
    });
  }

  console.log(`\n⬆️  FEEDS REQUIRING UPSCALING (${upscaling.length}):`);
  if (upscaling.length === 0) {
    console.log("  None");
  } else {
    upscaling.forEach((feed) => {
      const lastUpdate = new Date(feed.priceTimestamp * 1000);
      const staleStatus = feed.isStale ? "🔴 STALE" : "🟢 FRESH";

      console.log(`  🔗 ${feed.address}`);
      console.log(`     📝 ${feed.pairDescription}`);
      console.log(`     🏷️  ${feed.feedType}`);
      console.log(`     🪙 Asset: ${feed.assetSymbol} (${feed.assetAddress})`);
      console.log(`     💰 Base Currency: ${feed.baseCurrency}`);
      console.log(`     💲 Current Price: ${feed.currentPrice} ${staleStatus}`);
      console.log(`     🔢 Raw Price: ${feed.rawPrice}`);
      console.log(`     🕐 Last Update: ${lastUpdate.toISOString()}`);
      console.log(`     📊 ${feed.actualDecimals} → ${feed.expectedDecimals} decimals (multiply by ${feed.scalingFactor})`);
      console.log("");
    });
  }

  console.log(`\n⬇️  FEEDS REQUIRING DOWNSCALING (${downscaling.length}):`);
  if (downscaling.length === 0) {
    console.log("  None");
  } else {
    downscaling.forEach((feed) => {
      const lastUpdate = new Date(feed.priceTimestamp * 1000);
      const staleStatus = feed.isStale ? "🔴 STALE" : "🟢 FRESH";

      console.log(`  🔗 ${feed.address}`);
      console.log(`     📝 ${feed.pairDescription}`);
      console.log(`     🏷️  ${feed.feedType}`);
      console.log(`     🪙 Asset: ${feed.assetSymbol} (${feed.assetAddress})`);
      console.log(`     💰 Base Currency: ${feed.baseCurrency}`);
      console.log(`     💲 Current Price: ${feed.currentPrice} ${staleStatus}`);
      console.log(`     🔢 Raw Price: ${feed.rawPrice}`);
      console.log(`     🕐 Last Update: ${lastUpdate.toISOString()}`);
      console.log(`     📊 ${feed.actualDecimals} → ${feed.expectedDecimals} decimals (divide by ${feed.scalingFactor})`);
      console.log("");
    });
  }

  // Summary
  console.log("=".repeat(80));
  console.log("📋 SUMMARY:");
  console.log(`  Total Chainlink/Redstone feeds analyzed: ${feeds.length}`);
  console.log(`  ✅ No scaling needed: ${noScaling.length}`);
  console.log(`  ⬆️  Upscaling needed: ${upscaling.length}`);
  console.log(`  ⬇️  Downscaling needed: ${downscaling.length}`);

  // Stale feed analysis
  const staleFeeds = feeds.filter((f) => f.isStale);
  const freshFeeds = feeds.filter((f) => !f.isStale);
  console.log(`  🔴 Stale feeds: ${staleFeeds.length}`);
  console.log(`  🟢 Fresh feeds: ${freshFeeds.length}`);

  console.log("=".repeat(80));

  // Stale feed warnings
  if (staleFeeds.length > 0) {
    console.log("\n⚠️  STALE FEED WARNINGS:");
    console.log(`  • ${staleFeeds.length} out of ${feeds.length} feeds are stale (older than 1 hour)`);
    console.log("  • Stale feeds may cause oracle failures or incorrect pricing");
    console.log("  • Consider investigating feed reliability or updating feed sources");

    // Group stale feeds by staleness severity
    const now = Math.floor(Date.now() / 1000);
    const veryStaleFeedsCount = staleFeeds.filter((f) => now - f.priceTimestamp > 24 * 3600).length;
    const oldFeedsCount = staleFeeds.filter((f) => now - f.priceTimestamp > 6 * 3600 && now - f.priceTimestamp <= 24 * 3600).length;

    if (veryStaleFeedsCount > 0) {
      console.log(`  • ${veryStaleFeedsCount} feeds are very stale (>24 hours old) - HIGH PRIORITY`);
    }
    if (oldFeedsCount > 0) {
      console.log(`  • ${oldFeedsCount} feeds are moderately stale (6-24 hours old) - MEDIUM PRIORITY`);
    }
  }

  // Recommendations
  if (upscaling.length > 0 || downscaling.length > 0) {
    console.log("\n💡 DECIMAL SCALING RECOMMENDATIONS:");
    if (upscaling.length > 0) {
      console.log("  • Feeds requiring upscaling need decimal conversion (e.g., 6 → 8 decimals)");
      console.log("  • Handle upscaling in wrapper contracts or use appropriate converters");
    }
    if (downscaling.length > 0) {
      console.log("  • Use ChainlinkDecimalConverter to downscale feeds from 18 → 8 decimals");
      console.log("  • 18 decimals → 8 decimals downscaling preserves precision while meeting Chainlink standard");
    }
  } else {
    console.log("\n🎉 All Chainlink feeds are perfectly aligned with 8 decimals!");
  }
}

/**
 * Main function
 */
async function main() {
  console.log("🚀 Starting Chainlink/Redstone feeds analysis for Katana Mainnet...");

  try {
    const feeds = await extractChainlinkFeeds();
    printAnalysis(feeds);
  } catch (error) {
    console.error("❌ Error during analysis:", error);
    process.exit(1);
  }
}

// Run the script
main()
  .then(() => process.exit(0))
  .catch((error) => {
    console.error(error);
    process.exit(1);
  });
