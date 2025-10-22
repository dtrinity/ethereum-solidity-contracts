import { ethers } from "hardhat";
import { HardhatRuntimeEnvironment } from "hardhat/types";
import { getConfig } from "../config/networks/katana_mainnet";
import { ORACLE_AGGREGATOR_PRICE_DECIMALS } from "../typescript/oracle_aggregator/constants";

const hre = require("hardhat") as HardhatRuntimeEnvironment;

// API3 Proxy interface for reading price data
const API3_PROXY_ABI = [
  "function read() external view returns (int224 value, uint32 timestamp)",
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
 * Get decimals, description, and current price from an API3 proxy
 */
async function getFeedInfo(proxyAddress: string): Promise<{
  description: string;
  decimals: number;
  currentPrice: string;
  rawPrice: string;
  timestamp: number;
  isStale: boolean;
}> {
  try {
    const proxy = new ethers.Contract(proxyAddress, API3_PROXY_ABI, hre.ethers.provider);

    // API3 feeds typically use 18 decimals, but let's try to get the description
    let description = "Unknown";
    try {
      description = await proxy.description();
    } catch (e) {
      // Some proxies might not have description method
      console.log(`Warning: Could not get description for ${proxyAddress}`);
    }

    // Get current price data
    let currentPrice = "0";
    let rawPrice = "0";
    let timestamp = 0;
    let isStale = true;

    try {
      const [value, ts] = await proxy.read();
      rawPrice = value.toString();
      currentPrice = ethers.formatUnits(value > 0 ? value : 0, 18); // API3 uses 18 decimals
      timestamp = Number(ts);

      // Check if price is stale (older than 25 hours for API3)
      const now = Math.floor(Date.now() / 1000);
      const staleThreshold = 25 * 60 * 60; // 25 hours in seconds
      isStale = now - timestamp > staleThreshold;
    } catch (e) {
      console.log(`Warning: Could not read price from ${proxyAddress}:`, e);
    }

    // API3 feeds use 18 decimals by default
    const decimals = 18;

    return { description, decimals, currentPrice, rawPrice, timestamp, isStale };
  } catch (error) {
    console.error(`Error getting info for proxy ${proxyAddress}:`, error);
    return { description: "Error fetching", decimals: 18, currentPrice: "0", rawPrice: "0", timestamp: 0, isStale: true };
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
  if (actualDecimals === expectedDecimals) {
    return { scalingNeeded: "none", scalingFactor: 1 };
  } else if (actualDecimals < expectedDecimals) {
    const factor = Math.pow(10, expectedDecimals - actualDecimals);
    return { scalingNeeded: "upscale", scalingFactor: factor };
  } else {
    const factor = Math.pow(10, actualDecimals - expectedDecimals);
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
 * Extract all API3 feeds from the configuration
 */
async function extractAPI3Feeds(): Promise<FeedInfo[]> {
  const config = await getConfig(hre);
  const feeds: FeedInfo[] = [];

  for (const [baseCurrency, aggregatorConfig] of Object.entries(config.oracleAggregators)) {
    console.log(`\n🔍 Analyzing ${baseCurrency} Oracle Aggregator:`);

    const { api3OracleAssets } = aggregatorConfig;
    const expectedDecimals = ORACLE_AGGREGATOR_PRICE_DECIMALS;

    // Plain API3 Oracle Wrappers
    for (const [assetAddress, proxyAddress] of Object.entries(api3OracleAssets.plainApi3OracleWrappers)) {
      const feedInfo = await getFeedInfo(proxyAddress);
      const scaling = analyzeScaling(feedInfo.decimals, expectedDecimals);
      const assetSymbol = getAssetSymbol(assetAddress, config);

      feeds.push({
        address: proxyAddress,
        description: feedInfo.description,
        assetAddress,
        assetSymbol,
        feedType: "Plain API3 Wrapper",
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

    // API3 Oracle Wrappers With Thresholding
    for (const [assetAddress, wrapperConfig] of Object.entries(api3OracleAssets.api3OracleWrappersWithThresholding)) {
      const feedInfo = await getFeedInfo(wrapperConfig.proxy);
      const scaling = analyzeScaling(feedInfo.decimals, expectedDecimals);
      const assetSymbol = getAssetSymbol(assetAddress, config);

      feeds.push({
        address: wrapperConfig.proxy,
        description: feedInfo.description,
        assetAddress,
        assetSymbol,
        feedType: "API3 Wrapper with Thresholding",
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

    // Composite API3 Oracle Wrappers With Thresholding
    for (const [assetAddress, compositeConfig] of Object.entries(api3OracleAssets.compositeApi3OracleWrappersWithThresholding)) {
      const assetSymbol = getAssetSymbol(assetAddress, config);

      // Proxy 1 - typically asset/intermediary pair
      const feedInfo1 = await getFeedInfo(compositeConfig.proxy1);
      const scaling1 = analyzeScaling(feedInfo1.decimals, expectedDecimals);

      feeds.push({
        address: compositeConfig.proxy1,
        description: feedInfo1.description,
        assetAddress,
        assetSymbol,
        feedType: "Composite API3 (Primary Feed)",
        pairDescription: `${assetSymbol}/frxUSD (Primary)`,
        baseCurrency,
        actualDecimals: feedInfo1.decimals,
        expectedDecimals,
        currentPrice: feedInfo1.currentPrice,
        rawPrice: feedInfo1.rawPrice,
        priceTimestamp: feedInfo1.timestamp,
        isStale: feedInfo1.isStale,
        ...scaling1,
      });

      // Proxy 2 - typically intermediary/base pair
      const feedInfo2 = await getFeedInfo(compositeConfig.proxy2);
      const scaling2 = analyzeScaling(feedInfo2.decimals, expectedDecimals);

      feeds.push({
        address: compositeConfig.proxy2,
        description: feedInfo2.description,
        assetAddress,
        assetSymbol,
        feedType: "Composite API3 (Secondary Feed)",
        pairDescription: `frxUSD/${baseCurrency} (Secondary)`,
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
  console.log("📊 API3 FEEDS DECIMAL ANALYSIS");
  console.log("=".repeat(80));
  console.log(`Expected Oracle Aggregator Decimals: ${ORACLE_AGGREGATOR_PRICE_DECIMALS}`);
  console.log(`API3 Standard Decimals: 18`);
  console.log("=".repeat(80));

  if (feeds.length === 0) {
    console.log("❌ No API3 feeds found in the configuration.");
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
  console.log(`  Total API3 feeds analyzed: ${feeds.length}`);
  console.log(`  ✅ No scaling needed: ${noScaling.length}`);
  console.log(`  ⬆️  Upscaling needed: ${upscaling.length}`);
  console.log(`  ⬇️  Downscaling needed: ${downscaling.length}`);
  console.log("=".repeat(80));

  // Recommendations
  if (upscaling.length > 0 || downscaling.length > 0) {
    console.log("\n💡 RECOMMENDATIONS:");
    if (upscaling.length > 0) {
      console.log("  • Consider using ChainlinkDecimalConverter to upscale feeds (though this is not supported)");
      console.log("  • Alternatively, handle upscaling in the wrapper contracts");
    }
    if (downscaling.length > 0) {
      console.log("  • Use ChainlinkDecimalConverter to downscale feeds if needed");
      console.log("  • Most downscaling should happen automatically in the wrapper conversion logic");
    }
  } else {
    console.log("\n🎉 All feeds are perfectly aligned with the expected decimals!");
  }
}

/**
 * Main function
 */
async function main() {
  console.log("🚀 Starting API3 feeds analysis for Katana Mainnet...");

  try {
    const feeds = await extractAPI3Feeds();
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
