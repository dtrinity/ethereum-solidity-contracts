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

## Governance Offload Notes (2025-02-17)

- **Candidate selectors for delegation:**  
  - Vault topology management (`setVaultConfigs`, `add/update/remove` overloads, `setVaultStatus`, `suspendVaultForRemoval`, `removeVaultConfig`).  
  - Treasury knobs (`setDepositCap`, `setMaxVaultCount`, `setDustTolerance`, `setReinvestIncentive`, `setWithdrawalFee`).  
  - Emergency actions (`emergencyPauseVault`, `sweepSurplus`, `recordShortfall`, `clearShortfall`).
- **Module shape under consideration:** deploy a `DStakeRouterV2GovernanceModule` contract that mirrors the router storage layout via an abstract `DStakeRouterV2Storage` base. Cold-path functions on the router become minimal stubs that `delegatecall` into the module, shrinking router runtime while keeping the ABI surface intact.
- **Routing strategy:** keep the router ABI by retaining function signatures; each stub executes `_delegateTo(governanceModule)` (single assembly helper) so all parameter decoding stays inside the module. Fallback gating is unnecessary for the first iteration.
- **Safety guardrails:**  
  1. Restricted selectors table to ensure only approved governance/admin calls can delegate outward.  
  2. Module inherits the same role checks (`onlyRole`) so authorization logic remains unchanged after delegation.  
  3. Storage base contract documents slot order to prevent drift if new state variables are introduced.
- **Open questions before coding:**  
  - How to version/deploy the module alongside the router in existing Hardhat scripts (linking + address injection).  
  - Whether to keep `_syncAdapter`, `_removeAdapter`, `_clearVaultConfigs` in the base contract or duplicate them in the module to avoid tight coupling.  
  - Test coverage required to validate delegatecall plumbing (focus on vault lifecycle + fee knob regression tests).

## Deliverables for Future Implementation

- Prototype decomposition (multi-library or diamond) that compiles successfully with all tests passing.
- Updated deployment scripts linking new libraries/facets.
- Documentation on storage layout and upgrade implications.
- Verified bytecode size reports demonstrating ≤ 24 576 bytes for the deployed router contract.

## Multi-Module Split Blueprint (Draft)

1. **Slice definition**  
   - `RouterCore`: keep ERC-4626 surface (`handleDeposit/Withdraw`, solver flows, reinvest) plus token/dStable bookkeeping.  
   - `RouterRebalance`: move share/value rebalance flows, fee shortfall bookkeeping, surplus sweep.  
   - `RouterGovernance`: encapsulate vault topology + admin knobs (build on delegate module above).  
   - `RouterViews`: optional facet for read helpers if the view footprint remains large after other moves.

2. **Shared storage contract**  
   - Extract state declarations and cross-cutting helpers (`_getVaultConfig`, `_isVaultHealthy*`, `_syncAdapter`, `_removeAdapter`) into `DStakeRouterV2Storage`.  
   - Each module inherits the storage base and reuses the same custom errors/events via `import`.

3. **Call dispatch strategy**  
   - Maintain a thin `DStakeRouterV2` wrapper exposing the public ABI; each function body delegates to the relevant module via private helpers (per-slice delegate).  
   - Keep hot-path functions inline to avoid delegatecall overhead, but isolate cold paths + rebalancing behind delegatecall.  
   - Optionally add fallback dispatcher for future expansion once tooling + tests can tolerate it.

4. **Deployment impact**  
   - Hardhat deploy script to deploy modules first, record addresses, and store them in router constructor args (`struct ModuleConfig { bytes4[] selectors; address implementation; }`).  
   - Add regression test harness to simulate governable upgrades (swap module address, verify storage untouched).

5. **Validation plan**  
   - Re-run full test suite with focus on solver flows + governance edges.  
   - Compare event emissions and view outputs before/after split.  
   - Size report per module + router to ensure each unit under 12 KiB, aggregated router runtime < 24 576 bytes.

## Governance Module Prototype (2025-02-17)

- Delegated the full governance/configuration surface from `DStakeRouterV2` into `DStakeRouterV2GovernanceModule`, retaining the router ABI via thin forwarding stubs guarded by existing role checks.
- Router runtime shrank to **28.283 KiB** (‒7.254 KiB) while the governing module compiles to **10.638 KiB** (`yarn size:dstake-router`). Additional decomposition still required to hit the 24 KiB deployed target.
- Storage layout mirrored between router and module; the router now exposes `setGovernanceModule(address)` for deployment wiring. Hardhat deploy script `deploy/08_dstake/01_deploy_dstake_core.ts` deploys the module per instance and links it post-router deployment.
- Next reduction levers before full facet split:
  1. Evaluate moving the rebalancer flows into their own module (largest remaining cold path).
  2. Prune duplicated view helpers in the router once read-only module is carved out.
  3. Revisit revert-string compression within the module (still carries legacy messages).

This ticket captures the exploration performed and the gaps remaining so the next round of work can focus directly on an architectural redesign rather than repeating prior attempts.
