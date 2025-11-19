import { HardhatRuntimeEnvironment } from "hardhat/types";

import { getConfig as getEthereumMainNetConfig } from "./networks/ethereum_mainnet";
import { getConfig as getEthereumTestNetConfig } from "./networks/ethereum_testnet";
import { getConfig as getLocalhostConfig } from "./networks/localhost";
import { Config } from "./types";

/**
 * Get the configuration for the network
 *
 * @param hre - Hardhat Runtime Environment
 * @returns The configuration for the network
 */
export async function getConfig(hre: HardhatRuntimeEnvironment): Promise<Config> {
  const networkName = hre.network?.name ?? (hre as unknown as { networkName?: string }).networkName;

  if (!networkName) {
    throw new Error("Unable to determine current network name");
  }
  const normalizedNetworkName = networkName === "default" ? "hardhat" : networkName;

  switch (normalizedNetworkName) {
    case "ethereum_testnet":
      return getEthereumTestNetConfig(hre);
    case "ethereum_mainnet":
      return getEthereumMainNetConfig(hre);
    case "hardhat":
    case "localhost":
      return getLocalhostConfig(hre);
    default:
      throw new Error(`Unknown network: ${networkName}`);
  }
}
