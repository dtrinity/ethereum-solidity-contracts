# Test Ticket: dStable AmoManagerV2 Peg & Debt Parity Invariant

## Objective
Construct a Foundry invariant harness that validates AmoManagerV2 + AmoDebtToken keep AMO supply adjustments perfectly hedged (mint/burn symmetry, peg deviation guard, debt token parity) even when oracle shocks, allocation churn, and guardian pauses interleave.

## Scope
- `contracts/dstable/AmoManagerV2.sol`
- `contracts/dstable/AmoDebtToken.sol`
- `contracts/dstable/IssuerV2.sol` + `RedeemerV2.sol` interactions when AMO supply changes
- Oracle utilities from `contracts/dstable/OracleAware.sol`
- New tests under `foundry/test/dstable/` (e.g., `AmoManagerV2Invariant.t.sol`)

## Why This Matters
Production deployments use AmoManagerV2 to route dStable into AMO vaults while enforcing peg deviation tolerances (`contracts/dstable/Design.md:79-115`). Today’s invariants only cover the v1 manager and simple AMO vaults. Without fuzz coverage:
- AMO increases could mint dStable without mirrored AmoDebtToken debt, inflating circulating supply.
- Peg deviation guards might fail open, letting governance leak supply during oracle outages.
- Allocation bookkeeping might desync when vaults are enabled/disabled mid-operation.

## Test Plan
1. **Fixture**
   - Deploy IssuerV2, RedeemerV2, CollateralHolderVault, AmoManagerV2, AmoDebtToken, and at least two MockAmoVaults.
   - Seed collateral and grant roles mirroring Design.md instructions.
   - Configure peg deviation threshold, guardian addresses, and mock oracle capable of bounded shocks.
2. **Action Generators**
   - Random AMO increases/decreases within configured limits, including attempts that should revert when peg guard breached.
   - Toggle vault allocations, enable/disable AMO vaults, and simulate oracle price drift ±20%.
   - Guardian actions: pause/unpause AMO ops, adjust `pegDeviationBps`.
   - Issuance/redemption flows from external users to ensure circulating supply reacts.
3. **Invariants**
   - `amoDebtToken.totalSupply()` == `amoManagerV2.totalAllocated()` at all times.
   - Circulating dStable (`issuer.circulatingDstable()`) ≤ collateral value even after AMO adjustments.
   - Peg deviation guard blocks AMO supply increases whenever oracle drift exceeds configured BPS.
   - Guardian pauses freeze AMO adjustments but still allow decreases/settlement.
4. **Failure Diagnostics**
   - On invariant breach, log action trace (AMO op + oracle move) to accelerate debugging.

## Deliverables
- Forge invariant contract plus helper mocks (guardian, oracle) if needed.
- Integration into `make test.foundry`.
- README note inside `foundry/test/dstable/` describing the new harness.

## Acceptance Criteria
- Harness redlines when debt token mint/burn symmetry is intentionally broken.
- Passing run proves ≤1e-9 supply drift over ≥100 sequences (configurable).
- Adds ≤30s to foundry runtime and runs deterministically across machines.
