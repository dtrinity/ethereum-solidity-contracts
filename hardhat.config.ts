import "dotenv/config";

import hardhatEthers from "@nomicfoundation/hardhat-ethers";
import hardhatEthersChaiMatchers from "@nomicfoundation/hardhat-ethers-chai-matchers";
import hardhatNetworkHelpers from "@nomicfoundation/hardhat-network-helpers";
import hardhatVerify from "@nomicfoundation/hardhat-verify";
import { defineConfig } from "hardhat/config";
import hardhatDeploy from "hardhat-deploy";

import { getEnvPrivateKeys } from "./typescript/hardhat/named-accounts";

/* eslint-disable camelcase -- Network names follow specific naming conventions that require snake_case */
const config = defineConfig({
  plugins: [hardhatDeploy, hardhatEthers, hardhatEthersChaiMatchers, hardhatNetworkHelpers, hardhatVerify],
  //
  // Compile settings -------------------------------------------------------
  //  • Default: classic solc pipeline (fast) with optimizer.
  //  • Set env `VIA_IR=true` to enable the IR pipeline for **all** contracts.
  //  • Always compile complex contracts and their dependencies with IR to avoid
  //    "stack too deep" errors, without slowing down the whole codebase.
  // -----------------------------------------------------------------------
  solidity: {
    compilers: [
      {
        version: "0.8.20",
        settings: {
          optimizer: {
            enabled: true,
            runs: 200,
          },
          ...(process.env.VIA_IR === "true" ? { viaIR: true } : {}),
        },
      },
      {
        version: "0.8.22",
        settings: {
          optimizer: {
            enabled: true,
            runs: 200,
          },
          ...(process.env.VIA_IR === "true" ? { viaIR: true } : {}),
        },
      },
    ],
    overrides: {
      // RewardClaimable is part of the inheritance chain; compile with IR as well
      "contracts/vaults/rewards_claimable/RewardClaimable.sol": {
        version: "0.8.20",
        settings: {
          optimizer: {
            enabled: true,
            runs: 200,
          },
          viaIR: true,
        },
      },
      // DStake router with stack too deep errors
      "contracts/vaults/dstake/DStakeRouterV2.sol": {
        version: "0.8.20",
        settings: {
          optimizer: {
            enabled: true,
            runs: 200,
          },
          viaIR: true,
        },
      },
      "contracts/vaults/dstake/DStakeTokenV2.sol": {
        version: "0.8.20",
        settings: {
          optimizer: {
            enabled: true,
            runs: 200,
          },
          viaIR: true,
        },
      },
      "contracts/vaults/dstake/DStakeCollateralVaultV2.sol": {
        version: "0.8.20",
        settings: {
          optimizer: {
            enabled: true,
            runs: 200,
          },
          viaIR: true,
        },
      },
      // Contracts that import DStakeRouterV2
      "contracts/vaults/dstake/rewards/DStakeRewardManagerDLend.sol": {
        version: "0.8.20",
        settings: {
          optimizer: {
            enabled: true,
            runs: 200,
          },
          viaIR: true,
        },
      },
      "contracts/vaults/dstake/rewards/DStakeRewardManagerMetaMorpho.sol": {
        version: "0.8.20",
        settings: {
          optimizer: {
            enabled: true,
            runs: 200,
          },
          viaIR: true,
        },
      },
      // Vesting NFT with stack too deep errors
      "contracts/vaults/vesting/ERC20VestingNFT.sol": {
        version: "0.8.20",
        settings: {
          optimizer: {
            enabled: true,
            runs: 200,
          },
          viaIR: true,
        },
      },
      "contracts/dstable/AmoManagerV2.sol": {
        version: "0.8.20",
        settings: {
          optimizer: {
            enabled: true,
            runs: 200,
          },
          viaIR: true,
        },
      },
    },
  },
  networks: {
    hardhat: {
      type: "edr-simulated",
      chainType: "l1",
      deploy: ["deploy-mocks", "deploy"],
      allowUnlimitedContractSize: true,
      saveDeployments: false, // allow testing without needing to remove the previous deployments
    },
    localhost: {
      type: "http",
      chainType: "l1",
      url: "http://127.0.0.1:8545",
      deploy: ["deploy-mocks", "deploy"],
      saveDeployments: true,
    },
    ethereum_testnet: {
      type: "http",
      chainType: "l1",
      // Sepolia testnet
      url: `https://sepolia.gateway.tenderly.co`,
      chainId: 11155111,
      deploy: ["deploy-mocks", "deploy"],
      saveDeployments: true,
      accounts: getEnvPrivateKeys("ethereum_testnet"),
    },
    ethereum_mainnet: {
      type: "http",
      chainType: "l1",
      url: `https://eth-mainnet.g.alchemy.com/v2/${process.env.ALCHEMY_API_KEY || "YOUR_API_KEY"}`,
      chainId: 1,
      deploy: ["deploy"], // NOTE: DO NOT DEPLOY mocks
      saveDeployments: true,
      accounts: getEnvPrivateKeys("ethereum_mainnet"),
    },
  },
  namedAccounts: {
    deployer: 0,
    user1: 1,
    user2: 2,
    user3: 3,
    user4: 4,
    user5: 5,
  },
  paths: {
    sources: "./contracts",
    tests: "./test",
    cache: "./cache",
    artifacts: "./artifacts",
    deployments: "./deployments",
    deploy: "./deploy",
  },
  gasReporter: {
    enabled: false, // Enable this when testing new complex functions
  },
  etherscan: {
    // Used for verifying single contracts when hardhat-deploy auto verify doesn't work
    apiKey: {
      ethereum_mainnet: process.env.ETHERSCAN_API_KEY || "YOUR_ETHERSCAN_API_KEY",
      ethereum_testnet: process.env.ETHERSCAN_API_KEY || "YOUR_ETHERSCAN_API_KEY",
    },
    customChains: [
      {
        network: "ethereum_testnet",
        chainId: 11155111,
        urls: {
          apiURL: "https://api-sepolia.etherscan.io/api",
          browserURL: "https://sepolia.etherscan.io",
        },
      },
    ],
  },
  sourcify: {
    // Just here to mute warning
    enabled: false,
  },
});
/* eslint-enable camelcase -- Re-enabling camelcase rule after network definitions */

export default config;
