# Ethereum Token Migration - Sonic to Ethereum Token References

## Status
**In Progress** - Configuration updated, deployment scripts and tests need migration

## Overview
The localhost.ts configuration has been successfully updated to use realistic Ethereum tokens (WETH, stETH, USDC, USDS, etc.) instead of Sonic tokens. However, many deployment scripts, test files, and fixtures still reference the old Sonic tokens and need systematic updates.

## Configuration Changes Completed ✅

### Updated Token Mapping
- **dETH collaterals**: wS → WETH, stS → stETH, wOS → (removed)
- **dUSD collaterals**: Now using USDC, USDS, sUSDS, frxUSD, sfrxUSD
- **Removed tokens**: wOS, OS, scUSD, wstkscUSD (not needed for Ethereum)

### Files Already Updated ✅
- `/config/networks/localhost.ts` - Complete token configuration updated
- Mock oracle setup updated to match new token reality

## Outstanding Token References Requiring Updates

### 1. Deployment Scripts with Old Token References

#### Critical Files Needing Updates:
1. **`/deploy/01_deth_ecosystem/07_ws_oracle.ts`**
   - References `wS` throughout (lines 15-49)
   - Needs to be updated for WETH or removed if not needed

2. **`/deploy/01_deth_ecosystem/13_whitelist_collateral.ts`**
   - References `wS_HardPegOracleWrapper` (line 93)

3. **`/deploy/01_deth_ecosystem/04_deploy_s_oracle_aggregator.ts`**
   - References `wS` token as base currency (line 15)

4. **`/deploy/03_dlend/04_periphery_post/01_native_token_gateway.ts`**
   - Uses `config.tokenAddresses.wS` (line 14)

5. **`/deploy/03_dlend/04_periphery_post/03-ui-helpers.ts`**
   - Uses `config.tokenAddresses.wS` (line 31)

#### Sonic-Specific Deployment Directories (May Need Removal):
- `/deploy/06_dlend_wstkscusd_reserve/` - Entire directory for wstkscUSD
- `/deploy/14_dlend_wOS_PTaUSDC_PTwstkscusd/` - Entire directory for wOS and PT tokens

### 2. Test Files with Old Token References

#### Test Fixtures:
1. **`/test/deth/fixtures.ts`**
   - Line 95: `peggedCollaterals: ["wS"]`
   - Line 96: `yieldBearingCollaterals: ["wOS", "stS"]`
   - **Update to**: `peggedCollaterals: ["WETH"]`, `yieldBearingCollaterals: ["stETH"]`

2. **`/test/dstake/fixture.ts`**
   - Line 361: References `"stS"`
   - **Update to**: `"stETH"`

#### Test Implementation Files:
1. **`/test/deth/Issuer.ts`**
   - Line 26: `const yieldBearingAssets = new Set(["sfrxUSD", "sUSDS", "stS", "wOS"]);`
   - **Update to**: Remove `"stS", "wOS"`, keep `["sfrxUSD", "sUSDS", "stETH"]`

2. **`/test/deth/IssuerV2.ts`**
   - Line 26: Same issue as Issuer.ts
   - **Update to**: Use new token set

3. **`/test/dstake/DStakeRewardManagerDLend.ts`**
   - Line 21: Returns `"stS"`
   - Line 59: Uses `"stS"`
   - **Update to**: Use `"stETH"`

#### Pendle-Related Tests (May Need Removal):
- `/test/pendle/fixture.ts` - References wstkscUSD and scUSD
- `/test/pendle/sdk.ts` - Multiple Sonic mainnet token references

### 3. Configuration Type Definitions

#### `/config/types.ts`
- May contain type definitions for old Sonic tokens
- Need to verify and update token address types

### 4. Deploy IDs and Constants

#### `/typescript/deploy-ids.ts`
- **Lines 14-15**: `PENDLE_PT_WSTKSCUSD_DECIMAL_CONVERTER_ID` references wstkscUSD
- **Lines 17-18**: `WOS_TO_OS_DECIMAL_CONVERTER_ID` references wOS/OS
- **Line 45**: `WS_HARD_PEG_ORACLE_WRAPPER_ID` references wS
- **Lines 99-100**: `CHAINLINK_DECIMAL_CONVERTER_WSTKSCUSD_ID` references wstkscUSD
- **Action Required**: Remove unused Sonic token deployment IDs

### 5. Configuration Type Updates

#### `/config/types.ts`
- **Line 249**: Comment references `wOS` as example asset
- **TokenAddresses interface** (around line 282): Already correctly updated to use WETH
- **Action Required**: Update comment examples to use Ethereum tokens

## Token Mapping Reference

### Old Sonic Tokens → New Ethereum Tokens:
- `wS` → `WETH` (Wrapped ETH)
- `stS` → `stETH` (Staked ETH)  
- `wOS` → (removed, not needed)
- `OS` → (removed, not needed)
- `scUSD` → (removed, not needed)
- `wstkscUSD` → (removed, not needed)

### Oracle Feed Updates Needed:
- Replace Sonic oracle feeds with Ethereum equivalents
- Update composite oracle configurations
- Remove references to non-existent token pairs

## Mock Token Deployment Status ✅
- `/deploy-mocks/01_mock_token_setup.ts` correctly uses configuration
- Mock tokens will be deployed based on config.MOCK_ONLY.tokens
- No changes needed to mock deployment script

## Action Items

### Phase 1: Core Deployment Scripts (High Priority)
- [ ] Update `/deploy/01_deth_ecosystem/07_ws_oracle.ts` for WETH
- [ ] Update `/deploy/01_deth_ecosystem/13_whitelist_collateral.ts`
- [ ] Update `/deploy/01_deth_ecosystem/04_deploy_s_oracle_aggregator.ts`
- [ ] Update `/deploy/03_dlend/04_periphery_post/01_native_token_gateway.ts`
- [ ] Update `/deploy/03_dlend/04_periphery_post/03-ui-helpers.ts`

### Phase 2: Test Fixtures and Implementation (Medium Priority)
- [ ] Update `/test/deth/fixtures.ts` collateral arrays
- [ ] Update `/test/dstake/fixture.ts` token references
- [ ] Update `/test/deth/Issuer.ts` yieldBearingAssets set
- [ ] Update `/test/deth/IssuerV2.ts` yieldBearingAssets set
- [ ] Update `/test/dstake/DStakeRewardManagerDLend.ts` token logic

### Phase 3: Constants and IDs Cleanup (Medium Priority)
- [ ] Remove unused deployment IDs in `/typescript/deploy-ids.ts`:
  - [ ] `PENDLE_PT_WSTKSCUSD_DECIMAL_CONVERTER_ID`
  - [ ] `WOS_TO_OS_DECIMAL_CONVERTER_ID`
  - [ ] `WS_HARD_PEG_ORACLE_WRAPPER_ID`
  - [ ] `CHAINLINK_DECIMAL_CONVERTER_WSTKSCUSD_ID`
- [ ] Update comment in `/config/types.ts` line 249 (wOS example)

### Phase 4: Cleanup (Low Priority)
- [ ] Review and remove Sonic-specific deployment directories if not needed:
  - [ ] `/deploy/06_dlend_wstkscusd_reserve/` (entire directory)
  - [ ] `/deploy/14_dlend_wOS_PTaUSDC_PTwstkscusd/` (entire directory)
- [ ] Remove or update Pendle-related tests for Ethereum

### Phase 5: Verification
- [ ] Run `make test` to verify all tests pass with new tokens
- [ ] Run `make lint` to check for any remaining issues
- [ ] Deploy to localhost and verify mock tokens are created correctly
- [ ] Test dETH issuance with WETH and stETH
- [ ] Test dUSD issuance with new stablecoin collaterals

## Risk Assessment

### Low Risk Items:
- Mock token setup (already correctly configured)
- Configuration files (already updated)

### Medium Risk Items:
- Test file updates (may break test suite temporarily)
- Oracle feed configurations (need careful validation)

### High Risk Items:
- Core deployment scripts (could break deployment process)
- Native token gateway updates (affects core functionality)

## Success Criteria

1. All deployment scripts reference correct Ethereum tokens
2. All tests pass with updated token configurations
3. Mock deployment creates expected tokens (USDC, USDS, sUSDS, frxUSD, sfrxUSD, WETH, stETH)
4. dETH can be issued using WETH and stETH as collateral
5. dUSD can be issued using the new stablecoin collaterals
6. No references to wS, wOS, stS, scUSD, or wstkscUSD remain in active code

## Notes

- The configuration in `localhost.ts` correctly defines the new token ecosystem
- Oracle setup is properly configured for the new tokens with appropriate price feeds
- The token ecosystem is now more realistic for Ethereum mainnet deployment
- Some Sonic-specific features (like OS/S ecosystem) are no longer needed