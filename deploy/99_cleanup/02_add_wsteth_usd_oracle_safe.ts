import { ZeroAddress } from "ethers";
import { HardhatRuntimeEnvironment } from "hardhat/types";
import { DeployFunction } from "hardhat-deploy/types";

import { getConfig } from "../../config/config";
import { USD_ORACLE_AGGREGATOR_ID, USD_REDSTONE_COMPOSITE_WRAPPER_WITH_THRESHOLDING_ID } from "../../typescript/deploy-ids";
import { isLocalNetwork } from "../../typescript/hardhat/deploy";
import { GovernanceExecutor } from "../../typescript/hardhat/governance";

type CompositeFeedConfig = {
  feedAsset: string;
  feed1: string;
  feed2: string;
  lowerThresholdInBase1: bigint;
  fixedPriceInBase1: bigint;
  lowerThresholdInBase2: bigint;
  fixedPriceInBase2: bigint;
};

/**
 * Resolve the composite feed config for the target asset.
 *
 * @param compositeFeeds - Composite feed map keyed by asset address.
 * @param assetAddress - Target asset address to locate.
 */
function findCompositeFeedConfig(
  compositeFeeds: Record<string, CompositeFeedConfig>,
  assetAddress: string,
): CompositeFeedConfig | undefined {
  const direct = compositeFeeds[assetAddress];

  if (direct) {
    return direct;
  }

  const normalized = assetAddress.toLowerCase();
  return Object.values(compositeFeeds).find((feed) => feed.feedAsset.toLowerCase() === normalized);
}

const func: DeployFunction = async function (hre: HardhatRuntimeEnvironment): Promise<boolean> {
  if (isLocalNetwork(hre.network.name)) {
    console.log("🔁 add-wsteth-usd-oracle-safe: local network detected – skipping");
    return true;
  }

  const { deployments, ethers } = hre;
  const { deployer } = await hre.getNamedAccounts();
  const deployerSigner = await ethers.getSigner(deployer);
  const config = await getConfig(hre);

  const wstethAddress = config.tokenAddresses.wstETH;

  if (!wstethAddress || wstethAddress.toLowerCase() === ZeroAddress.toLowerCase()) {
    console.log("🔁 add-wsteth-usd-oracle-safe: wstETH address missing – skipping");
    return true;
  }

  const compositeFeeds = config.oracleAggregators.USD?.redstoneOracleAssets?.compositeRedstoneOracleWrappersWithThresholding ?? {};
  const feedConfig = findCompositeFeedConfig(compositeFeeds, wstethAddress);

  if (!feedConfig) {
    console.log("🔁 add-wsteth-usd-oracle-safe: no USD composite feed config for wstETH – skipping");
    return true;
  }

  const executor = new GovernanceExecutor(hre, deployerSigner, config.safeConfig);

  if (!executor.useSafe) {
    throw new Error("Safe config is required for wstETH oracle wiring. Provide config.safeConfig and set USE_SAFE=true if needed.");
  }

  await executor.initialize();

  const { address: oracleAggregatorAddress } = await deployments.get(USD_ORACLE_AGGREGATOR_ID);
  const { address: wrapperAddress } = await deployments.get(USD_REDSTONE_COMPOSITE_WRAPPER_WITH_THRESHOLDING_ID);

  const oracleAggregator = await ethers.getContractAt("OracleAggregatorV1_1", oracleAggregatorAddress, deployerSigner);
  const compositeWrapper = await ethers.getContractAt(
    "RedstoneChainlinkCompositeWrapperWithThresholdingV1_1",
    wrapperAddress,
    deployerSigner,
  );

  const existingFeed = await compositeWrapper.compositeFeeds(feedConfig.feedAsset);

  if (existingFeed.feed1.toLowerCase() === ZeroAddress.toLowerCase()) {
    const txData = compositeWrapper.interface.encodeFunctionData("addCompositeFeed", [
      feedConfig.feedAsset,
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
      () => ({ to: wrapperAddress, value: "0", data: txData }),
    );
  } else {
    console.log("   ✓ wstETH composite feed already configured on USD composite wrapper");
  }

  const currentOracle = await oracleAggregator.assetOracles(wstethAddress);

  if (currentOracle.toLowerCase() !== wrapperAddress.toLowerCase()) {
    const txData = oracleAggregator.interface.encodeFunctionData("setOracle", [wstethAddress, wrapperAddress]);

    await executor.tryOrQueue(
      async () => {
        throw new Error("Direct execution disabled: queue Safe transaction instead.");
      },
      () => ({ to: oracleAggregatorAddress, value: "0", data: txData }),
    );
  } else {
    console.log("   ✓ wstETH already routed to USD composite wrapper");
  }

  await executor.flush("Add wstETH USD composite oracle feed");
  console.log("🔁 add-wsteth-usd-oracle-safe: ✅");
  return true;
};

func.tags = ["post-deploy", "oracle-fix", "usd-oracle", "safe"];
func.dependencies = [
  "setup-usd-oracle-wrappers-v1_1",
  "point-usd-aggregator-to-wrappers-v1_1",
  USD_ORACLE_AGGREGATOR_ID,
  USD_REDSTONE_COMPOSITE_WRAPPER_WITH_THRESHOLDING_ID,
];
func.id = "add-wsteth-usd-oracle-safe";

export default func;
