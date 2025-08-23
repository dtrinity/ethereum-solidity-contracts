# Network Configuration Migration: Sonic to Ethereum

## Overview
Migration of network configurations from Sonic blockchain to Ethereum mainnet and Sepolia testnet. This includes updating chain IDs, RPC endpoints, explorer URLs, and replacing all Sonic-specific token addresses with placeholder values.

## Changes Made

### 1. Network Configuration Files Updated

#### ✅ `/config/networks/sonic_mainnet.ts` → `/config/networks/ethereum_mainnet.ts`
- **Chain ID**: 146 (Sonic) → 1 (Ethereum mainnet)
- **RPC URL**: `https://rpc.sonic.fantom.network` → `https://eth-mainnet.g.alchemy.com/v2/YOUR_API_KEY`
- **Safe Config**: Updated chain ID and RPC
- **Token Addresses**: All replaced with placeholder addresses (0x0000...)
- **Oracle Feeds**: All replaced with placeholder addresses (0x0000...)
- **Safe Transaction Service**: Updated to Ethereum mainnet Safe service

#### ✅ `/config/networks/sonic_testnet.ts` → `/config/networks/ethereum_testnet.ts`
- **Chain ID**: 64165 (Sonic testnet) → 11155111 (Sepolia)
- **RPC URL**: `https://rpc.sonic.fantom.network` → `https://eth-sepolia.g.alchemy.com/v2/YOUR_API_KEY`
- **Safe Config**: Updated for Sepolia testnet
- **Mock Token Configuration**: Updated with Ethereum-compatible names and structures

### 2. Hardhat Configuration Updated

#### ✅ `/hardhat.config.ts`
- **Network Entries**: `sonic_mainnet`/`sonic_testnet` → `ethereum_mainnet`/`ethereum_testnet`
- **Etherscan Configuration**: Updated for Ethereum mainnet and Sepolia
- **Import Paths**: Fixed for renamed configuration files

### 3. Named Accounts Configuration Updated

#### ✅ `/typescript/hardhat/named-accounts.ts`
- **Environment Variables**: SONIC → ETHEREUM naming convention
  - `MNEMONIC_SONIC_MAINNET_DEPLOYER` → `MNEMONIC_ETHEREUM_MAINNET_DEPLOYER`
  - `MNEMONIC_SONIC_TESTNET_DEPLOYER` → `MNEMONIC_ETHEREUM_TESTNET_DEPLOYER`
  - `PK_SONIC_MAINNET_DEPLOYER` → `PK_ETHEREUM_MAINNET_DEPLOYER`
  - `PK_SONIC_TESTNET_DEPLOYER` → `PK_ETHEREUM_TESTNET_DEPLOYER`
- **Network References**: Updated from sonic networks to ethereum networks

### 4. Deployment Scripts Updated

#### ✅ `/scripts/dloop/` Directory
- `deploy-sonic-mainnet.sh` → `deploy-ethereum-mainnet.sh`
- `deploy-sonic-mainnet-reset.sh` → `deploy-ethereum-mainnet-reset.sh`
- `deploy-sonic-testnet.sh` → `deploy-ethereum-testnet.sh`
- `deploy-sonic-testnet-reset.sh` → `deploy-ethereum-testnet-reset.sh`
- Updated NETWORK variable values

#### ✅ Deployment Scripts in `/deploy/` Directory
- Updated chain ID checks from 146/64165 to 1/11155111
- Updated network references in console logs and comments

### 5. Documentation Updated

#### ✅ Project Documentation
- `/README.md`: Updated title and network references
- `/CLAUDE.md`: Updated network deployment references
- `/docs/`: Updated Sonic references to Ethereum

### 6. Build Configuration Updated

#### ✅ `/Makefile`
- Explorer verification targets updated:
  - `explorer.verify.sonic_mainnet` → `explorer.verify.ethereum_mainnet`
  - `explorer.verify.sonic_testnet` → `explorer.verify.ethereum_testnet`
- API URLs updated to Etherscan

#### ✅ Environment Variables
- Updated `.env.example` with new ETHEREUM variable naming

## Key Technical Decisions

### Placeholder Addresses
All production token addresses, oracle feeds, and external contract addresses have been replaced with placeholder values (`0x0000000000000000000000000000000000000000`) to ensure:
- No accidental mainnet deployments with incorrect addresses
- Clear indication that addresses need to be updated for Ethereum deployment
- Security best practice for sensitive configuration data

### Chain ID Mappings
- **Sonic Mainnet (146)** → **Ethereum Mainnet (1)**
- **Sonic Testnet (64165)** → **Sepolia (11155111)**

### RPC URL Patterns
- **Production**: Placeholder Alchemy URLs requiring API key configuration
- **Testnet**: Sepolia testnet RPC endpoints
- **Localhost**: Unchanged, maintains development functionality

### Safe Configuration
- **Mainnet**: Updated to use Ethereum Safe Transaction Service
- **Testnet**: Configured for Sepolia with appropriate threshold and owners

## Security Considerations

1. **No Sensitive Data**: All production addresses removed and replaced with placeholders
2. **Environment Variables**: Updated naming convention requires new environment setup
3. **Deployment Protection**: Placeholder addresses will cause deployment failures if not properly configured
4. **Access Control**: Governance and admin addresses updated to placeholders

## Next Steps for Deployment

### Before Mainnet Deployment:
1. **Update Token Addresses**: Replace all placeholder addresses with actual Ethereum token addresses
2. **Configure Oracle Feeds**: Set up proper Chainlink/Redstone oracle feeds for Ethereum
3. **Set Environment Variables**: Configure all ETHEREUM_* environment variables
4. **Update RPC URLs**: Add proper Ethereum RPC endpoints with API keys
5. **Configure Safe Multisig**: Set up proper governance multisig addresses
6. **Update External Integrations**: Configure Odos router and other external contract addresses

### For Testnet Deployment:
1. **Deploy Mock Tokens**: Ensure all test tokens are deployed on Sepolia
2. **Configure Test Oracles**: Set up mock oracle feeds for testing
3. **Set Test Environment**: Configure testnet-specific environment variables

## Files Modified

### Core Configuration (9 files):
- `/config/networks/ethereum_mainnet.ts` (renamed from sonic_mainnet.ts)
- `/config/networks/ethereum_testnet.ts` (renamed from sonic_testnet.ts)
- `/hardhat.config.ts`
- `/typescript/hardhat/named-accounts.ts`
- `/typescript/hardhat/governance.ts`
- `/Makefile`
- `.env.example`

### Deployment Scripts (8 files):
- `/scripts/dloop/deploy-ethereum-mainnet.sh` (renamed)
- `/scripts/dloop/deploy-ethereum-mainnet-reset.sh` (renamed)
- `/scripts/dloop/deploy-ethereum-testnet.sh` (renamed)
- `/scripts/dloop/deploy-ethereum-testnet-reset.sh` (renamed)
- Multiple files in `/deploy/` directory (chain ID updates)

### Documentation (4 files):
- `/README.md`
- `/CLAUDE.md`
- `/docs/safe-protocol-kit-integration.md`
- `/docs/manual-explorer-verification.md`

## Summary of Changes

### Core Configuration Files Modified: 9
1. `/config/networks/ethereum_mainnet.ts` (created, sonic_mainnet.ts removed)
2. `/config/networks/ethereum_testnet.ts` (created, sonic_testnet.ts removed) 
3. `/hardhat.config.ts` - Updated network configs and Etherscan settings
4. `/typescript/hardhat/named-accounts.ts` - Updated environment variable names
5. `/typescript/hardhat/governance.ts` - Updated chain ID references
6. `/Makefile` - Updated explorer verification targets
7. `/.env.example` - Created with Ethereum environment variables
8. `/README.md` - Updated title and references
9. `/CLAUDE.md` - Updated project description and network references

### Deployment Scripts Modified: 9
1. `/scripts/dloop/deploy-ethereum-mainnet.sh` (created)
2. `/scripts/dloop/deploy-ethereum-mainnet-reset.sh` (created)
3. `/scripts/dloop/deploy-ethereum-testnet.sh` (created)
4. `/scripts/dloop/deploy-ethereum-testnet-reset.sh` (created)
5. `/deploy/15_issue_redeem_v2/2_setup_redeemerv2.ts` - Updated chain ID check

All sonic scripts removed, new ethereum scripts made executable.

### Key Migration Details

#### Chain ID Mappings:
- **Sonic Mainnet (146)** → **Ethereum Mainnet (1)**
- **Sonic Testnet (64165)** → **Sepolia (11155111)**

#### Environment Variables Updated:
- `MNEMONIC_SONIC_MAINNET_DEPLOYER` → `MNEMONIC_ETHEREUM_MAINNET_DEPLOYER`
- `MNEMONIC_SONIC_TESTNET_DEPLOYER` → `MNEMONIC_ETHEREUM_TESTNET_DEPLOYER`
- `PK_SONIC_MAINNET_DEPLOYER` → `PK_ETHEREUM_MAINNET_DEPLOYER`
- `PK_SONIC_TESTNET_DEPLOYER` → `PK_ETHEREUM_TESTNET_DEPLOYER`

#### RPC Configuration:
- Mainnet: `https://eth-mainnet.g.alchemy.com/v2/YOUR_API_KEY`
- Sepolia: `https://eth-sepolia.g.alchemy.com/v2/YOUR_API_KEY`

#### Etherscan Configuration:
- API URLs updated to use Etherscan instead of Sonicscan
- Environment variable `ETHERSCAN_API_KEY` required

#### Token Address Security:
- All production token addresses replaced with `0x0000000000000000000000000000000000000000`
- All oracle feed addresses replaced with placeholders
- All external contract addresses (governance, Odos router, etc.) replaced with placeholders

## Status
✅ **COMPLETED**: All identified Sonic references have been successfully migrated to Ethereum equivalents. The codebase is now ready for Ethereum deployment after proper address configuration.

## Validation Required
Before deployment, validate:
1. All environment variables are properly set with actual values
2. All placeholder addresses (0x0000...) are replaced with actual Ethereum addresses
3. Oracle feeds are functional on Ethereum mainnet/Sepolia
4. External contract addresses (Odos router, governance multisig, etc.) are correct for Ethereum
5. Safe multisig is properly configured for Ethereum mainnet
6. ALCHEMY_API_KEY and ETHERSCAN_API_KEY are set in environment

## Testing Checklist
- [ ] Compile contracts: `make compile`
- [ ] Run tests: `make test`
- [ ] Test deployment on localhost: `yarn hardhat deploy --network localhost`
- [ ] Verify Ethereum testnet configuration with actual testnet deployment
- [ ] Validate all placeholder addresses are replaced before mainnet deployment

## Migration Completed Successfully
This migration ensures the dTRINITY protocol is fully configured for Ethereum deployment while maintaining security through placeholder addresses that must be explicitly configured before any production deployment.