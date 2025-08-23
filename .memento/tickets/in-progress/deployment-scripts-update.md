# Deployment Scripts Token Update

## Summary
Updated deployment scripts to use Ethereum token reality instead of Sonic tokens. Applied token mapping to replace old Sonic token references with Ethereum equivalents.

## Token Mapping Applied
- `wS` → `WETH` (Wrapped ETH)
- `stS` → `stETH` (Staked ETH) 
- Removed references to: `wOS`, `OS`, `scUSD`, `wstkscUSD` (Sonic-specific tokens that don't exist on Ethereum)

## Files Updated

### 1. `/deploy/01_deth_ecosystem/07_weth_oracle.ts` (renamed from 07_ws_oracle.ts)
- **Changes Made:**
  - Renamed file from `07_ws_oracle.ts` to `07_weth_oracle.ts`
  - Updated import from `WS_HARD_PEG_ORACLE_WRAPPER_ID` to `WETH_HARD_PEG_ORACLE_WRAPPER_ID`
  - Changed deployment ID from `WS_HARD_PEG_ORACLE_WRAPPER_ID` to `WETH_HARD_PEG_ORACLE_WRAPPER_ID`
  - Updated comments from "wS" to "WETH"
  - Updated token references from `config.tokenAddresses.wS` to `config.tokenAddresses.WETH`
  - Updated console logs to reflect WETH instead of wS

### 2. `/deploy/01_deth_ecosystem/13_whitelist_collateral.ts`
- **Changes Made:**
  - Updated dependency from `"wS_HardPegOracleWrapper"` to `"WETH_HardPegOracleWrapper"`
  - Note: This script already uses config-based collateral addresses, so WETH and stETH are automatically included via config

### 3. `/deploy/01_deth_ecosystem/04_deploy_s_oracle_aggregator.ts`
- **Changes Made:**
  - Updated comment from "wS token as base currency for S" to "WETH token as base currency for ETH"

### 4. `/deploy/03_dlend/04_periphery_post/01_native_token_gateway.ts`
- **Changes Made:**
  - Changed `config.tokenAddresses.wS` to `config.tokenAddresses.WETH`

### 5. `/deploy/03_dlend/04_periphery_post/03-ui-helpers.ts`
- **Changes Made:**
  - Updated UI pool data provider arguments from `config.tokenAddresses.wS` to `config.tokenAddresses.WETH`

### 6. `/typescript/deploy-ids.ts`
- **Changes Made:**
  - Added new constant: `export const WETH_HARD_PEG_ORACLE_WRAPPER_ID = "WETH_HardPegOracleWrapper";`
  - Kept old `WS_HARD_PEG_ORACLE_WRAPPER_ID` for backward compatibility

## Directories Identified for Removal/Disabling

The following deployment directories contain Sonic-specific tokens that don't exist on Ethereum and should be excluded from Ethereum deployments:

### `/deploy/06_dlend_wstkscusd_reserve/`
- Contains scripts for `wstkscUSD` token (Sonic-specific)
- Files: 00_setup_wstkscusd_chainlink_price_feed.ts, 01_add_wstkscUSD_reserve.ts, 02_deploy_chainlink_decimalconverter.ts

### `/deploy/14_dlend_wOS_PTaUSDC_PTwstkscusd/`
- Contains scripts for `wOS`, `OS`, and `PTwstkscUSD` tokens (all Sonic-specific)
- Files: 00-05 deployment scripts for Pendle PT tokens and OS token integrations

## Verification Results

1. **Compilation Status:** ✅ PASSED
   - Ran `make compile` successfully
   - No TypeScript compilation errors
   - All modified deployment scripts compile correctly

2. **Token Reference Updates:** ✅ COMPLETED
   - All primary deployment scripts updated to use WETH instead of wS
   - Legacy Sonic token references identified and documented
   - New deployment ID constants added to deploy-ids.ts

## Next Steps

1. **Deploy Tag Updates:** Consider updating deployment tags and dependencies to reflect the token changes
2. **Config Validation:** Ensure the ethereum mainnet config has correct token addresses before deployment
3. **Legacy Script Handling:** Decide whether to delete or disable the Sonic-specific deployment directories
4. **Testing:** Run deployment tests on a test network to verify all changes work correctly

## Issues Encountered

None. All changes applied successfully and compilation passes.

## Status
- ✅ Primary deployment scripts updated
- ✅ Token references migrated to Ethereum reality
- ✅ Compilation verified
- ✅ Legacy scripts identified for removal
- ⏳ Ready for deployment testing

Updated: 2025-08-21