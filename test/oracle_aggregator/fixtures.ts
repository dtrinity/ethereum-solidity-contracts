import { deployments, getNamedAccounts } from "hardhat";
import hre from "hardhat";

import { getConfig } from "../../config/config";
import {
  RedstoneChainlinkCompositeWrapperWithThresholding,
  RedstoneChainlinkWrapper,
  RedstoneChainlinkWrapperWithThresholding,
} from "../../typechain-types";
import {
  ETH_REDSTONE_COMPOSITE_WRAPPER_WITH_THRESHOLDING_ID,
  ETH_REDSTONE_ORACLE_WRAPPER_ID,
  ETH_REDSTONE_WRAPPER_WITH_THRESHOLDING_ID,
  USD_REDSTONE_COMPOSITE_WRAPPER_WITH_THRESHOLDING_ID,
  USD_REDSTONE_ORACLE_WRAPPER_ID,
  USD_REDSTONE_WRAPPER_WITH_THRESHOLDING_ID,
} from "../../typescript/deploy-ids";

/**
 * Result interface for oracle aggregator fixtures
 */
export interface OracleAggregatorFixtureResult {
  contracts: {
    redstoneChainlinkWrapper: RedstoneChainlinkWrapper;
    redstoneChainlinkWrapperWithThresholding: RedstoneChainlinkWrapperWithThresholding;
    redstoneChainlinkCompositeWrapperWithThresholding: RedstoneChainlinkCompositeWrapperWithThresholding;
  };
  assets: {
    redstonePlainAssets: { [address: string]: { feed: string } };
    redstoneThresholdAssets: {
      [address: string]: {
        feed: string;
        lowerThreshold: bigint;
        fixedPrice: bigint;
      };
    };
    redstoneCompositeAssets: {
      [address: string]: {
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
  config: {
    priceDecimals: number;
    hardDStablePeg: bigint;
    baseCurrency: string;
  };
}

/**
 * Get oracle aggregator fixture for a specific currency
 * @param currency - The currency to get fixtures for (e.g., "USD", "S")
 * @returns A fixture function that deploys and configures oracle aggregator contracts
 */
export async function getOracleAggregatorFixture(currency: string) {
  return deployments.createFixture(
    async (): Promise<OracleAggregatorFixtureResult> => {
      // Get the current network configuration
      const config = await getConfig(hre);
      const oracleConfig = config.oracleAggregators[currency];
      
      if (!oracleConfig) {
        throw new Error(`Oracle aggregator config not found for currency: ${currency}`);
      }

      // Get contract instances based on currency
      let wrapperIds: {
        wrapper: string;
        wrapperWithThresholding: string;
        compositeWrapperWithThresholding: string;
      };

      if (currency === "USD") {
        wrapperIds = {
          wrapper: USD_REDSTONE_ORACLE_WRAPPER_ID,
          wrapperWithThresholding: USD_REDSTONE_WRAPPER_WITH_THRESHOLDING_ID,
          compositeWrapperWithThresholding: USD_REDSTONE_COMPOSITE_WRAPPER_WITH_THRESHOLDING_ID,
        };
      } else if (currency === "S" || currency === "ETH") {
        // Use ETH oracle wrappers (S is legacy, kept for compatibility)
        wrapperIds = {
          wrapper: ETH_REDSTONE_ORACLE_WRAPPER_ID,
          wrapperWithThresholding: ETH_REDSTONE_WRAPPER_WITH_THRESHOLDING_ID,
          compositeWrapperWithThresholding: ETH_REDSTONE_COMPOSITE_WRAPPER_WITH_THRESHOLDING_ID,
        };
      } else {
        throw new Error(`Unsupported currency: ${currency}. Only USD, S, and ETH are supported.`);
      }

      // Check if deployments exist, throw informative error if not
      let wrapperDeployment, wrapperWithThresholdingDeployment, compositeWrapperWithThresholdingDeployment;
      
      try {
        wrapperDeployment = await hre.deployments.get(wrapperIds.wrapper);
        wrapperWithThresholdingDeployment = await hre.deployments.get(
          wrapperIds.wrapperWithThresholding,
        );
        compositeWrapperWithThresholdingDeployment = await hre.deployments.get(
          wrapperIds.compositeWrapperWithThresholding,
        );
      } catch (error) {
        throw new Error(
          `Oracle aggregator integration tests require deployed oracle wrappers. ` +
          `Please run deployment scripts first or use a network with pre-deployed contracts. ` +
          `Missing deployment: ${error instanceof Error ? error.message : String(error)}`
        );
      }

      const redstoneChainlinkWrapper = await hre.ethers.getContractAt(
        "RedstoneChainlinkWrapper",
        wrapperDeployment.address,
      ) as RedstoneChainlinkWrapper;

      const redstoneChainlinkWrapperWithThresholding = await hre.ethers.getContractAt(
        "RedstoneChainlinkWrapperWithThresholding",
        wrapperWithThresholdingDeployment.address,
      ) as RedstoneChainlinkWrapperWithThresholding;

      const redstoneChainlinkCompositeWrapperWithThresholding = await hre.ethers.getContractAt(
        "RedstoneChainlinkCompositeWrapperWithThresholding",
        compositeWrapperWithThresholdingDeployment.address,
      ) as RedstoneChainlinkCompositeWrapperWithThresholding;

      // Build assets from config
      const redstonePlainAssets: { [address: string]: { feed: string } } = {};
      const redstoneThresholdAssets: {
        [address: string]: {
          feed: string;
          lowerThreshold: bigint;
          fixedPrice: bigint;
        };
      } = {};
      const redstoneCompositeAssets: {
        [address: string]: {
          feedAsset: string;
          feed1: string;
          feed2: string;
          lowerThresholdInBase1: bigint;
          fixedPriceInBase1: bigint;
          lowerThresholdInBase2: bigint;
          fixedPriceInBase2: bigint;
        };
      } = {};

      // Extract plain redstone assets
      for (const [assetAddress, feedAddress] of Object.entries(
        oracleConfig.redstoneOracleAssets.plainRedstoneOracleWrappers,
      )) {
        if (assetAddress && feedAddress) {
          redstonePlainAssets[assetAddress] = { feed: feedAddress };
        }
      }

      // Extract threshold assets
      for (const [assetAddress, assetConfig] of Object.entries(
        oracleConfig.redstoneOracleAssets.redstoneOracleWrappersWithThresholding,
      )) {
        if (assetAddress && assetConfig.feed) {
          redstoneThresholdAssets[assetAddress] = {
            feed: assetConfig.feed,
            lowerThreshold: assetConfig.lowerThreshold,
            fixedPrice: assetConfig.fixedPrice,
          };
        }
      }

      // Extract composite assets
      for (const [assetAddress, assetConfig] of Object.entries(
        oracleConfig.redstoneOracleAssets.compositeRedstoneOracleWrappersWithThresholding,
      )) {
        if (assetAddress && assetConfig.feed1 && assetConfig.feed2) {
          redstoneCompositeAssets[assetAddress] = {
            feedAsset: assetConfig.feedAsset,
            feed1: assetConfig.feed1,
            feed2: assetConfig.feed2,
            lowerThresholdInBase1: assetConfig.lowerThresholdInBase1,
            fixedPriceInBase1: assetConfig.fixedPriceInBase1,
            lowerThresholdInBase2: assetConfig.lowerThresholdInBase2,
            fixedPriceInBase2: assetConfig.fixedPriceInBase2,
          };
        }
      }

      return {
        contracts: {
          redstoneChainlinkWrapper,
          redstoneChainlinkWrapperWithThresholding,
          redstoneChainlinkCompositeWrapperWithThresholding,
        },
        assets: {
          redstonePlainAssets,
          redstoneThresholdAssets,
          redstoneCompositeAssets,
        },
        config: {
          priceDecimals: oracleConfig.priceDecimals,
          hardDStablePeg: oracleConfig.hardDStablePeg,
          baseCurrency: oracleConfig.baseCurrency,
        },
      };
    },
  );
}

/**
 * Utility function to get a random item from a list
 * @param items - Array of items to choose from
 * @returns A random item from the array
 */
export function getRandomItemFromList<T>(items: T[]): T {
  if (items.length === 0) {
    throw new Error("Cannot get random item from empty list");
  }
  const randomIndex = Math.floor(Math.random() * items.length);
  return items[randomIndex];
}