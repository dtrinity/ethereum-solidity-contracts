import { HardhatRuntimeEnvironment } from "hardhat/types";
import { DeployFunction } from "hardhat-deploy/types";

import { getConfig } from "../../config/config";
import {
  ETH_ORACLE_AGGREGATOR_ID,
  ETH_REDSTONE_COMPOSITE_WRAPPER_WITH_THRESHOLDING_ID,
  ETH_REDSTONE_ORACLE_WRAPPER_ID,
  ETH_REDSTONE_WRAPPER_WITH_THRESHOLDING_ID,
} from "../../typescript/deploy-ids";

const func: DeployFunction = async function (hre: HardhatRuntimeEnvironment) {
  const config = await getConfig(hre);

  // Get ETH OracleAggregator contract
  const oracleAggregatorDeployment = await hre.deployments.get(ETH_ORACLE_AGGREGATOR_ID);
  const oracleAggregator = await hre.ethers.getContractAt("OracleAggregator", oracleAggregatorDeployment.address);

  // Get ETH RedstoneChainlinkWrapper for plain feeds
  const redstoneWrapperDeployment = await hre.deployments.get(ETH_REDSTONE_ORACLE_WRAPPER_ID);
  const redstoneWrapperAddress = redstoneWrapperDeployment.address;

  // Get ETH RedstoneChainlinkWrapperWithThresholding for feeds with thresholding
  const redstoneWrapperWithThresholdingDeployment = await hre.deployments.get(ETH_REDSTONE_WRAPPER_WITH_THRESHOLDING_ID);
  const redstoneWrapperWithThresholdingAddress = redstoneWrapperWithThresholdingDeployment.address;

  // Get S RedstoneChainlinkCompositeWrapperWithThresholding for composite feeds
  const redstoneCompositeWrapperDeployment = await hre.deployments.get(ETH_REDSTONE_COMPOSITE_WRAPPER_WITH_THRESHOLDING_ID);
  const redstoneCompositeWrapperAddress = redstoneCompositeWrapperDeployment.address;

  // Set plain Redstone oracle wrappers
  const plainFeeds = config.oracleAggregators.ETH.redstoneOracleAssets?.plainRedstoneOracleWrappers || {};

  for (const [assetAddress, _feed] of Object.entries(plainFeeds)) {
    await oracleAggregator.setOracle(assetAddress, redstoneWrapperAddress);
    console.log(`Set plain Redstone wrapper for asset ${assetAddress} to ${redstoneWrapperAddress}`);
  }

  // Set Redstone oracle wrappers with thresholding
  const thresholdFeeds = config.oracleAggregators.ETH.redstoneOracleAssets?.redstoneOracleWrappersWithThresholding || {};

  for (const [assetAddress, _config] of Object.entries(thresholdFeeds)) {
    await oracleAggregator.setOracle(assetAddress, redstoneWrapperWithThresholdingAddress);
    console.log(`Set Redstone wrapper with thresholding for asset ${assetAddress} to ${redstoneWrapperWithThresholdingAddress}`);
  }

  // Set composite Redstone wrapper for assets
  const compositeFeeds = config.oracleAggregators.ETH.redstoneOracleAssets?.compositeRedstoneOracleWrappersWithThresholding || {};

  for (const [_assetAddress, feedConfig] of Object.entries(compositeFeeds)) {
    await oracleAggregator.setOracle(feedConfig.feedAsset, redstoneCompositeWrapperAddress);
    console.log(`Set composite Redstone wrapper for asset ${feedConfig.feedAsset} to ${redstoneCompositeWrapperAddress}`);
  }

  console.log(`🔮 ${__filename.split("/").slice(-2).join("/")}: ✅`);
  // Return true to indicate deployment success
  return true;
};

func.tags = ["deth", "s-oracle", "oracle-aggregator", "oracle-wrapper", "s-redstone-wrapper"];
func.dependencies = [
  ETH_ORACLE_AGGREGATOR_ID,
  ETH_REDSTONE_ORACLE_WRAPPER_ID,
  ETH_REDSTONE_WRAPPER_WITH_THRESHOLDING_ID,
  ETH_REDSTONE_COMPOSITE_WRAPPER_WITH_THRESHOLDING_ID,
];
func.id = "point-eth-aggregator-to-redstone-wrappers";

export default func;
