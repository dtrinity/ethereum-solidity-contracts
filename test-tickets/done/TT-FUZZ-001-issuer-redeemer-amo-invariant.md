# Test Ticket: Issuer/Redeemer/AMO Conservation Fuzz

## Objective
Randomised sequences of mint, redeem, and AMO supply adjustments must preserve the invariant `circulatingSupply <= collateralValue` while keeping AMO debt parity within tolerance.

## Scope
- `contracts/dstable/IssuerV2.sol`
- `contracts/dstable/RedeemerV2.sol`
- `contracts/dstable/AmoManagerV2.sol`
- Foundry invariant suite `foundry/test/dstable/IssuerRedeemerInvariant.t.sol`

## Progress 2025-10-24
- Replaced the scaffold with a live Foundry harness at `foundry/test/dstable/IssuerRedeemerInvariant.t.sol`. The suite now deploys a mintable dStable, `CollateralHolderVault`, `IssuerV2`, `RedeemerV2`, `AmoManager`, and `MockAmoVault`, then fuzzes real issue/redeem/AMO flows.
- Added utilities for mintable ERC20, mock oracle, and invariant fixtures under `foundry/test/utils/`.
- Command: `forge test --match-path foundry/test/dstable/IssuerRedeemerInvariant.t.sol`

## Status
- ✅ Deliverables complete – invariant passes and logs counterexample seeds on failure.
- 🔜 Optional enhancements: expand to multi-asset collateral coverage and integrate pause/fee toggles if we want broader permutations.

## Fuzz Plan
1. Initialise system with multiple collateral assets and oracle feeds (mocked with configurable price/heartbeat).
2. Generate random operations:
   - `issue(asset, amount)` respecting allow/pause flags.
   - `redeem(asset, amount)` with varying fee configs.
   - `increaseAmoSupply` / `decreaseAmoSupply` on randomly selected AMO vaults.
   - Oracle price perturbations within configured deviation bounds.
3. After each step assert:
   - `issuer.circulatingSupply() <= collateralVault.totalCollateralValue()`.
   - `amoManager.totalAllocatedDebt()` equals sum of AMO vault debts within ±1 wei tolerance.
   - No negative balances, paused assets remain untouched.
4. Track edge cases: max fee bps, asset-level pauses, AMO peg deviation guard activation.

## Fixtures & Tooling
- Mock oracle supporting randomised price updates + heartbeat control.
- Harness contracts exposing internal getters for testing (or use public view functions).
- Differential snapshot to compare state before/after fuzz runs.

## Deliverables
- Passing invariant test with configurable iteration count.
- Metrics/logs highlighting any counterexample seeds for regression.
