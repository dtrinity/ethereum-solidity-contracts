#!/bin/bash

# Deploy DLoop to Ethereum Testnet (Sepolia) with Reset
# Usage: ./scripts/dloop/deploy-ethereum-testnet-reset.sh

set -e

NETWORK="ethereum_testnet"
DEPLOYMENT_KEYWORDS="DLoop,OdosSwapLogic"

echo "Resetting deployments for ${NETWORK}..."
./scripts/deployments/clean-deployments.sh ${DEPLOYMENT_KEYWORDS} ${NETWORK}

echo "Deploying DLoop to ${NETWORK}..."
yarn hardhat deploy --tags dloop --network ${NETWORK}
echo "DLoop deployment to ${NETWORK} with reset completed!"