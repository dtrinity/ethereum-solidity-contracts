# Test Ticket: Issuer/Redeemer/AMO Conservation Fuzz

## Objective
Randomised sequences of mint, redeem, and AMO supply adjustments must preserve the invariant `circulatingSupply <= collateralValue` while keeping AMO debt parity within tolerance.

## Scope
- `contracts/dstable/IssuerV2.sol`
- `contracts/dstable/RedeemerV2.sol`
- `contracts/dstable/AmoManagerV2.sol`
- Foundry/Hardhat invariant suite `test/fuzz/dstable/IssuerRedeemerInvariant.t.sol`

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
