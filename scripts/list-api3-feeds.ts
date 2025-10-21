import { HardhatRuntimeEnvironment } from "hardhat/types";
import { getConfig } from "../config/networks/katana_mainnet";

const hre = require("hardhat") as HardhatRuntimeEnvironment;

interface FeedSummary {
  asset: string;
  assetAddress: string;
  feedAddress: string;
  feedType: string;
  pairDescription: string;
  baseCurrency: string;
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
  return tokenMap[address] || `Unknown`;
}

/**
 * Extract all API3 feeds from configuration
 */
async function extractAPI3FeedsSummary(): Promise<FeedSummary[]> {
  const config = await getConfig(hre);
  const feeds: FeedSummary[] = [];

  for (const [baseCurrency, aggregatorConfig] of Object.entries(config.oracleAggregators)) {
    const { api3OracleAssets } = aggregatorConfig;

    // Plain API3 Oracle Wrappers
    for (const [assetAddress, proxyAddress] of Object.entries(api3OracleAssets.plainApi3OracleWrappers)) {
      const assetSymbol = getAssetSymbol(assetAddress, config);
      feeds.push({
        asset: assetSymbol,
        assetAddress,
        feedAddress: proxyAddress,
        feedType: "Plain",
        pairDescription: `${assetSymbol}/${baseCurrency}`,
        baseCurrency,
      });
    }

    // API3 Oracle Wrappers With Thresholding
    for (const [assetAddress, wrapperConfig] of Object.entries(api3OracleAssets.api3OracleWrappersWithThresholding)) {
      const assetSymbol = getAssetSymbol(assetAddress, config);
      feeds.push({
        asset: assetSymbol,
        assetAddress,
        feedAddress: wrapperConfig.proxy,
        feedType: "Thresholding",
        pairDescription: `${assetSymbol}/${baseCurrency}`,
        baseCurrency,
      });
    }

    // Composite API3 Oracle Wrappers With Thresholding
    for (const [assetAddress, compositeConfig] of Object.entries(api3OracleAssets.compositeApi3OracleWrappersWithThresholding)) {
      const assetSymbol = getAssetSymbol(assetAddress, config);

      feeds.push({
        asset: assetSymbol,
        assetAddress,
        feedAddress: compositeConfig.proxy1,
        feedType: "Composite-1",
        pairDescription: `${assetSymbol}/frxUSD`,
        baseCurrency,
      });

      feeds.push({
        asset: assetSymbol,
        assetAddress,
        feedAddress: compositeConfig.proxy2,
        feedType: "Composite-2",
        pairDescription: `frxUSD/${baseCurrency}`,
        baseCurrency,
      });
    }
  }

  return feeds;
}

/**
 * Print feeds in table format
 */
function printFeedsTable(feeds: FeedSummary[]) {
  console.log("\n" + "=".repeat(120));
  console.log("📋 API3 FEEDS SUMMARY - KATANA MAINNET");
  console.log("=".repeat(120));

  if (feeds.length === 0) {
    console.log("❌ No API3 feeds configured.");
    return;
  }

  // Table headers
  const headers = ["Asset", "Pair", "Type", "Feed Address", "Asset Address"];
  const widths = [10, 15, 12, 44, 44];

  // Print header
  let header = "|";
  headers.forEach((h, i) => {
    header += ` ${h.padEnd(widths[i])} |`;
  });
  console.log(header);

  // Print separator
  let separator = "|";
  widths.forEach((w) => {
    separator += "-".repeat(w + 2) + "|";
  });
  console.log(separator);

  // Print rows
  feeds.forEach((feed) => {
    let row = "|";
    const values = [feed.asset, feed.pairDescription, feed.feedType, feed.feedAddress, feed.assetAddress];

    values.forEach((val, i) => {
      row += ` ${val.padEnd(widths[i])} |`;
    });
    console.log(row);
  });

  console.log("=".repeat(120));
  console.log(`📊 Total API3 feeds: ${feeds.length}`);
  console.log("=".repeat(120));

  // Group by base currency
  const usdFeeds = feeds.filter((f) => f.baseCurrency === "USD");
  const ethFeeds = feeds.filter((f) => f.baseCurrency === "ETH");

  console.log(`\n📈 USD Oracle Aggregator: ${usdFeeds.length} feeds`);
  usdFeeds.forEach((feed) => {
    console.log(`   • ${feed.asset} (${feed.feedType}): ${feed.feedAddress}`);
  });

  console.log(`\n🔗 ETH Oracle Aggregator: ${ethFeeds.length} feeds`);
  if (ethFeeds.length === 0) {
    console.log("   • No API3 feeds configured");
  } else {
    ethFeeds.forEach((feed) => {
      console.log(`   • ${feed.asset} (${feed.feedType}): ${feed.feedAddress}`);
    });
  }
}

/**
 * Main function
 */
async function main() {
  console.log("🚀 Listing API3 feeds for Katana Mainnet...");

  try {
    const feeds = await extractAPI3FeedsSummary();
    printFeedsTable(feeds);

    console.log("\n💡 Key Information:");
    console.log("   • All API3 feeds use 18 decimals by default");
    console.log("   • Oracle Aggregator expects 18 decimals");
    console.log("   • No decimal conversion needed for current feeds");
    console.log("   • Composite feeds multiply two prices: proxy1 × proxy2");
  } catch (error) {
    console.error("❌ Error listing feeds:", error);
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
