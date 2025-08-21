# Sonic Reference Analysis for Ethereum Migration

## Overview
Complete analysis of all Sonic blockchain references that need to be updated for Ethereum migration. This includes network configurations, chain IDs, RPC endpoints, explorer URLs, deployment scripts, and documentation.

## Network Configuration Files

### 1. Core Configuration Files

#### `/config/networks/sonic_mainnet.ts`
- **Chain ID**: 146 (Sonic mainnet)
- **RPC URL**: `https://rpc.soniclabs.com`
- **Safe Config**: Chain ID 146, RPC URL `https://rpc.sonic.fantom.network`
- **Actions Required**: 
  - Rename file to `ethereum_mainnet.ts`
  - Update chain ID to 1 (Ethereum mainnet)
  - Update RPC URL to Ethereum mainnet RPC
  - Update Safe configuration
  - Update all token addresses to Ethereum equivalents
  - Update oracle configurations

#### `/config/networks/sonic_testnet.ts`
- **Chain ID**: 64165 (Sonic testnet)
- **RPC URL**: `https://rpc.sonic.fantom.network`
- **Actions Required**: 
  - Rename file to `ethereum_testnet.ts` or `sepolia.ts`
  - Update chain ID to 11155111 (Sepolia) or 5 (Goerli)
  - Update RPC URL to Ethereum testnet RPC
  - Update mock token configurations

#### `/hardhat.config.ts`
- **Lines 199-210**: Sonic network configurations
  - `sonic_testnet`: URL `https://rpc.blaze.soniclabs.com`, Chain ID not explicitly set
  - `sonic_mainnet`: URL `https://rpc.soniclabs.com`, Chain ID not explicitly set
- **Lines 234-244**: Etherscan verification for Sonic
  - API key: `4EJCRRD3JKIE6TKF6ME7AKVYWFEJI79A26`
  - Chain ID: 146
  - API URL: `https://api.sonicscan.org/api`
  - Browser URL: `https://sonicscan.org`
- **Actions Required**:
  - Replace sonic networks with ethereum networks
  - Update etherscan configuration for Ethereum

### 2. Named Accounts Configuration

#### `/typescript/hardhat/named-accounts.ts`
- **Lines 12-27**: Network-specific private key handling for `sonic_testnet` and `sonic_mainnet`
- **Lines 109-110**: Named account configuration for sonic networks
- **Actions Required**:
  - Update network names from sonic to ethereum
  - Update environment variable names

### 3. Governance Configuration

#### `/typescript/hardhat/governance.ts`
- **Line 16**: Comment references Sonic mainnet (chainId 146)
- **Line 39**: Hardcoded check for Sonic mainnet `chainIdStr === "146"`
- **Actions Required**:
  - Update chain ID check to Ethereum mainnet (1)
  - Update comments

## Deployment Scripts

### Shell Scripts in `/scripts/dloop/`
1. **`deploy-sonic-mainnet.sh`**
   - Sets `NETWORK="sonic_mainnet"`
   - **Action**: Rename to `deploy-ethereum-mainnet.sh` and update network name

2. **`deploy-sonic-mainnet-reset.sh`**
   - **Action**: Rename to `deploy-ethereum-mainnet-reset.sh` and update network name

3. **`deploy-sonic-testnet.sh`**
   - Sets `NETWORK="sonic_testnet"`
   - **Action**: Rename to `deploy-ethereum-testnet.sh` and update network name

4. **`deploy-sonic-testnet-reset.sh`**
   - **Action**: Rename to `deploy-ethereum-testnet-reset.sh` and update network name

### TypeScript Deployment Files
Multiple deployment scripts in `/deploy/` directory contain chain ID checks and network-specific logic:

1. **`/deploy/15_issue_redeem_v2/2_setup_redeemerv2.ts`**
   - **Lines 189-190**: Hardcoded Sonic mainnet check `chainIdStr === "146"`

2. **All files in `/deploy/12_dloop/` directory**
   - Multiple files contain `getChainId()` calls and network name logging
   - Need to update network names in console logs

## Build and Verification

### `/Makefile`
- **Lines 135-141**: Explorer verification targets for Sonic networks
  - `explorer.verify.sonic_testnet`: API URL `https://api-testnet.sonicscan.org`
  - `explorer.verify.sonic_mainnet`: API URL `https://api.sonicscan.org`
- **Actions Required**:
  - Replace with Ethereum explorer verification targets
  - Update API URLs to Etherscan

## Documentation

### `/README.md`
- **Line 1**: Title "dTRINITY Sonic Contracts"
- **Line 3**: "This repository contains the code and tooling for dTRINITY on Sonic."
- **Actions Required**: Update title and description

### `/CLAUDE.md`
- **Line 138**: "Sonic Mainnet: Production deployment"
- **Line 139**: "Sonic Testnet: Testing and development"
- **Actions Required**: Update network references

### `/docs/safe-protocol-kit-integration.md`
- **Multiple references to Sonic**:
  - Line 39: RPC URL `https://rpc.sonic.fantom.network`
  - Line 152: Chain ID 146 comment
  - Lines 180, 225, 264: RPC URL references
  - Line 424: Default chain ID 146
- **Actions Required**: Update all Sonic references to Ethereum

### `/docs/manual-explorer-verification.md`
- Contains Sonic-specific verification instructions
- **Actions Required**: Update to Ethereum/Etherscan

## Test Files

### `/test/pendle/` Directory
- **`fixture.ts`**: Line 2 `SONIC_MAINNET_PT_TOKENS` constant
- **`sdk.ts`**: Multiple references to `SONIC_MAINNET_PT_TOKENS`
- **`PendleSwapPOC.ts`**: References to Sonic mainnet PT tokens
- **Actions Required**: Update test fixtures for Ethereum mainnet tokens

## Environment Variables Referenced

Based on the codebase analysis, these environment variables need to be updated:

### Current Sonic Environment Variables:
- `MNEMONIC_TESTNET_DEPLOYER` → `MNEMONIC_ETHEREUM_TESTNET_DEPLOYER`
- `MNEMONIC_MAINNET_DEPLOYER` → `MNEMONIC_ETHEREUM_MAINNET_DEPLOYER`
- `PK_TESTNET_DEPLOYER` → `PK_ETHEREUM_TESTNET_DEPLOYER`
- `PK_MAINNET_DEPLOYER` → `PK_ETHEREUM_MAINNET_DEPLOYER`

## Chain ID Mappings

### Current Sonic Chain IDs → Target Ethereum Chain IDs:
- **Sonic Mainnet**: 146 → **Ethereum Mainnet**: 1
- **Sonic Testnet**: 64165 → **Sepolia**: 11155111 (or Goerli: 5)

## RPC URL Mappings

### Current Sonic RPCs → Target Ethereum RPCs:
- `https://rpc.soniclabs.com` → Ethereum mainnet RPC (e.g., Infura, Alchemy)
- `https://rpc.blaze.soniclabs.com` → Ethereum testnet RPC
- `https://rpc.sonic.fantom.network` → Ethereum testnet RPC

## Explorer URL Mappings

### Current Sonic Explorers → Target Ethereum Explorers:
- `https://api.sonicscan.org/api` → `https://api.etherscan.io/api`
- `https://sonicscan.org` → `https://etherscan.io`
- `https://api-testnet.sonicscan.org` → `https://api-sepolia.etherscan.io/api`

## Priority Files for Immediate Update

1. **High Priority** (Core functionality):
   - `/hardhat.config.ts`
   - `/config/networks/sonic_mainnet.ts`
   - `/config/networks/sonic_testnet.ts`
   - `/typescript/hardhat/named-accounts.ts`
   - `/Makefile`

2. **Medium Priority** (Deployment):
   - All files in `/scripts/dloop/`
   - All deployment scripts in `/deploy/`
   - `/typescript/hardhat/governance.ts`

3. **Low Priority** (Documentation and tests):
   - `/README.md`
   - `/CLAUDE.md`
   - All documentation in `/docs/`
   - Test files in `/test/pendle/`

## Token Address Updates Required

The network configuration files contain numerous hardcoded token addresses that are Sonic-specific and will need to be replaced with Ethereum equivalents:

- wS (Wrapped Sonic)
- stS (Staked Sonic)
- scUSD, scETH (Sonic-specific tokens)
- wstkscUSD, wstkscETH (Wrapped Staked Sonic tokens)
- All oracle feed addresses
- All Pendle PT token addresses

## Next Steps

1. **Create Ethereum network configuration files** based on sonic templates
2. **Update hardhat.config.ts** with Ethereum networks
3. **Update all deployment scripts** to use new network names
4. **Update environment variable names** throughout the codebase
5. **Replace all Sonic-specific token addresses** with Ethereum equivalents
6. **Update oracle configurations** for Ethereum price feeds
7. **Update documentation** to reflect Ethereum deployment
8. **Update test configurations** for Ethereum mainnet

## Files Requiring Complete Review

Total: **27 files** identified with Sonic references requiring updates for Ethereum migration.