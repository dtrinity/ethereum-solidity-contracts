# DStakeRouterV2 Bytecode Slimming Investigation

## Context & Goal

- **Objective:** reduce the deployed bytecode of `contracts/vaults/dstake/DStakeRouterV2.sol` to ≤ 24 576 bytes so it can be deployed without hitting the EIP-170 limit.
- **Why it matters:** the router currently compiles to ~58 kB of deployed bytecode. Mainnet deployment would fail without significant optimisation or modularisation.
- **Constraints:** keep existing behaviour/API for the router, including solver flows, governance configuration, and on-chain allocation logic. Maintain compatibility with existing tests and deploy scripts.

## Work Attempted So Far

1. **Library + diamond storage refactor (abandoned)**
   - Extracted essentially all router logic into a delegate-called library (`DStakeRouterV2Lib`) using a diamond-storage layout (`DStakeRouterV2Storage`).
   - Wrapped the library with a thin `DStakeRouterV2` contract that forwards calls and exposes the existing ABI.
   - Updated deployment scripts to deploy the library and link it into the router.
   - Result: the library itself compiled to ~28 kB (still above the limit) and triggered `stack too deep` errors despite `viaIR` and optimiser tweaks. Splitting additional logic across more libraries/facets became necessary, which significantly widened the scope.
   - Changes were reverted to avoid leaving the repo in a half-migrated state.

2. **Compiler configuration review**
   - Confirmed Hardhat override already uses `viaIR` with optimiser runs set to 1 for the router.
   - Lowering runs further or toggling optimiser settings alone is insufficient; bytecode still far exceeds the limit without structural changes.

## Key Observations

- The contract bundles several orthogonal responsibilities: user deposit/withdraw flows, solver orchestration, governance configuration, adapter/vault management, and rebalancing. Even with IR optimisations the monolith stays >2× the target size.
- Rebalancing functions and governance helpers contribute heavily to bytecode size, but they are all part of the exposed ABI and are required by current scripts/tests.
- Simply moving code to a single library doesn’t help enough; the library carries nearly the same bytecode cost. Multiple smaller libraries (split by responsibility) or facet-style architecture appears necessary.

## Recommended Next Steps for Continued Research

1. **Modularisation Plan**
   - Identify logical chunks (e.g., Core deposit/withdraw flows, Solver flows, Governance config, Rebalancing) and evaluate splitting each into a separate library or facet.
   - Ensure shared helpers (`_getActiveVaults...`, allocation math, etc.) are deduplicated or moved into lightweight utility libs.

2. **Storage Strategy**
   - Finalise a storage layout that supports multiple libraries without risking collisions. The diamond-storage pattern looked viable; confirm any adjustments needed if multiple libraries write to the same layout.

3. **ABI Compatibility & Tests**
   - Map existing tests/deploy scripts to the new structure. Determine if wrapper contract can simply forward to libraries (keeping current ABI) or if upgrade to a facet/diamond router is acceptable.

4. **Bytecode Budget Tracking**
   - Use Hardhat’s size reporting or `solc --metadata --asm` to measure function-level contributions once the code is split, ensuring each linked library stays well under the limit.

5. **Governance Trade-offs**
   - Consider whether rarely used governance helpers can be moved to separate deploy-time tooling or optional modules to save bytecode, if modularisation still fails to meet the limit.

### Additional Pitfalls to Address

When planning the follow-up implementation, keep these bytecode traps in mind:

- **Router ABI surface vs. fallback:** decide whether to keep every entry point on the router or introduce a fallback that forwards to facets/libraries. Doing both bloats runtime size.
- **Heavy shared dependencies:** `AccessControl`, `EnumerableSet`, and similar OZ utilities inside each facet/library reintroduce large chunks of bytecode. Prefer centralising OZ usage in the thin router wrapper (which already inherits `AccessControl`) so the robustness of the audited modules is retained without duplicating their bytecode across every facet.
- **Verbose revert strings:** even in seldom-used code paths they count toward runtime bytes. Prefer custom errors or shorter strings throughout the refactor.
- **`try/catch` usage:** the generated dispatcher is expensive. Replace `try/catch` around external calls with explicit return-value checks wherever possible.

## Responsibility Map & Hot/Cold Assessment (2025-02-17)

- **Core user surface (Hot Path)**  
  - `handleDeposit`, `handleWithdraw`, solver deposit/withdraw variants, preview/max ERC-4626 helpers, and `_depositToAutoVault` / `_selectVaultForWithdrawal`.  
  - Dependencies: token interface (`IDStakeTokenV2Minimal`), vault adapters, OZ `Pausable`/`ReentrancyGuard`.  
  - Runs every user interaction; keep inline for gas predictability but shrink revert strings and consolidate helper math.

- **Liquidity maintenance (Warm Path)**  
  - Rebalance flows (`rebalanceStrategiesBy*`, `_rebalanceStrategiesByShares`, `_executeGrossWithdrawals`), settlement bookkeeping (`recordShortfall`, `clearShortfall`), and fee reinvest (`reinvestFees`).  
  - Triggered by keepers/governance at moderate cadence; candidates for a dedicated module once baseline slimming is exhausted.

- **Governance & configuration (Cold Path)**  
  - Vault config lifecycle (`setVaultConfigs`, `add/update/remove/suspend`, status toggles), adapter management (`addAdapter`, `removeAdapter`, `_syncAdapter`), treasury knobs (`setReinvestIncentive`, `setWithdrawalFee`, `setDustTolerance`, `setDepositCap`, `setMaxVaultCount`), pausing.  
  - Heavy use of structs/loops; best targets for fallback gating or helper contract if still above size threshold.

- **Read-only surface (Shared Utilities)**  
  - Reporting helpers (`getCurrentAllocations`, `getActiveVaults*`, `isVaultHealthy*`, `getVaultConfig*`, `_getAllVaultsAndAllocations`).  
  - Safe to keep centralized but consider moving repeated balance calculations into a small view library to deduplicate bytecode.

- **Internal plumbing (Shared State Helpers)**  
  - Allocation math, health checks, and storage mutators (`_addVaultConfig`, `_removeVault`, `_clearVaultConfigs` etc.).  
  - Many are reused across hot and cold paths; ensure any future library split keeps these shared to avoid duplication.

**Call frequency ranking:** Core user flows > Solver ops > Rebalance > Fee reinvest > Governance toggles. This ordering guides which functions stay resident in the main router and which can migrate behind a fallback or helper after baseline slimming.

## Deliverables for Future Implementation

- Prototype decomposition (multi-library or diamond) that compiles successfully with all tests passing.
- Updated deployment scripts linking new libraries/facets.
- Documentation on storage layout and upgrade implications.
- Verified bytecode size reports demonstrating ≤ 24 576 bytes for the deployed router contract.

This ticket captures the exploration performed and the gaps remaining so the next round of work can focus directly on an architectural redesign rather than repeating prior attempts.
