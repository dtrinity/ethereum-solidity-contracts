import "@typechain/hardhat";
import "@nomicfoundation/hardhat-ethers";
import "@nomicfoundation/hardhat-chai-matchers";
import "@nomicfoundation/hardhat-toolbox";
import "@nomicfoundation/hardhat-verify";
import "hardhat-deploy";
import "dotenv/config";

import { HardhatUserConfig } from "hardhat/config";

import { getEnvPrivateKeys } from "./typescript/hardhat/named-accounts";

/* eslint-disable camelcase -- Network names follow specific naming conventions that require snake_case */
const config: HardhatUserConfig = {
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
      // Core complex contract causing stack too deep errors
      "contracts/vaults/dloop/core/DLoopCoreBase.sol": {
        version: "0.8.20",
        settings: {
          optimizer: {
            enabled: true,
            runs: 200,
          },
          viaIR: true,
        },
      },
      "contracts/vaults/dloop/core/venue/dlend/DLoopCoreDLend.sol": {
        version: "0.8.20",
        settings: {
          optimizer: {
            enabled: true,
            runs: 200,
          },
          viaIR: true,
        },
      },
      // Testing harness that imports DLoopCoreDLend; ensure the compilation job uses IR
      "contracts/testing/dloop/DLoopCoreDLendHarness.sol": {
        version: "0.8.20",
        settings: {
          optimizer: {
            enabled: true,
            runs: 200,
          },
          viaIR: true,
        },
      },
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
      // Base contract with stack too deep errors
      "contracts/vaults/dloop/periphery/DLoopDepositorBase.sol": {
        version: "0.8.20",
        settings: {
          optimizer: {
            enabled: true,
            runs: 200,
          },
          viaIR: true,
        },
      },
      // Contracts that import DLoopDepositorBase
      "contracts/vaults/dloop/periphery/venue/odos/DLoopDepositorOdos.sol": {
        version: "0.8.20",
        settings: {
          optimizer: {
            enabled: true,
            runs: 200,
          },
          viaIR: true,
        },
      },
      "contracts/vaults/dloop/periphery/venue/mock/DLoopDepositorMock.sol": {
        version: "0.8.20",
        settings: {
          optimizer: {
            enabled: true,
            runs: 200,
          },
          viaIR: true,
        },
      },
      // Base redeemer contract with stack too deep errors
      "contracts/vaults/dloop/periphery/DLoopRedeemerBase.sol": {
        version: "0.8.20",
        settings: {
          optimizer: {
            enabled: true,
            runs: 200,
          },
          viaIR: true,
        },
      },
      // Contracts that import DLoopRedeemerBase
      "contracts/vaults/dloop/periphery/venue/odos/DLoopRedeemerOdos.sol": {
        version: "0.8.20",
        settings: {
          optimizer: {
            enabled: true,
            runs: 200,
          },
          viaIR: true,
        },
      },
      "contracts/vaults/dloop/periphery/venue/mock/DLoopRedeemerMock.sol": {
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
      "contracts/vaults/dstake/DStakeRouterDLend.sol": {
        version: "0.8.20",
        settings: {
          optimizer: {
            enabled: true,
            runs: 200,
          },
          viaIR: true,
        },
      },
      // Contracts that import DStakeRouterDLend
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
    },
  },
  networks: {
    hardhat: {
      deploy: ["deploy-mocks", "deploy"],
      allowUnlimitedContractSize: true,
      saveDeployments: false, // allow testing without needing to remove the previous deployments
    },
    localhost: {
      deploy: ["deploy-mocks", "deploy"],
      saveDeployments: true,
    },
    ethereum_testnet: {
      // Sepolia testnet
      url: `https://eth-sepolia.g.alchemy.com/v2/${process.env.ALCHEMY_API_KEY || "YOUR_API_KEY"}`,
      chainId: 11155111,
      deploy: ["deploy-mocks", "deploy"],
      saveDeployments: true,
      accounts: getEnvPrivateKeys("ethereum_testnet"),
    },
    ethereum_mainnet: {
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
      ethereum_mainnet:
        process.env.ETHERSCAN_API_KEY || "YOUR_ETHERSCAN_API_KEY",
      ethereum_testnet:
        process.env.ETHERSCAN_API_KEY || "YOUR_ETHERSCAN_API_KEY",
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
};
/* eslint-enable camelcase -- Re-enabling camelcase rule after network definitions */

export default config;
