# Test Ticket: RewardClaimable Base Invariant Harness

## Objective
Create a Foundry test suite for `RewardClaimable` that fuzzes `compoundRewards`, treasury fee updates, and setter permissions to guarantee the shared framework never double-counts exchange assets, never overcharges treasury fees, and enforces role + reentrancy guards.

## Scope
- `contracts/vaults/rewards_claimable/RewardClaimable.sol`
- Supporting mocks under `contracts/testing/` (new mock child contract exposing hook behaviour)
- New invariant tests under `foundry/test/rewards/` (e.g., `RewardClaimableInvariant.t.sol`)

## Why This Matters
Every reward manager (including `DStakeRewardManagerDLend`) inherits RewardClaimable’s accounting logic (`contracts/vaults/rewards_claimable/Design.md:17-96`). If base assumptions break—fees exceeding rewards, exchange contributions stuck, or role gates bypassed—every downstream manager inherits the bug. No automated suite currently fuzzes these invariants.

## Test Plan
1. **Harness Fixture**
   - Deploy a mock `RewardClaimableTester` that:
     - Implements `_claimRewards` by minting arbitrary ERC20 rewards (using `TestMintableERC20`).
     - Implements `_processExchangeAssetDeposit` with configurable behaviours (no-op, simulated adapter deposit, malicious reentrancy attempts).
   - Set realistic `maxTreasuryFeeBps`, thresholds, and treasury addresses.
2. **Action Generators**
   - Randomize `compoundRewards` inputs: `amount`, `rewardTokens[]`, `receiver`, token ordering (including duplicates and tokens equal to `exchangeAsset`).
   - Toggle `treasury`, `treasuryFeeBps`, and `exchangeThreshold` via accounts with/without `REWARDS_MANAGER_ROLE` to assert permission enforcement.
   - Attempt reentrancy by having `_processExchangeAssetDeposit` call `compoundRewards` recursively; ensure `nonReentrant` stops it.
   - Introduce malicious reward tokens (revert on transfer) to verify failures revert cleanly without corrupting accounting.
3. **Invariants**
   - Treasury fees never exceed claimed reward amounts (`fee <= claimed` per token).
   - Sum of `receiver` payouts + `treasury` fees equals the actual rewards claimed, regardless of exchange asset overlap.
   - User-supplied `exchangeAsset` remains entirely allocated via `_processExchangeAssetDeposit` (no dust stuck on the contract).
   - Role-restricted setters revert for unauthorized callers; authorized ones succeed and respect `maxTreasuryFeeBps`.
   - `compoundRewards` is callable only by holders of `REWARDS_MANAGER_ROLE` unless explicitly toggled in the mock (to mimic permissionless overrides) and still enforces threshold/receiver/reward-token guards.
4. **Diagnostics**
   - Log last action type + parameters when an invariant fails to aid debugging.

## Deliverables
- Mock child contract and helper tokens under `contracts/testing/`.
- `foundry/test/rewards/RewardClaimableInvariant.t.sol` implementing the action set + invariants above.
- Wiring into `make test.foundry`.

## Acceptance Criteria
- Harness fails when guards are intentionally broken (e.g., allow treasury fee > max) and passes otherwise.
- Reproduces minimal failing sequences via Forge’s shrinker.
- Adds ≤15s to Foundry runtime.
