# Test Ticket: dStable Collateral Delist & Oracle Loss Handling

## Objective
Verify the CollateralHolderVault + IssuerV2 + RedeemerV2 stack remains safe when a collateral loses its oracle feed, is delisted with residual dust, and later re-onboarded. Ensure issuance/redemption fail fast during the outage and NAV resumes seamlessly after recovery.

## Scope
- `contracts/dstable/CollateralHolderVault.sol`
- `contracts/dstable/IssuerV2.sol`
- `contracts/dstable/RedeemerV2.sol`
- Oracle plumbing (`OracleAggregatorV1_1`, risk configs)
- New Hardhat tests under `test/dstable/` (e.g., `CollateralDelistLifecycle.test.ts`)

## Why This Matters
Design notes require vault valuation to revert when a strategy share lacks a live adapter/oracle (`contracts/dstable/Design.md:95`-103) and governance must be able to delist collateral even if dust remains (`contracts/dstable/Design.md:17`-23). Today’s TS suites never remove collateral or kill an oracle feed, so we could miss regressions where issuance continues using stale prices or redeemers leak unsupported tokens.

## Test Plan
1. **Oracle Loss Reaction**
   - Deploy standard fixture, then remove the oracle feed for a supported collateral (set to ZeroAddress or stale).
   - Assert:
     - `CollateralHolderVault.totalValue()` reverts.
     - `IssuerV2.issue` and `RedeemerV2.redeem` revert with `UnsupportedCollateral` / oracle errors.
2. **Delist with Dust**
   - Call `collateralVault.delistCollateral(asset)` (or equivalent) while leaving a non-zero balance.
   - Verify:
     - Further deposits rejected.
     - Vault still tracks the stranded balance for accounting but NAV excludes it until oracle restored.
3. **Governance Recovery**
   - Reconfigure the oracle, re-allow collateral, and clear pauses.
   - Confirm issuance/redemption resume, NAV matches manual base-value math, and prior dust is now withdrawable.
4. **Issuer/Redeemer Pauses**
   - Ensure asset-level `setAssetMintingPause` / `setAssetRedemptionPause` are toggled during outage.
   - Tests should ensure they cannot be lifted until oracle feed is restored (expect revert otherwise).
5. **Event Assertions**
   - Watch for `OracleSet`, `AssetMintingPauseUpdated`, `AssetRedemptionPauseUpdated`, and ensure they emit with correct args to aid monitoring.

## Deliverables
- New lifecycle-focused Hardhat tests plus helper utilities to flip oracle feeds.
- Documentation snippet in ticket referencing `yarn hardhat test test/dstable/CollateralDelistLifecycle.test.ts`.

## Acceptance Criteria
- Tests reproduce the outage (fail until code handles delist correctly) and pass once protections exist.
- Coverage proves no issuance/redemption succeeds without a live price and that re-onboarding preserves NAV continuity.
