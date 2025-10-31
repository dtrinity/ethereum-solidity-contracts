import { HardhatRuntimeEnvironment } from "hardhat/types";
import { DeployFunction } from "hardhat-deploy/types";

import { getConfig } from "../../config/config";
import { OracleAggregatorConfig } from "../../config/types";
import {
  DETH_TOKEN_ID,
  DUSD_TOKEN_ID,
  USD_API3_COMPOSITE_WRAPPER_WITH_THRESHOLDING_ID,
  USD_API3_ORACLE_WRAPPER_ID,
  USD_API3_WRAPPER_WITH_THRESHOLDING_ID,
  USD_REDSTONE_COMPOSITE_WRAPPER_WITH_THRESHOLDING_ID,
  USD_REDSTONE_ORACLE_WRAPPER_ID,
  USD_REDSTONE_WRAPPER_WITH_THRESHOLDING_ID,
} from "../../typescript/deploy-ids";

type Api3AssetConfig = OracleAggregatorConfig["api3OracleAssets"];
type RedstoneAssetConfig = OracleAggregatorConfig["redstoneOracleAssets"];

type ThresholdConfig = {
  lowerThreshold: bigint;
  fixedPrice: bigint;
};

type CompositeThresholdConfig = {
  feedAsset: string;
  feed1: string;
  feed2: string;
  lowerThresholdInBase1: bigint;
  fixedPriceInBase1: bigint;
  lowerThresholdInBase2: bigint;
  fixedPriceInBase2: bigint;
};

const func: DeployFunction = async function (hre: HardhatRuntimeEnvironment): Promise<boolean> {
  const { deployer } = await hre.getNamedAccounts();
  const config = await getConfig(hre);
  const oracleConfig = config.oracleAggregators.USD;

  const baseCurrencyUnit = 10n ** BigInt(oracleConfig.priceDecimals);
  const baseCurrency = oracleConfig.baseCurrency;

  await setupApi3Wrappers(hre, deployer, baseCurrency, baseCurrencyUnit, oracleConfig.api3OracleAssets);
  await setupRedstoneWrappers(hre, deployer, baseCurrency, baseCurrencyUnit, oracleConfig.redstoneOracleAssets);

  console.log(`🔮 ${__filename.split("/").slice(-2).join("/")}: ✅`);
  return true;
};

/**
 * Deploys and configures all API3-backed oracle wrappers for the USD aggregator.
 *
 * @param hre Hardhat runtime used for deployments and contract lookups.
 * @param deployer Account that pays for the wrapper deployments.
 * @param baseCurrency Asset used as the aggregator base currency (e.g. USD).
 * @param baseCurrencyUnit Number of base currency units corresponding to one whole unit (10**decimals).
 * @param assets Configuration object describing each API3 feed to wire.
 */
async function setupApi3Wrappers(
  hre: HardhatRuntimeEnvironment,
  deployer: string,
  baseCurrency: string,
  baseCurrencyUnit: bigint,
  assets?: Api3AssetConfig,
): Promise<void> {
  if (!assets) {
    console.log("  ⏭️  No API3 oracle assets configured – skipping");
    return;
  }

  const plainFeeds = assets.plainApi3OracleWrappers ?? {};

  if (Object.keys(plainFeeds).length > 0) {
    const deployment = await hre.deployments.deploy(USD_API3_ORACLE_WRAPPER_ID, {
      from: deployer,
      args: [baseCurrency, baseCurrencyUnit],
      contract: "API3WrapperV1_1",
      autoMine: true,
      log: true,
    });

    const wrapper = await hre.ethers.getContractAt("API3WrapperV1_1", deployment.address);

    for (const [assetAddress, proxyAddress] of Object.entries(plainFeeds)) {
      assertAddress(assetAddress, "plain API3 asset address");
      assertAddress(proxyAddress, `plain API3 proxy for ${assetAddress}`);
      await (await wrapper.setProxy(assetAddress, proxyAddress)).wait();
      console.log(`   ✅ Set API3 proxy ${proxyAddress} for asset ${assetAddress}`);
    }

    await performOracleSanityChecks(wrapper, plainFeeds, baseCurrencyUnit, "plain API3 proxies");
  }

  const thresholdFeeds = assets.api3OracleWrappersWithThresholding ?? {};

  if (Object.keys(thresholdFeeds).length > 0) {
    const deployment = await hre.deployments.deploy(USD_API3_WRAPPER_WITH_THRESHOLDING_ID, {
      from: deployer,
      args: [baseCurrency, baseCurrencyUnit],
      contract: "API3WrapperWithThresholdingV1_1",
      autoMine: true,
      log: true,
    });

    const wrapper = await hre.ethers.getContractAt("API3WrapperWithThresholdingV1_1", deployment.address);

    for (const [assetAddress, feedConfig] of Object.entries(thresholdFeeds)) {
      const typedConfig = feedConfig as { proxy: string } & ThresholdConfig;
      assertAddress(assetAddress, "threshold API3 asset address");
      assertAddress(typedConfig.proxy, `threshold API3 proxy for ${assetAddress}`);
      await (await wrapper.setProxy(assetAddress, typedConfig.proxy)).wait();
      await (await wrapper.setThresholdConfig(assetAddress, typedConfig.lowerThreshold, typedConfig.fixedPrice)).wait();
      console.log(`   ✅ Set API3 threshold config for asset ${assetAddress}`);
    }

    await performOracleSanityChecks(wrapper, thresholdFeeds, baseCurrencyUnit, "API3 proxies with thresholding");
  }

  const compositeFeeds = assets.compositeApi3OracleWrappersWithThresholding ?? {};

  if (Object.keys(compositeFeeds).length > 0) {
    const deployment = await hre.deployments.deploy(USD_API3_COMPOSITE_WRAPPER_WITH_THRESHOLDING_ID, {
      from: deployer,
      args: [baseCurrency, baseCurrencyUnit],
      contract: "API3CompositeWrapperWithThresholdingV1_1",
      autoMine: true,
      log: true,
    });

    const wrapper = await hre.ethers.getContractAt("API3CompositeWrapperWithThresholdingV1_1", deployment.address);

    for (const [assetAddress, feedConfig] of Object.entries(compositeFeeds)) {
      const typedConfig = feedConfig as CompositeThresholdConfig;
      assertAddress(assetAddress, "composite API3 asset address");
      assertAddress(typedConfig.feedAsset, "composite API3 feed asset");
      assertAddress(typedConfig.proxy1, "composite API3 proxy1");
      assertAddress(typedConfig.proxy2, "composite API3 proxy2");

      await (
        await wrapper.addCompositeFeed(
          typedConfig.feedAsset,
          typedConfig.proxy1,
          typedConfig.proxy2,
          typedConfig.lowerThresholdInBase1,
          typedConfig.fixedPriceInBase1,
          typedConfig.lowerThresholdInBase2,
          typedConfig.fixedPriceInBase2,
        )
      ).wait();
      console.log(`   ✅ Set composite API3 feed for asset ${assetAddress}`);
    }

    await performOracleSanityChecks(wrapper, compositeFeeds, baseCurrencyUnit, "API3 composite proxies");
  }
}

/**
 * Deploys and configures all Redstone-backed oracle wrappers for the USD aggregator.
 *
 * @param hre Hardhat runtime used for deployments and contract lookups.
 * @param deployer Account that pays for the wrapper deployments.
 * @param baseCurrency Asset used as the aggregator base currency (e.g. USD).
 * @param baseCurrencyUnit Number of base currency units corresponding to one whole unit (10**decimals).
 * @param assets Configuration object describing each Redstone feed to wire.
 */
async function setupRedstoneWrappers(
  hre: HardhatRuntimeEnvironment,
  deployer: string,
  baseCurrency: string,
  baseCurrencyUnit: bigint,
  assets?: RedstoneAssetConfig,
): Promise<void> {
  if (!assets) {
    console.log("  ⏭️  No Redstone oracle assets configured – skipping");
    return;
  }

  const plainFeeds = assets.plainRedstoneOracleWrappers ?? {};

  if (Object.keys(plainFeeds).length > 0) {
    const deployment = await hre.deployments.deploy(USD_REDSTONE_ORACLE_WRAPPER_ID, {
      from: deployer,
      args: [baseCurrency, baseCurrencyUnit],
      contract: "RedstoneChainlinkWrapperV1_1",
      autoMine: true,
      log: true,
    });

    const wrapper = await hre.ethers.getContractAt("RedstoneChainlinkWrapperV1_1", deployment.address);

    for (const [assetAddress, feed] of Object.entries(plainFeeds)) {
      assertAddress(assetAddress, "plain Redstone asset address");
      assertAddress(feed, `plain Redstone feed for ${assetAddress}`);
      await (await wrapper.setFeed(assetAddress, feed)).wait();
      console.log(`   ✅ Set Redstone feed ${feed} for asset ${assetAddress}`);
    }

    await performOracleSanityChecks(wrapper, plainFeeds, baseCurrencyUnit, "plain Redstone feeds");
  }

  const thresholdFeeds = assets.redstoneOracleWrappersWithThresholding ?? {};

  if (Object.keys(thresholdFeeds).length > 0) {
    const deployment = await hre.deployments.deploy(USD_REDSTONE_WRAPPER_WITH_THRESHOLDING_ID, {
      from: deployer,
      args: [baseCurrency, baseCurrencyUnit],
      contract: "RedstoneChainlinkWrapperWithThresholdingV1_1",
      autoMine: true,
      log: true,
    });

    const wrapper = await hre.ethers.getContractAt("RedstoneChainlinkWrapperWithThresholdingV1_1", deployment.address);

    for (const [assetAddress, feedConfig] of Object.entries(thresholdFeeds)) {
      const typedConfig = feedConfig as { feed: string } & ThresholdConfig;
      assertAddress(assetAddress, "threshold Redstone asset address");
      assertAddress(typedConfig.feed, `threshold Redstone feed for ${assetAddress}`);
      await (await wrapper.setFeed(assetAddress, typedConfig.feed)).wait();
      await (await wrapper.setThresholdConfig(assetAddress, typedConfig.lowerThreshold, typedConfig.fixedPrice)).wait();
      console.log(`   ✅ Set Redstone threshold config for asset ${assetAddress}`);
    }

    await performOracleSanityChecks(wrapper, thresholdFeeds, baseCurrencyUnit, "Redstone feeds with thresholding");
  }

  const compositeFeeds = assets.compositeRedstoneOracleWrappersWithThresholding ?? {};

  if (Object.keys(compositeFeeds).length > 0) {
    const deployment = await hre.deployments.deploy(USD_REDSTONE_COMPOSITE_WRAPPER_WITH_THRESHOLDING_ID, {
      from: deployer,
      args: [baseCurrency, baseCurrencyUnit],
      contract: "RedstoneChainlinkCompositeWrapperWithThresholdingV1_1",
      autoMine: true,
      log: true,
    });

    const wrapper = await hre.ethers.getContractAt("RedstoneChainlinkCompositeWrapperWithThresholdingV1_1", deployment.address);

    for (const [assetAddress, feedConfig] of Object.entries(compositeFeeds)) {
      const typedConfig = feedConfig as CompositeThresholdConfig;
      assertAddress(assetAddress, "composite Redstone asset address");
      assertAddress(typedConfig.feedAsset, "composite Redstone feed asset");
      assertAddress(typedConfig.feed1, "composite Redstone feed1");
      assertAddress(typedConfig.feed2, "composite Redstone feed2");

      await (
        await wrapper.addCompositeFeed(
          typedConfig.feedAsset,
          typedConfig.feed1,
          typedConfig.feed2,
          typedConfig.lowerThresholdInBase1,
          typedConfig.fixedPriceInBase1,
          typedConfig.lowerThresholdInBase2,
          typedConfig.fixedPriceInBase2,
        )
      ).wait();
      console.log(`   ✅ Set composite Redstone feed for asset ${assetAddress}`);
    }

    await performOracleSanityChecks(wrapper, compositeFeeds, baseCurrencyUnit, "composite Redstone feeds");
  }
}

/**
 * Performs lightweight sanity checks by sampling wrapper prices and logging any extreme values.
 *
 * @param wrapper Deployed wrapper instance to query.
 * @param feeds Mapping of asset addresses to feed configuration.
 * @param baseCurrencyUnit Scaling factor that converts prices into the base currency.
 * @param wrapperName Label used in logs so operators know which wrapper emitted the message.
 */
async function performOracleSanityChecks(
  wrapper: any,
  feeds: Record<string, unknown>,
  baseCurrencyUnit: bigint,
  wrapperName: string,
): Promise<void> {
  for (const [assetAddress] of Object.entries(feeds)) {
    try {
      const price = await wrapper.getAssetPrice(assetAddress);
      const normalizedPrice = Number(price) / Number(baseCurrencyUnit);

      if (normalizedPrice < 0.9 || normalizedPrice > 2) {
        console.warn(
          `   ⚠️  Sanity check warning for asset ${assetAddress} in ${wrapperName}: normalized price ${normalizedPrice} outside [0.9, 2]`,
        );
      } else {
        console.log(`   🔍 Sanity check passed for ${assetAddress} in ${wrapperName}: ${normalizedPrice}`);
      }
    } catch (error) {
      console.error(`   ❌ Error during sanity check for ${assetAddress} in ${wrapperName}:`, error);
      throw error;
    }
  }
}

/**
 * Asserts that a supplied value is a valid Ethereum address.
 *
 * @param value Address-like string to validate.
 * @param context Human-readable context used when throwing an error.
 */
function assertAddress(value: string, context: string): void {
  if (!/^0x[0-9a-fA-F]{40}$/.test(value)) {
    throw new Error(`[oracle-wrappers] Invalid address for ${context}: ${value}`);
  }
}

func.tags = ["local-setup", "dlend", "usd-oracle", "oracle-wrappers"];
func.dependencies = [DUSD_TOKEN_ID, DETH_TOKEN_ID];
func.id = "setup-usd-oracle-wrappers-v1_1";

export default func;
