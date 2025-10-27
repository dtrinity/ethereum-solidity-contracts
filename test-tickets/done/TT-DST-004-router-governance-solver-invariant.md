# Test Ticket: dSTAKE Governance + Solver Invariant Harness

## Objective
Build a Foundry invariant suite that exercises router governance primitives (`suspendVaultForRemoval`, `removeAdapter`, `setVaultConfigs`, solver share routes) while deposits/withdrawals continue, ensuring NAV, shortfall, and default vault pointers remain coherent under adversarial reconfiguration.

## Scope
- `contracts/vaults/dstake/DStakeRouterV2.sol`
- `contracts/vaults/dstake/DStakeCollateralVaultV2.sol`
- `contracts/vaults/dstake/DStakeTokenV2.sol`
- Governance helpers and solver entrypoints described in `contracts/vaults/dstake/Design.md:109-210`
- New invariant harness under `foundry/test/dstake/` (e.g., `RouterGovernanceInvariant.t.sol`)

## Why This Matters
Current invariants only cover a static single-vault (share accounting) and a multi-vault router with fixed adapters. Real operations routinely suspend vaults, rotate adapters, and service redemptions via solver share flows. Without coverage the router could:
- Leave suspended vaults as the `defaultDepositStrategyShare`, causing deposits to revert or misroute.
- Lose target weights or adapter wiring mid-flight, breaking ERC4626 accounting.
- Drift shortfall tracking if solver share withdrawals bypass vault ordering.
The design doc explicitly calls out these governance tasks, so they must be fuzz-tested.

## Test Plan
1. **Harness Fixture**
   - Deploy ≥3 strategy adapters + shares (`InvariantDynamicStrategyAdapter`) and register them with varied `targetBps`.
   - Seed router with non-zero withdrawal fee, reinvest incentive, and deposit cap to mirror production constraints.
2. **Action Set**
   - Extend invariant target selectors to:
     - Randomly call `suspendVaultForRemoval`, `removeAdapter`, `addVaultConfig`, `updateVaultConfig`, and `setDefaultDepositStrategyShare`.
     - Toggle adapters back on by redeploying and re-adding the same share pointer.
     - Invoke solver routes in both asset and share units: `solverDepositShares`, `solverWithdrawShares`, alongside existing asset-based paths.
     - Queue deposits/withdrawals from multiple addresses while governance churn happens.
3. **Invariant Checks**
   - Default vault must always reference an `Active` vault with non-zero adapter; clearing should happen automatically when none exist.
   - Sum of `targetBps` for active vaults ≤ 10_000 even after rapid suspend/resume cycles.
   - Router NAV (`totalManagedAssets`) matches collateral vault valuations plus idle dStable regardless of adapter swaps.
   - Shortfall bookkeeping equals `max(totalSupply - managedAssets, 0)` within dust tolerance before and after governance calls.
   - Solver share routes never bypass withdrawal fee accounting (compare `totalAssets()` deltas with previews).
4. **Determinism & Debuggability**
   - Emit context-rich revert messages (`"default vault inactive"`, etc.) to make invariant failures actionable.
   - Cache minimal failing sequences for regression.

## Deliverables
- New Foundry invariant contract with governance + solver actions and assertions above.
- Updated `Makefile`/`make test.foundry` target to include the new suite.
- Documentation block summarizing operator behaviours the harness covers.

## Acceptance Criteria
- Harness fails on current main because the new actions uncover missing safety checks (expected during development), and passes once router logic is hardened.
- Runtime stays ≤45s when executed via `forge test --match-path foundry/test/dstake/RouterGovernanceInvariant.t.sol`.
- Adding/removing vaults mid-run never leaves router stuck (no `INACTIVE_DEFAULT_VAULT` reverts during invariants).
