#!/bin/bash

# Deploy DLoop to Ethereum Mainnet
# Usage: ./scripts/dloop/deploy-ethereum-mainnet.sh

set -e

NETWORK="ethereum_mainnet"

echo "Deploying DLoop to ${NETWORK}..."
yarn hardhat deploy --tags dloop --network ${NETWORK}
echo "DLoop deployment to ${NETWORK} completed!"