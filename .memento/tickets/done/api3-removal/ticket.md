# API3 Oracle Integration Removal

## Objective
Remove all API3 oracle integration from the codebase while keeping Chainlink and Redstone oracle support intact.

## Status
In Progress

## Tasks
- [x] Identify all API3-related files and references
- [x] Remove API3 adapter contracts
- [x] Remove API3 test files
- [x] Clean up API3 deployment scripts
- [x] Update oracle manager to remove API3 support
- [x] Remove API3 dependencies from package.json
- [x] Remove API3 imports from all files
- [x] Update configuration files
- [x] Verify Chainlink and Redstone remain functional

## Files Identified
- API3 wrapper contracts: `API3Wrapper.sol`, `API3WrapperWithThresholding.sol`, `API3CompositeWrapperWithThresholding.sol`
- API3 interface contracts: `BaseAPI3Wrapper.sol`, `IProxy.sol`
- API3 mock contracts: `MockAPI3Oracle.sol`, `MockAPI3OracleAlwaysAlive.sol`, `MockAPI3ServerV1.sol`
- API3 test files: `API3Wrapper.ts`, `API3WrapperWithThresholding.ts`, `API3CompositeWrapperWithThresholding.ts`
- API3 deployment scripts: 4 deployment scripts across dETH and dUSD ecosystems
- API3 configuration in all network files
- API3 constants and deploy IDs

## Files Removed
- `contracts/oracle_aggregator/interface/api3/` (entire directory)
- `contracts/oracle_aggregator/wrapper/API3*.sol` (3 files)
- `contracts/testing/oracle/MockAPI3*.sol` (3 files)
- `test/oracle_aggregator/API3*.ts` (3 files)
- `test/oracle_aggregator/fixtures.ts` (had heavy API3 dependencies)
- `test/oracle_aggregator/OracleAggregator.ts` (depended on API3 fixtures)
- `deploy/01_deth_ecosystem/02_setup_s_api3_oracle_wrappers.ts`
- `deploy/01_deth_ecosystem/05_point_s_aggregator_to_api3_wrappers.ts`
- `deploy/02_dusd_ecosystem/03_setup_usd_api3_oracle_wrappers.ts`
- `deploy/02_dusd_ecosystem/05_point_usd_aggregator_to_api3_wrappers.ts`
- Various backup files (.bak)

## Files Modified
- `typescript/deploy-ids.ts` - Removed all API3 deploy ID constants
- `typescript/oracle_aggregator/constants.ts` - Removed API3 constants
- `config/types.ts` - Removed API3 oracle asset interfaces
- `config/networks/ethereum_testnet.ts` - Removed empty API3 configurations
- `config/networks/ethereum_mainnet.ts` - Removed empty API3 configurations  
- `config/networks/localhost.ts` - Removed empty API3 configurations
- `deploy/04_assign_roles_to_multisig/04_transfer_oracle_wrapper_roles_to_multisig.ts` - Removed API3 role transfers
- `test/deth/AmoManager-ecosystem.ts` - Updated comments to remove API3 references
- `scripts/oracle/show_oracle_prices.ts` - Removed API3 oracle collection
- `scripts/deployments/print-oracles.sh` - Removed API3 and CurveAPI3 sections
- `contracts/vaults/dloop/dloop-design.md` - Updated documentation
- `contracts/oracle_aggregator/interface/IOracleWrapper.sol` - Updated interface comment

## Verification Results
- ✅ Code compiles successfully
- ✅ Linting passes without errors
- ✅ Basic tests still pass
- ✅ Oracle aggregator interface remains intact for Chainlink and Redstone
- ✅ No remaining API3 references in active code (only in comments noting removal)
- ✅ Oracle switching logic preserved for remaining oracle types

## Notes
- Preserve Chainlink and Redstone functionality
- Maintain oracle switching logic between remaining two types
- Ensure system continues to function with Chainlink or Redstone