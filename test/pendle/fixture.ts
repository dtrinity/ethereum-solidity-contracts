// PT tokens from ethereum_mainnet.ts config
export const ETHEREUM_MAINNET_PT_TOKENS = {
  PTsyrupUSDC: {
    name: "PT-syrupUSDC-30OCT2025",
    address: "0x00026e3311937bad48d9ab894c42134306e1698d",
    market: "0x8f7eddfa1a03d872da73d9588b040b608238f863",
    underlyingToken: "0x80ac24aa929eaf5013f6436cda2a7ba190f5cc0b", // syrupUSDC
    asset: "0xa0b86991c6218b36c1d19d4a2e9eb0ce3606eb48", // USDC
    decimals: 18,
    yt: "0xf9294a1611169acf336791a206a15b55c9644abb",
  },
  PTsUSDe: {
    name: "PT-sUSDe-25SEP2025",
    address: "0x9f56094c450763769ba0ea9fe2876070c0fd5f77",
    market: "0xa36b60a14a1a5247912584768c6e53e1a269a9f7",
    asset: "0x4c9edd5852cd905f086c759e8383e09bff1e68b3", // USDe
    underlyingToken: "0x9d39a5de30e57443bff2a8307a4256c8797a3497", // sUSDe
    decimals: 18,
    yt: "0x029d6247adb0a57138c62e3019c92d3dfc9c1840",
  },
};

export const ETHEREUM_PY_FACTORY = "0xdF3601014686674e53d1Fa52F7602525483F9122"; // https://etherscan.io/address/0xdF3601014686674e53d1Fa52F7602525483F9122#code
export const ETHEREUM_CHAIN_ID = 1; // Ethereum mainnet chain ID
