import "@nomicfoundation/hardhat-ethers";
import "@nomicfoundation/hardhat-chai-matchers";
import "@nomicfoundation/hardhat-toolbox";
import "@nomicfoundation/hardhat-verify";
import "hardhat-deploy";
import "hardhat-contract-sizer";
import "dotenv/config";
import "@typechain/hardhat";

import type { Signer, TransactionRequest, TransactionResponse } from "ethers";
import { extendEnvironment, HardhatUserConfig } from "hardhat/config";
import { HardhatRuntimeEnvironment } from "hardhat/types";

import { getEnvPrivateKeys } from "./typescript/hardhat/named-accounts";

const sleep = (ms: number): Promise<void> => new Promise((resolve) => setTimeout(resolve, ms));

// Wrapper function to add a delay to transactions
const wrapSigner = <TSigner extends Signer>(signer: TSigner, hre: HardhatRuntimeEnvironment): TSigner => {
  const originalSendTransaction = signer.sendTransaction.bind(signer);

  const wrappedSendTransaction: (tx: TransactionRequest) => Promise<TransactionResponse> = async (tx) => {
    const result = await originalSendTransaction(tx);

    if (hre.network.live) {
      const sleepTime = 20000; // 20 seconds to reduce flakiness from eventual consistency
      console.log(`\n>>> Waiting ${sleepTime}ms after transaction to ${result.to || "a new contract"}`);
      await sleep(sleepTime);
    }
    return result;
  };

  (signer as TSigner & { sendTransaction: typeof wrappedSendTransaction }).sendTransaction = wrappedSendTransaction;

  return signer;
};

extendEnvironment((hre: HardhatRuntimeEnvironment) => {
  // Wrap hre.ethers.getSigner
  const originalGetSigner = hre.ethers.getSigner;

  hre.ethers.getSigner = (async (address) => {
    const signer = await originalGetSigner(address);
    return wrapSigner(signer, hre);
  }) as typeof hre.ethers.getSigner;

  // Wrap hre.ethers.getSigners
  const originalGetSigners = hre.ethers.getSigners;

  hre.ethers.getSigners = (async () => {
    const signers = await originalGetSigners();
    return signers.map((signer) => wrapSigner(signer, hre));
  }) as typeof hre.ethers.getSigners;
});

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
      url: `https://sepolia.gateway.tenderly.co`,
      chainId: 11155111,
      deploy: ["deploy-mocks", "deploy"],
      saveDeployments: true,
      accounts: getEnvPrivateKeys("ethereum_testnet"),
    },
    ethereum_mainnet: {
      url: "https://ethereum-rpc.publicnode.com",
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
    apiKey: process.env.ETHERSCAN_API_KEY || "YOUR_ETHERSCAN_API_KEY",
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
  contractSizer: {
    alphaSort: true,
    disambiguatePaths: false,
    runOnCompile: false,
    only: ["DStakeRouterV2"],
  },
};
/* eslint-enable camelcase -- Re-enabling camelcase rule after network definitions */

export default config;
