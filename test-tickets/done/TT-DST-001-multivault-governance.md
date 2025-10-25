# Test Ticket: dSTAKE Multi-Vault Governance Regression Pack

## Objective
Add deterministic Hardhat specs that prove governance workflows (suspending vaults, running each rebalance helper, and removing adapters) behave correctly when the router manages ≥2 active strategy shares.

## Scope
- `contracts/vaults/dstake/DStakeRouterV2.sol`
- `contracts/vaults/dstake/DStakeTokenV2.sol`
- `contracts/vaults/dstake/DStakeCollateralVaultV2.sol`
- Adapter helpers under `contracts/vaults/dstake/adapters/*`
- New tests under `test/dstake/` (likely `RouterGovernanceFlows.test.ts`)

## Why This Matters
Production routing rarely runs a single vault. The design doc (`contracts/vaults/dstake/Design.md:136`-148) calls out the need to suspend targets, rebalance allocations, and offboard adapters without corrupting NAV, yet our tests only cover the default single vault happy-path. Missing coverage here could let governance calls silently strand assets or mis-route deposits during migrations.

## Test Plan
1. **Fixture**
   - Extend `createDStakeFixture` to optionally deploy two extra strategy adapters + shares.
   - Seed router config with distinct `targetBps` and mark one share as default deposit vault.
2. **Vault Suspension + Deposits**
   - Write a test that calls `suspendVaultForRemoval` on the default vault, confirms target weight zeroed, default cleared, and subsequent ERC4626 deposits never allocate to the suspended share.
3. **Rebalance Helpers**
   - Exercise `rebalanceStrategiesByShares`, `rebalanceStrategiesBySharesViaExternalLiquidity`, and `rebalanceStrategiesByValue` against real adapters.
   - Force deterministic overweight/underweight states, pass explicit min share/value thresholds, and assert router events plus resulting collateral balances.
4. **Adapter Removal & Dust Handling**
   - After suspension, call `removeAdapter` while leaving dust in the collateral vault.
   - Assert vault remains in registry but deposits/withdrawals revert with `AdapterNotFound`.
   - Verify governance can re-set an adapter and resync target weights without changing aggregate NAV reported by `totalAssets`.
5. **Status Flip Safety**
   - Rapidly toggle statuses (Active ↔ Suspended ↔ Active) inside a single test to ensure router defaults/targets stay coherent and rebalancing reuses the right vault set.

## Deliverables
- New fixture plumbing supporting multi-vault deployments.
- Hardhat test suite covering the flows above with clear assertions on events + balances.
- Updated CI command list (e.g., `yarn hardhat test test/dstake/RouterGovernanceFlows.test.ts`).

## Acceptance Criteria
- Tests fail today (lack of coverage), pass once implementation is hardened.
- Failure messages call out regression context (e.g., “suspended vault should not receive deposits”).
- No reliance on Foundry mocks—use real router/token/collateral vault deployments. 
