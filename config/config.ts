import { HardhatRuntimeEnvironment } from "hardhat/types";

import { getConfig as getEthereumMainNetConfig } from "./networks/ethereum_mainnet";
import { getConfig as getEthereumTestNetConfig } from "./networks/ethereum_testnet";
import { getConfig as getKatanaMainNetConfig } from "./networks/katana_mainnet";
import { getConfig as getKatanaTestNetConfig } from "./networks/katana_testnet";
import { getConfig as getLocalhostConfig } from "./networks/localhost";
import { Config } from "./types";

/**
 * Get the configuration for the network
 *
 * @param hre - Hardhat Runtime Environment
 * @returns The configuration for the network
 */
export async function getConfig(hre: HardhatRuntimeEnvironment): Promise<Config> {
  switch (hre.network.name) {
    case "katana_testnet":
      return getKatanaTestNetConfig(hre);
    case "katana_mainnet":
      return getKatanaMainNetConfig(hre);
    case "ethereum_testnet":
      return getEthereumTestNetConfig(hre);
    case "ethereum_mainnet":
      return getEthereumMainNetConfig(hre);
    case "hardhat":
    case "localhost":
      return getLocalhostConfig(hre);
    default:
      throw new Error(`Unknown network: ${hre.network.name}`);
  }
}
