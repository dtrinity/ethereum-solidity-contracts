# Test Ticket: dSTAKE Fee & Incentive Accounting Invariants

## Objective
Author Foundry property tests that prove withdrawal fees, reinvest incentives, dust tolerance, and surplus sweeps never leak value or violate ERC4626 previews as router fees accrue and are reinvested.

## Scope
- `contracts/vaults/dstake/DStakeRouterV2.sol`
- `contracts/vaults/dstake/DStakeTokenV2.sol`
- Fee helpers in `contracts/vaults/dstake/libraries/DStakeMath.sol` (if applicable)
- Tests under `foundry/test/dstake/` (e.g., `RouterFeeInvariant.t.sol`)

## Why This Matters
Recent Hardhat specs caught dust/logging issues, but no invariant ensures:
- Withdrawal fees collected on the router always reconcile with ERC4626 `previewWithdraw/previewRedeem`.
- `reinvestFees` respects deposit caps/dust tolerance while paying incentives within `MAX_REINVEST_INCENTIVE_BPS`.
- `sweepSurplus` can’t drain principal or leave router with negative idle balances.
Given fee settings are governance-controlled (`contracts/vaults/dstake/Design.md:211-238`), regressions here could silently erode share price or block withdrawals.

## Test Plan
1. **Fixture**
   - Reuse multi-vault setup but enable non-zero `withdrawalFeeBps`, `reinvestIncentive`, and tight `dustTolerance`.
   - Mint a dedicated “fee claimer” account to invoke `reinvestFees`/`sweepSurplus`.
2. **Actions**
   - Randomized deposits/withdrawals across multiple users with varying share balances.
   - Periodic updates to `withdrawalFeeBps`, `setDustTolerance`, `setReinvestIncentive`, plus toggling `setTotalsInvariantBypass` if available.
   - Invoke `router.reinvestFees()` and `router.sweepSurplus(limit)` under different idle-balance scenarios.
   - Trigger shortfall spikes then clear them to ensure fees remain fungible with backing.
3. **Invariants**
   - `dStakeToken.totalAssets()` ≥ router idle balance + vault NAV − `currentShortfall` (fees cannot go negative).
   - Net user receipts from withdrawals = ERC4626 preview within ±dust tolerance even as fee BPS changes.
   - Incentive payouts from `reinvestFees` never exceed configured BPS share of `amountReinvested`.
   - Dust tolerance respected: router idle dStable stays ≤ `dustTolerance` unless immediately reinvested.
   - Surplus sweeps never reduce vault NAV; they only move router-held idle balances to `feeClaimer`.
4. **Telemetry**
   - Emit events/logs inside tests when fee settings change to aid debugging of failing sequences.

## Deliverables
- New Foundry invariant contract covering the actions/invariants above.
- Optional helper library for computing expected incentive payouts inside tests.
- CI wiring to execute the suite via `make test.foundry`.

## Acceptance Criteria
- Invariant fails on intentional misconfigurations (e.g., incentive > cap) and passes once router guards are enforced.
- Provides minimal failing sequence reproduction steps in the Forge failure output.
- Adds ≤20s to total `make test.foundry` runtime.
