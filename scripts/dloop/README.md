# DLoop Deployment Scripts

This directory contains shell scripts for deploying DLoop contracts to various networks.

## Available Scripts

### Generic Deployment Script

- **`deploy.sh`** - Generic deployment script that accepts network and optional reset parameters

  ```bash
  ./scripts/dloop/deploy.sh <network> [reset] [deployment_keywords]
  ```

  Examples:

  ```bash
  # Deploy to ethereum mainnet
  ./scripts/dloop/deploy.sh ethereum_mainnet

  # Deploy to ethereum testnet with reset
  ./scripts/dloop/deploy.sh ethereum_testnet true DLoop
  ```

### Network-Specific Scripts

- **`deploy-ethereum-mainnet.sh`** - Deploy DLoop to Ethereum Mainnet

  ```bash
  ./scripts/dloop/deploy-ethereum-mainnet.sh
  ```

- **`deploy-ethereum-mainnet-reset.sh`** - Deploy DLoop to Ethereum Mainnet with reset

  ```bash
  ./scripts/dloop/deploy-ethereum-mainnet-reset.sh
  ```

- **`deploy-ethereum-testnet.sh`** - Deploy DLoop to Ethereum Testnet (Sepolia)

  ```bash
  ./scripts/dloop/deploy-ethereum-testnet.sh
  ```

- **`deploy-ethereum-testnet-reset.sh`** - Deploy DLoop to Ethereum Testnet (Sepolia) with reset

  ```bash
  ./scripts/dloop/deploy-ethereum-testnet-reset.sh
  ```

## Migration from Makefile

These scripts replace the following Makefile targets:

- `make deploy.dloop.ethereum_mainnet` → `./scripts/dloop/deploy-ethereum-mainnet.sh`
- `make deploy.dloop.ethereum_mainnet.reset` → `./scripts/dloop/deploy-ethereum-mainnet-reset.sh`
- `make deploy.dloop.ethereum_testnet` → `./scripts/dloop/deploy-ethereum-testnet.sh`
- `make deploy.dloop.ethereum_testnet.reset` → `./scripts/dloop/deploy-ethereum-testnet-reset.sh`
- `make deploy.dloop network=<network>` → `./scripts/dloop/deploy.sh <network>`

## Prerequisites

- Node.js and Yarn installed
- Hardhat configured with appropriate network settings
- Required environment variables set for the target network
