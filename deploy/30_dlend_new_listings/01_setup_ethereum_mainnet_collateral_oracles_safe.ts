import { ZeroAddress } from "ethers";
import { HardhatRuntimeEnvironment } from "hardhat/types";
import { DeployFunction } from "hardhat-deploy/types";

import { getConfig } from "../../config/config";
import {
  USD_CHAINLINK_ERC4626_WRAPPER_ID,
  USD_ORACLE_AGGREGATOR_ID,
  USD_REDSTONE_COMPOSITE_WRAPPER_WITH_THRESHOLDING_ID,
  USD_REDSTONE_ORACLE_WRAPPER_ID,
} from "../../typescript/deploy-ids";
import { isLocalNetwork } from "../../typescript/hardhat/deploy";
import { GovernanceExecutor } from "../../typescript/hardhat/governance";

/**
 * Normalizes an address value for case-insensitive comparisons.
 *
 * @param address
 */
function normalize(address: string): string {
  return address.toLowerCase();
}

/**
 * Returns true when the address equals the canonical zero address.
 *
 * @param address
 */
function isZeroAddress(address: string): boolean {
  return normalize(address) === normalize(ZeroAddress);
}

const func: DeployFunction = async function (hre: HardhatRuntimeEnvironment): Promise<boolean> {
  if (isLocalNetwork(hre.network.name)) {
    console.log("🔁 setup-ethereum-mainnet-collateral-oracles-safe: local network detected – skipping");
    return true;
  }

  const { deployments, ethers } = hre;
  const { deployer } = await hre.getNamedAccounts();
  const signer = await ethers.getSigner(deployer);
  const config = await getConfig(hre);

  const executor = new GovernanceExecutor(hre, signer, config.safeConfig);

  if (!executor.useSafe) {
    throw new Error("Safe config is required for collateral oracle rollout. Provide config.safeConfig and enable Safe mode.");
  }

  await executor.initialize();

  const { address: aggregatorAddress } = await deployments.get(USD_ORACLE_AGGREGATOR_ID);
  const { address: plainWrapperAddress } = await deployments.get(USD_REDSTONE_ORACLE_WRAPPER_ID);
  const { address: compositeWrapperAddress } = await deployments.get(USD_REDSTONE_COMPOSITE_WRAPPER_WITH_THRESHOLDING_ID);
  const { address: erc4626WrapperAddress } = await deployments.get(USD_CHAINLINK_ERC4626_WRAPPER_ID);

  const aggregator = await ethers.getContractAt("OracleAggregatorV1_1", aggregatorAddress, signer);
  const plainWrapper = await ethers.getContractAt("RedstoneChainlinkWrapperV1_1", plainWrapperAddress, signer);
  const compositeWrapper = await ethers.getContractAt(
    "RedstoneChainlinkCompositeWrapperWithThresholdingV1_1",
    compositeWrapperAddress,
    signer,
  );
  const erc4626Wrapper = await ethers.getContractAt("ChainlinkERC4626WrapperV1_1", erc4626WrapperAddress, signer);

  const plainFeeds = config.oracleAggregators.USD.redstoneOracleAssets.plainRedstoneOracleWrappers;
  const compositeFeeds = config.oracleAggregators.USD.redstoneOracleAssets.compositeRedstoneOracleWrappersWithThresholding;
  const erc4626Feeds = config.oracleAggregators.USD.chainlinkErc4626OracleAssets ?? {};

  for (const [asset, feed] of Object.entries(plainFeeds)) {
    const currentFeed = await plainWrapper.assetToFeed(asset);

    if (normalize(currentFeed) !== normalize(feed)) {
      const data = plainWrapper.interface.encodeFunctionData("setFeed", [asset, feed]);
      await executor.tryOrQueue(
        async () => {
          throw new Error("Direct execution disabled: queue Safe transaction instead.");
        },
        () => ({ to: plainWrapperAddress, value: "0", data }),
      );
    }

    const currentOracle = await aggregator.assetOracles(asset);

    if (normalize(currentOracle) !== normalize(plainWrapperAddress)) {
      const data = aggregator.interface.encodeFunctionData("setOracle", [asset, plainWrapperAddress]);
      await executor.tryOrQueue(
        async () => {
          throw new Error("Direct execution disabled: queue Safe transaction instead.");
        },
        () => ({ to: aggregatorAddress, value: "0", data }),
      );
    }
  }

  for (const [_, feedConfig] of Object.entries(compositeFeeds)) {
    const feedAsset = feedConfig.feedAsset;
    const currentFeed = await compositeWrapper.compositeFeeds(feedAsset);

    const requiresUpdate =
      isZeroAddress(currentFeed.feed1) ||
      normalize(currentFeed.feed1) !== normalize(feedConfig.feed1) ||
      normalize(currentFeed.feed2) !== normalize(feedConfig.feed2) ||
      currentFeed.primaryThreshold.lowerThresholdInBase !== feedConfig.lowerThresholdInBase1 ||
      currentFeed.primaryThreshold.fixedPriceInBase !== feedConfig.fixedPriceInBase1 ||
      currentFeed.secondaryThreshold.lowerThresholdInBase !== feedConfig.lowerThresholdInBase2 ||
      currentFeed.secondaryThreshold.fixedPriceInBase !== feedConfig.fixedPriceInBase2;

    if (requiresUpdate) {
      const data = compositeWrapper.interface.encodeFunctionData("addCompositeFeed", [
        feedAsset,
        feedConfig.feed1,
        feedConfig.feed2,
        feedConfig.lowerThresholdInBase1,
        feedConfig.fixedPriceInBase1,
        feedConfig.lowerThresholdInBase2,
        feedConfig.fixedPriceInBase2,
      ]);
      await executor.tryOrQueue(
        async () => {
          throw new Error("Direct execution disabled: queue Safe transaction instead.");
        },
        () => ({ to: compositeWrapperAddress, value: "0", data }),
      );
    }

    const currentOracle = await aggregator.assetOracles(feedAsset);

    if (normalize(currentOracle) !== normalize(compositeWrapperAddress)) {
      const data = aggregator.interface.encodeFunctionData("setOracle", [feedAsset, compositeWrapperAddress]);
      await executor.tryOrQueue(
        async () => {
          throw new Error("Direct execution disabled: queue Safe transaction instead.");
        },
        () => ({ to: aggregatorAddress, value: "0", data }),
      );
    }
  }

  for (const [asset, feedConfig] of Object.entries(erc4626Feeds)) {
    const currentFeed = await erc4626Wrapper.erc4626Feeds(asset);
    const currentFeedAddress = currentFeed.priceFeed;
    const currentVaultAddress = currentFeed.vault;

    if (normalize(currentFeedAddress) !== normalize(feedConfig.feed) || normalize(currentVaultAddress) !== normalize(feedConfig.vault)) {
      const data = erc4626Wrapper.interface.encodeFunctionData("setERC4626Feed", [asset, feedConfig.vault, feedConfig.feed]);
      await executor.tryOrQueue(
        async () => {
          throw new Error("Direct execution disabled: queue Safe transaction instead.");
        },
        () => ({ to: erc4626WrapperAddress, value: "0", data }),
      );
    }

    const currentOracle = await aggregator.assetOracles(asset);

    if (normalize(currentOracle) !== normalize(erc4626WrapperAddress)) {
      const data = aggregator.interface.encodeFunctionData("setOracle", [asset, erc4626WrapperAddress]);
      await executor.tryOrQueue(
        async () => {
          throw new Error("Direct execution disabled: queue Safe transaction instead.");
        },
        () => ({ to: aggregatorAddress, value: "0", data }),
      );
    }
  }

  await executor.flush("Ethereum mainnet dLEND collateral oracle rollout");
  console.log("🔁 setup-ethereum-mainnet-collateral-oracles-safe: ✅");
  return true;
};

func.tags = ["post-deploy", "oracle-rollout", "usd-oracle", "safe"];
func.dependencies = [
  "setup-usd-oracle-wrappers-v1_1",
  "deploy-chainlink-erc4626-wrappers",
  "point-usd-aggregator-to-wrappers-v1_1",
  USD_ORACLE_AGGREGATOR_ID,
  USD_REDSTONE_ORACLE_WRAPPER_ID,
  USD_REDSTONE_COMPOSITE_WRAPPER_WITH_THRESHOLDING_ID,
  USD_CHAINLINK_ERC4626_WRAPPER_ID,
];
func.id = "setup-ethereum-mainnet-collateral-oracles-safe";

export default func;
