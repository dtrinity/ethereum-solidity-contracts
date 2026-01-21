/**
 * Check if the network is local
 *
 * @param network - The network name
 * @returns True if the network is local, false otherwise
 */
export function isLocalNetwork(network: string): boolean {
  return network === "localhost" || network === "hardhat";
}

/**
 * Check if the network is ethereum_testnet
 *
 * @param network - The network name
 * @returns True if the network is ethereum_testnet, false otherwise
 */
export function isEthereumTestnet(network: string): boolean {
  return network === "ethereum_testnet";
}

/**
 * Check if the network is mainnet
 *
 * @param network - The network name
 * @returns True if the network is mainnet, false otherwise
 */
export function isMainnet(network: string): boolean {
  return network === "ethereum_mainnet";
}
