#!/bin/bash

# Deploy DLoop to Ethereum Testnet (Sepolia)
# Usage: ./scripts/dloop/deploy-ethereum-testnet.sh

set -e

NETWORK="ethereum_testnet"

echo "Deploying DLoop to ${NETWORK}..."
yarn hardhat deploy --tags dloop --network ${NETWORK}
echo "DLoop deployment to ${NETWORK} completed!"