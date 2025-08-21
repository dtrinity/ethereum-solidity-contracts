# Test Fixtures Update - Ethereum Token Migration

## Overview
Updated all test fixtures and test files to use the new Ethereum token reality instead of Sonic tokens.

## Token Mapping Applied
- `wS` → `WETH` (Wrapped Sonic → Wrapped ETH)
- `stS` → `stETH` (Staked Sonic → Staked ETH) 
- `wOS` → Removed (not needed for Ethereum)
- `OS` → Removed (not needed for Ethereum)

## Files Updated

### Test Fixtures
- `/test/deth/fixtures.ts` - Line 95-96: Updated `DETH_CONFIG` collateral arrays
- `/test/dstake/fixture.ts` - Line 361: Changed `SDSRewardsFixture` token from `"stS"` to `"stETH"`

### Test Files
- `/test/deth/Issuer.ts` - Line 26: Updated `yieldBearingAssets` set
- `/test/deth/IssuerV2.ts` - Line 26: Updated `yieldBearingAssets` set  
- `/test/deth/Redeemer.ts` - Line 26: Updated `yieldBearingAssets` set
- `/test/dstake/DStakeRewardManagerDLend.ts` - Lines 21 & 59: Updated reward token symbol logic
- `/test/dlend/UiPoolDataProviderV3.ts` - Lines 33-37: Changed `wS` token to `WETH`
- `/test/dlend/StaticAToken.ts` - Line 171: Changed `stS` reference to `stETH`
- `/test/dlend/Pool.ts` - Line 74: Updated comment reference
- `/test/dlend/fixtures.ts` - Line 231: Changed `stS` token reference to `stETH`

### Deployment Scripts
Updated deployment scripts to use `ETH` oracle aggregator instead of legacy `S` configuration:
- `/deploy/01_deth_ecosystem/03_setup_s_redstone_oracle_wrappers.ts`
- `/deploy/01_deth_ecosystem/04_deploy_s_oracle_aggregator.ts`
- `/deploy/01_deth_ecosystem/06_point_s_aggregator_to_redstone_wrappers.ts`
- `/deploy/01_deth_ecosystem/07_weth_oracle.ts`
- `/deploy/01_deth_ecosystem/08_ds_oracle.ts`

Also added graceful handling for Sonic-specific token deployments that don't exist in Ethereum:
- `/deploy/06_dlend_wstkscusd_reserve/00_setup_wstkscusd_chainlink_price_feed.ts` - Added skip logic for missing tokens

## Verification Status
✅ **Compilation**: `make compile` - Success
✅ **Test Execution**: `npx hardhat test test/deth/IssuerV2.ts --grep "issues dUSD in exchange for frxUSD"` - PASSED

## Configuration Alignment
The localhost configuration in `/config/networks/localhost.ts` was already properly configured for Ethereum tokens:
- Oracle aggregators use `ETH` instead of `S`
- Token addresses reference `WETH`, `stETH` instead of `wS`, `stS`
- Collateral configurations properly map to Ethereum assets

## Impact Assessment
- All test fixtures now use Ethereum-native tokens
- Oracle configurations point to proper Ethereum price feeds
- dLend reserve setup works with Ethereum assets (`stETH`, `sfrxUSD`, etc.)
- dStake rewards use appropriate yield-bearing tokens (`stETH` instead of `stS`)
- Deployment scripts gracefully handle missing Sonic-specific tokens

## Next Steps
- [ ] Run full test suite to ensure no other tests are broken
- [ ] Validate integration tests work with new token mappings
- [ ] Update any documentation that references the old token symbols