import { HardhatRuntimeEnvironment } from "hardhat/types";
import { DeployFunction } from "hardhat-deploy/types";

import { isLocalNetwork } from "../../typescript/hardhat/deploy";

const func: DeployFunction = async function (hre: HardhatRuntimeEnvironment): Promise<boolean> {
  const { deployments, getNamedAccounts, network } = hre;
  const { deployer } = await getNamedAccounts();

  if (isLocalNetwork(network.name)) {
    console.log("🔁 deploy-reth-chainlink-composite-aggregator: local network detected – skipping");
    return true;
  }

  // We only need this on mainnet for rETH
  if (network.name !== "ethereum_mainnet") {
    return true;
  }

  const RETH_ETH_FEED = "0x536218f9E9Eb48863970252233c8F271f554C2d0";
  const ETH_USD_FEED = "0x5f4eC3Df9cbd43714FE2740f5E3616155c5b8419";

  console.log("Deploying ChainlinkCompositeAggregator for rETH...");

  await deployments.deploy("RETH_USD_ChainlinkCompositeAggregator", {
    contract: "ChainlinkCompositeAggregator",
    from: deployer,
    args: [RETH_ETH_FEED, ETH_USD_FEED, { lowerThresholdInBase: 0, fixedPriceInBase: 0 }, { lowerThresholdInBase: 0, fixedPriceInBase: 0 }],
    log: true,
    autoMine: true,
  });

  console.log("🔁 deploy-reth-chainlink-composite-aggregator: ✅");
  return true;
};

func.tags = ["post-deploy", "oracle-rollout", "deploy-reth-chainlink-composite-aggregator"];
func.id = "deploy-reth-chainlink-composite-aggregator";

export default func;
