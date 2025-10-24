# Test Ticket: Router Multi-Vault Balancing Invariant

## Objective
Fuzz deterministic vault routing with multiple active strategies to prove that share/accounting math stays consistent while target allocations, shortfall tracking, and router fees evolve under stress.

## Scope
- `contracts/vaults/dstake/DStakeRouterV2.sol`
- `contracts/vaults/dstake/libraries/AllocationCalculator.sol`
- `contracts/vaults/dstake/interfaces/*`
- Existing invariant utils under `foundry/test/utils/` + new helpers for multi-vault fixtures
- New Forge test: `foundry/test/dstake/RouterMultiVaultInvariant.t.sol`

## Why This Matters
Our current invariant only wires one strategy share; most production flows involve 2–4 vaults with dynamic target weights, solver deposits, and periodic shortfall adjustments. Bugs here can cause NAV drift, dust accumulation beyond tolerance, or mispriced withdrawals.

## Test Harness Plan
1. Deploy router + dStake token + collateral vault as in `RouterShareAccountingInvariant`, but instantiate 3 strategy shares (e.g., base stable vault, yield vault, governance vault) each with its own mock adapter exposing:
   - `deposit()`/`withdraw()` semantics
   - `totalValue()` reports manipulated by fuzz inputs
   - Optional max slippage / paused flags
2. Random operations per iteration:
   - `solverDepositAssets` across random subset with different weights.
   - `solverWithdrawAssets` bounding to user share balance.
   - Adjust `VaultConfig.targetBps` and `status` (Active/Suspended/Impaired) under role-gated calls.
   - `recordShortfall`/`clearShortfall` with random magnitudes.
   - `setDepositCap`, `setDefaultDepositStrategyShare`, `setDustTolerance`, `setReinvestIncentive`.
   - Periodic `router.reinvestFees()` and `sweepSurplus()`.
3. Reflect adapter NAV drifts by changing mock total value between steps to emulate yield or losses.

## Invariants
- `router.totalManagedAssets()` equals sum of mock adapter total values plus `settlementShortfall`.
- User share supply tracks router-managed assets (reassert `totalSupply == totalAssets == totalManagedAssets`).
- Deposits respect `depositCap` and per-vault status: paused/Impaired vaults never receive new allocations.
- Dust per vault stays below configured tolerance after rounding and sweeps.
- Shortfall never exceeds managed assets and is cleared appropriately when assets return.
- Target BPS vector always sums to <= 10_000 and the router never routes to removed vaults.

## Edge Cases & Controls
- Rapid vault status flapping (Active → Suspended → Active) during the same fuzz run.
- Setting `maxVaultCount` lower than current length (should revert and leave state unchanged).
- Adapter returning fewer shares than expected (trigger `SolverShareDepositShortfall`).
- Withdrawal fee toggles and reinvest incentive path accounting.

## Deliverables
- Passing Forge invariant with mocked multi-vault adapters.
- Utility adapters + fixtures committed under `foundry/test/utils/`.
- Ticket comment summarising gas/runtime characteristics (so we can gate in CI vs nightly).
