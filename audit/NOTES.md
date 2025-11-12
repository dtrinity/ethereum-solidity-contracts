# Hashlock Audit Validation Notes

## Inputs Reviewed
- `Design.md` (platform overview for dStable, dStake, and dLend coordination)
- `contracts/dstable/Design.md` (issuer/redeemer/AMO mechanics)
- `contracts/oracle_aggregator/Design.md` (pricing surface shared by issuers and redeemers)
- `contracts/vaults/dstake/Design.md` plus `contracts/vaults/dstake/rewards/Design.md` (router/token/collateral vault and DLend reward flows)
- `contracts/vaults/rewards_claimable/Design.md` (RewardClaimable base hooks)
- `contracts/vaults/vesting/Design.md` (relevant to sdAsset lockups referenced by audits)
- `audit/hashlock_dstable_findings.md`
- `audit/hashlock_dstake_findings.md`

## Workflow Checklist Template
1. **Scope sync** – ☐ Confirm contract + network targets, pull latest deployments, and capture current admin topology.
2. **Design alignment** – ☐ Map the finding to the documented invariants/modules above; note any drift to be backported to docs.
3. **Fix shape** – ☐ Draft implementation notes + acceptance criteria, highlight migrations or storage changes.
4. **Validation plan** – ☐ Identify unit/integration/simulation coverage, manual runbooks, and monitoring alerts to update.
5. **Implementation** – ☐ Land code, run agreed test suites, capture gas/stat diff impacts.
6. **Ops sign-off** – ☐ Document go/no-go, required governance actions, and rollout/upgrade steps.
7. **Post-mortem & comms** – ☐ Update CHANGELOG/Design docs, prepare public disclosure (if any), and notify stakeholders.

## Domain Context Snapshots

### dStable quick references
- Collateralized issuance/redemption lives in `IssuerV2_1` and `RedeemerV2` with oracle-backed valuations (`contracts/dstable/Design.md`).
- `CollateralVault` custody plus AMO tooling (`AmoManagerV2`) enforce `totalSupply ≤ vaultValue` with peg-guard tolerances.
- Shared `OracleAware` base wires the aggregator + base unit across the stack.
- Governance touch points include vault rotation, fee receivers, tolerance knobs, and role-gated pauses; losing admin access bricks those levers.

### dStake quick references
- `DStakeTokenV2` (ERC4626) defers all capital routing to `DStakeRouterV2`; NAV = router TVL minus router shortfall (`contracts/vaults/dstake/Design.md`).
- Router orchestrates adapters, solver routes, fee retention, module delegatecalls, and deterministic allocation logic.
- `DStakeCollateralVaultV2` only ever holds strategy shares; adapters mint/burn directly there and rely on router role gating.
- Reward flows reuse `RewardClaimable` semantics (thresholded compounding, role-gated settlement) while DLend-specific managers extend exchange/deposit hooks.

## AccessControl Hardening – HASHLOCK L-01 (dStable) & Q-06 (dStake)
- **Findings recap:** Hashlock noted Issuer/Redeemer contracts plus the dStake router/token/collateral stack could permanently lose governance if the final `DEFAULT_ADMIN_ROLE` were revoked (L-01 & Q-06).
- **Implementation:** Subagent **AC-Hardening** introduced shared `LastAdminAccessControl` (+ upgradeable variant) that inherits OZ `AccessControlEnumerable` and prevents the last-admin `revokeRole/renounceRole` path. The mixins are wired through `OracleAware`, `CollateralVault`, `DStakeRouterV2`, `DStakeTokenV2`, `DStakeCollateralVaultV2`, `DStakeIdleVault`, and `MetaMorphoConversionAdapter`.
- **Testing:** `yarn hardhat test test/dstable/IssuerV2_1.ts test/dstable/RedeemerV2.ts`, `yarn hardhat test test/dstake/DStakeTokenV2.test.ts`, `yarn hardhat test test/dstake/DStakeRouterV2Governance.test.ts`.
- **PR:** https://github.com/dtrinity/ethereum-solidity-contracts/pull/15 (branch `ac-hardening` via `worktrees/ac-hardening`).

## dStable Finding Portfolio

### Tracking table
| ID | Title | Severity | Audit cue / files | Owner | Status | Validation anchors |
| --- | --- | --- | --- | --- | --- | --- |
| L-01 | Missing role revocation protection | Low | Guard `DEFAULT_ADMIN_ROLE` in `contracts/dstable/IssuerV2_1.sol` & `contracts/dstable/RedeemerV2.sol` | TBD | Pending | Unit + access-control fuzz |
| L-02 | Missing constructor input validation | Low | Zero-address guards for Issuer constructor wiring | TBD | Pending | Deployment script + ctor tests |
| L-03 | Permit front-running in admin function | Low | `AmoManagerV2.repayWithPermit` tolerant handling | TBD | Pending | E2E AMO decrease rehearsal |
| I-01 | Missing zero check in `setCollateralVault` | Info | Prevent accidental zeroing of `collateralVault` | TBD | Pending | Admin tx sim |
| I-02 | Gas optimization in `setFeeReceiver` | Info | Skip redundant writes/events in `RedeemerV2` | TBD | Pending | Regression tests + event diff |
| I-03 | Redundant AccessControl inheritance | Info | Remove double inheritance since `OracleAware` already extends AC | TBD | Pending | Compile + role regression |
| I-04 | Missing bounds check in `setTolerance` | Info | Sanity-check AMO tolerance updates | TBD | Pending | AMO invariant harness |

### Validation templates

#### L-01 – Missing role revocation protection
- **Scope reference:** `contracts/dstable/IssuerV2_1.sol`, `contracts/dstable/RedeemerV2.sol`.
- **Audit callout:** Prevent loss of `DEFAULT_ADMIN_ROLE` via `revokeRole/renounceRole`.
- **Proposed fix cues:** Count admins before removal; consider two-step admin transfers.
- **Validation tasks:** ☐ Extend access-control tests to cover last-admin revoke/renounce. ☐ Fuzz grant/revoke flows via Foundry invariant harness. ☐ Confirm upgrade bytecode size + storage layout unaffected.
- **Implication prompts:** Does introducing `getRoleMemberCount` require `AccessControlEnumerable`? Any governance processes relying on renouncing to freeze config?
- **Recommendation slot:** ☐ Adopt Hashlock fix as-is ☐ Rework (notes:) ☐ Needs product decision.

#### L-02 – Missing constructor input validation
- **Scope reference:** `contracts/dstable/IssuerV2_1.sol`.
- **Audit callout:** Guard `_collateralVault`, `_dstable`, `oracle` against zero.
- **Proposed fix cues:** Mirror RedeemerV2’s `CannotBeZeroAddress` pattern.
- **Validation tasks:** ☐ Add ctor revert tests. ☐ Diff deployment scripts/config to ensure parameters remain non-zero. ☐ Confirm no proxy initializer expectations change.
- **Implication prompts:** Will factories or upgrades rely on deferred initialization? Do we need similar guard rails elsewhere (eg. AmoManager)?
- **Recommendation slot:** ☐ Ship guard ☐ Document-only ☐ Needs architecture confirmation.

#### L-03 – Permit front-running in admin function
- **Scope reference:** `contracts/dstable/AmoManagerV2.sol`.
- **Audit callout:** `repayWithPermit` front-run yields benign failure; document or add graceful path.
- **Proposed fix cues:** Try/catch permit, fall back to allowance check; update NatSpec.
- **Validation tasks:** ☐ Build unit test covering consumed permit + fallback. ☐ Simulate AMO bot replay after permit already used. ☐ Update runbook for admins.
- **Implication prompts:** Will try/catch bloat bytecode? Should we instead drop the helper and rely on `repayFrom` only?
- **Recommendation slot:** ☐ Accept doc-only ☐ Harden code ☐ Defer.

#### I-01 – Missing zero-address check in `setCollateralVault`
- **Scope reference:** `contracts/dstable/IssuerV2_1.sol`.
- **Audit callout:** Prevent admin from bricking issuance by pointing to `address(0)`.
- **Proposed fix cues:** Add `CannotBeZeroAddress` revert; emit event once validated.
- **Validation tasks:** ☐ Regression test for zero input revert. ☐ Scripted dry-run of vault rotation with new guard.
- **Implication prompts:** Should other setters (`setRedeemer`, `setFeeReceiver`) share a base modifier? Do we need upgrade gating for multi-sig flows?

#### I-02 – Gas optimization in `setFeeReceiver`
- **Scope reference:** `contracts/dstable/RedeemerV2.sol`.
- **Audit callout:** Short-circuit identical assignments to save SSTORE/event.
- **Validation tasks:** ☐ Add require that new receiver differs. ☐ Verify event watchers expect update only on change. ☐ Re-run gas snapshots if available.
- **Implication prompts:** Any downstream automation expecting redundant events (probably not)? Should we generalize to other setters?

#### I-03 – Redundant AccessControl inheritance
- **Scope reference:** `contracts/dstable/IssuerV2_1.sol`, `contracts/dstable/RedeemerV2.sol`.
- **Audit callout:** `OracleAware` already extends AccessControl; remove duplicate inheritance.
- **Validation tasks:** ☐ Confirm compiler linearization unaffected. ☐ Run access-control regression/invariants. ☐ Ensure storage layout diff is nil.
- **Implication prompts:** Are there contracts relying on `AccessControl` public methods order? Need doc update noting inheritance chain?

#### I-04 – Missing bounds check in `setTolerance`
- **Scope reference:** `contracts/dstable/AmoManagerV2.sol`.
- **Audit callout:** Guard tolerance updates to avoid bricking AMO ops or overly loose invariants.
- **Proposed fix cues:** Enforce `0 < tolerance ≤ baseCurrencyUnit / 10000` (or configurable), emit event.
- **Validation tasks:** ☐ Extend AMO invariant tests for tolerance extremes. ☐ Document governance process for emergency override (if any). ☐ Evaluate need for two-step “unchecked” function.
- **Implication prompts:** Does tolerance live in basis points or base units? Should future markets require higher ceilings? Consider configurability per asset?

## dStake Finding Portfolio

### Tracking table
| ID | Title | Severity | Audit cue / files | Owner | Status | Validation anchors |
| --- | --- | --- | --- | --- | --- | --- |
| M-01 | Router migration during shortfall inflates share price | Medium | Gate `DStakeTokenV2.migrateCore` while `router.currentShortfall() > 0` | dz | Resolved (dz/hashlock-audit-findings) | ERC4626 invariant + migration sims |
| L-01 | Emission schedule lacks reserve check | Low | `DStakeIdleVault.setEmissionSchedule` funding validation | dz | Resolved (dz/hashlock-audit-findings) | Idle vault accrual tests |
| L-02 | Vault removal without balance check desyncs TVL | Low | Reinstate dust-aware guard in `DStakeCollateralVaultV2` | TBD | Pending | Vault removal + NAV tests |
| QA-01 | Missing emergency withdraw in GenericERC4626 adapter | QA | Add admin rescue hook | TBD | Pending | Adapter unit tests |
| QA-02 | Adapters callable by arbitrary users | QA | Restrict deposit/withdraw to router | TBD | Pending | Access tests |
| QA-03 | Collateral vault blocks dStable rescue | QA | Allow rescuing dStable (never intentionally held) | TBD | Pending | Rescue tests |
| QA-04 | Missing allowance reset in GenericERC4626 adapter | QA | Zero approvals after deposit | TBD | Pending | Allowance hygiene tests |
| QA-05 | Reward compounding threshold required to recover omissions | QA | Add recovery flow in `RewardClaimable` | TBD | Pending | Reward manager tests |
| Q-06 | Missing last-admin protection across dStake AC contracts | QA | Same pattern as dStable L-01 applied to router/token/vault/adapters | TBD | Pending | Access invariants |
| TAG-01 | Redundant `getWithdrawalFeeBps` | Tag | Remove duplicate view | TBD | Pending | ABI diff |
| TAG-02 | `reinvestFees` CEI deviation | Tag | Reshuffle CEI order | TBD | Pending | Fee reinvest tests |

### Validation templates

#### M-01 – Router migration during active shortfall
- **Scope reference:** `contracts/vaults/dstake/DStakeTokenV2.sol`.
- **Audit callout:** `migrateCore` ignores outstanding shortfall, inflating price.
- **Proposed fix cues:** Require `router.currentShortfall() == 0` or propagate into new router before switch.
- **Validation tasks:** ☐ Simulate migration with artificial shortfall to confirm revert/logging. ☐ Update governance SOP for clearing shortfalls prior to router swaps. ☐ Extend ERC4626 invariant tests to cover migration gating.
- **Implication prompts:** How to handle legitimate migrations where shortfall should follow? Need helper to copy shortfall state? Document upgrade sequencing.

#### L-01 – Emission schedule reserve validation
- **Scope reference:** `contracts/vaults/dstake/vaults/DStakeIdleVault.sol`.
- **Audit callout:** `setEmissionSchedule` should assert reserve ≥ duration * rate.
- **Fix summary:** Added `_applyEmissionSchedule` guard that requires finite windows, prevents positive-rate unbounded streams, and verifies `rewardReserve` covers the remaining duration. Introduced `fundAndScheduleEmission` helper to top up + activate atomically plus a `requiredReserve` view for ops tooling.
- **Validation tasks:** ✅ Unit tests for insufficient reserve, helper flow, unbounded revert, and observability (`yarn hardhat test test/amo/IdleVaultRewardSweep.test.ts`). ☐ Update ops dashboard to surface reserve sufficiency metric / promote helper usage.
- **Implication prompts:** Helper is now preferred path; legacy `setEmissionSchedule` remains for rate reductions. Consider documenting the new error surface for multisig operators.

#### L-02 – Vault removal dust thresholds
- **Scope reference:** `contracts/vaults/dstake/DStakeCollateralVaultV2.sol`, router governance module.
- **Audit callout:** Removing supported share with balance drops TVL instantly.
- **Proposed fix cues:** Dual threshold (absolute + relative) plus suspend-first workflow.
- **Validation tasks:** ☐ Add unit/integration tests for removal at/above thresholds. ☐ Cover griefing scenario with 1 wei donations. ☐ Update SOP for vault sunsets (suspend → withdraw → remove).
- **Implication prompts:** Need adapter hook to report value? Should router enforce same check before governance removal call?

#### QA-01 – Adapter emergency withdrawal
- **Scope reference:** `contracts/vaults/dstake/adapters/GenericERC4626ConversionAdapter.sol`.
- **Audit callout:** No admin recovery hook for stranded dStable.
- **Validation tasks:** ☐ Implement + test `emergencyWithdraw`. ☐ Document usage + require pause? ☐ Compare with MetaMorpho adapter pattern for consistency.
- **Implication prompts:** Should event include reason? How to prevent misuse while allowing timely recovery?
- **Dec 2025 Update:** Added `emergencyWithdraw`, AccessControl wiring, and an ETH-capable receive hook to `GenericERC4626ConversionAdapter`; see PR [#17](https://github.com/dtrinity/ethereum-solidity-contracts/pull/17). Tests: `yarn hardhat test test/dstake/GenericERC4626ConversionAdapter.ts`.

#### QA-02 – Adapter caller restrictions
- **Scope reference:** All dStake adapters.
- **Audit callout:** Public access creates footgun; only router should interact.
- **Validation tasks:** ☐ Introduce immutable router param + modifier. ☐ Add tests ensuring non-router calls revert. ☐ Evaluate need for multi-router support (future upgrades).
- **Implication prompts:** Any tooling (simulators) calling adapters directly? Document revert reason for UX clarity.
- **Dec 2025 Update:** All dStake adapters now gate calls via `AUTHORIZED_CALLER_ROLE` and expose `setAuthorizedCaller`; reward manager deployment also auto-allow-lists itself. PR [#18](https://github.com/dtrinity/ethereum-solidity-contracts/pull/18). Tests: `yarn hardhat test test/dstake/WrappedDLendConversionAdapter.ts` plus new access harnesses.

#### QA-03 – Collateral vault dStable rescue
- **Scope reference:** `contracts/vaults/dstake/DStakeCollateralVaultV2.sol`.
- **Audit callout:** Arbitrary dStable transfers currently unrecoverable.
- **Validation tasks:** ☐ Allow rescue for `dStable`, keep strategy share block. ☐ Test accidental transfer scenario. ☐ Update ops docs to discourage direct sends.
- **Implication prompts:** Should rescue require time delay or multisig ack? Need monitoring for unexpected dStable balances.
- **Dec 2025 Update:** Removed the dStable block from `rescueToken` and added a regression spec covering accidental transfers. PR [#19](https://github.com/dtrinity/ethereum-solidity-contracts/pull/19). Tests: `yarn hardhat test test/dstake/DStakeCollateralVaultV2.rescue.test.ts`.

#### QA-04 – Adapter allowance reset
- **Scope reference:** Generic ERC4626 adapter.
- **Audit callout:** Missing `forceApprove(..., 0)` after deposit.
- **Validation tasks:** ☐ Add zeroing + tests verifying no stale allowance. ☐ Confirm no regressions with tokens requiring allowance reset (USDT-style).
- **Implication prompts:** Unify allowance helper across adapters to avoid rework? Document rationale.
- **Dec 2025 Update:** `GenericERC4626ConversionAdapter` now zeroes vault allowances after deposits with coverage in `test/dstake/GenericERC4626ConversionAdapter.allowance.test.ts`. PR [#20](https://github.com/dtrinity/ethereum-solidity-contracts/pull/20).

#### QA-05 – Reward compounding recovery path
- **Scope reference:** `contracts/vaults/rewards_claimable/RewardClaimable.sol`.
- **Audit callout:** Omitted reward tokens require paying threshold twice.
- **Validation tasks:** ☐ Design `distributeClaimedRewards` (no exchange deposit). ☐ Add tests for omission -> recovery flow. ☐ Update automation runbooks to track expected token list.
- **Implication prompts:** Should managers store canonical reward token set on-chain? Need guard to ensure recovery cannot be abused to bypass threshold entirely?
- **Dec 2025 Update:** Added `recoverClaimedRewards` (emits `RewardsRecovered`) so stuck tokens can be redistributed without another threshold payment. PR [#21](https://github.com/dtrinity/ethereum-solidity-contracts/pull/21). Tests extended in `test/reward_claimable/RewardClaimable.ts`.

#### Q-06 – Last-admin protection across dStake
- **Scope reference:** `DStakeRouterV2`, `DStakeTokenV2`, `DStakeCollateralVaultV2`, adapters, rewards managers.
- **Audit callout:** Mirror dStable L-01 fix across all AccessControl surfaces.
- **Validation tasks:** ☐ Inventory contracts inheriting AccessControl. ☐ Apply shared mixin or base contract for last-admin guard. ☐ Expand invariants ensuring at least one admin persists.
- **Implication prompts:** Will module delegatecalls inherit guard automatically? Need to coordinate with upgradeable proxies for token?

#### TAG-01 – Redundant `getWithdrawalFeeBps`
- **Scope reference:** `contracts/vaults/dstake/DStakeTokenV2.sol`.
- **Audit callout:** Remove duplicate getter.
- **Validation tasks:** ☐ Delete function, run ABI diff, update clients. ☐ Verify no TS helpers use it (`typescript/` search).
- **Implication prompts:** If external integrators rely on it, plan deprecation? Provide alias in TypeScript SDK?

#### TAG-02 – `reinvestFees` CEI alignment
- **Scope reference:** `contracts/vaults/dstake/DStakeRouterV2.sol`.
- **Audit callout:** Emit events before/after external calls? reorder for CEI clarity.
- **Validation tasks:** ☐ Refactor to compute values, emit, then transfer/deposit. ☐ Confirm `nonReentrant` still guards critical paths. ☐ Update tests watching events/incentives.
- **Implication prompts:** Should we split events (incentive vs reinvest) for better observability? Any risk of double emissions after reorder?

## Recommendation Scratchpad
- Prioritize `M-01`, `L-02 (dStake)`, and `L-01 (dStable)` before informational items; unresolved accounting breaks can impact users fastest.
- Consider bundling AccessControl hardening (dStable L-01 + dStake Q-06) into a shared mixin to reduce duplicate auditing surface.
- Coordinate adapter-related fixes (QA-01/02/04) in one release to limit redeploy churn and simplify audits.
- Draft governance communication template covering: reason for shortfall gating, new emission funding requirements, and adapter usage warnings.
- Metrics to add once fixes land: shortfall-attempted-migration alert, emission funding sufficiency dashboard, collateral vault unsupported-token monitor.

### RouterOps – Hashlock M-01 & L-02 (Nov 2025)
- **Investigation:** Re-ran M-01/L-02 scenarios; confirmed router migrations ignore outstanding `settlementShortfall` and vault removal without dust gating craters NAV.
- **Mitigations:** Drafted a minimal patch that introduces `RouterShortfallOutstanding(shortfall)` and checks the legacy router state before switching; `migrateCore` now reverts until `router.currentShortfall() == 0`, preserving share price continuity. `DStakeCollateralVaultV2.removeSupportedStrategyShare` now checks both ≤1 dStable absolute value and ≤0.1% of TVL before delisting (adapter-valued), preventing griefing while blocking meaningful removals.
- **Validation:** Added a regression spec in `test/dstake/DStakeToken.ts` that records a shortfall, attempts migration (expects `RouterShortfallOutstanding`), clears the shortfall, and confirms migration proceeds. Full sweep: `yarn hardhat test test/dstake/DStakeToken.ts test/dstake/RouterGovernanceFlows.test.ts` plus shared pre-push guardrails (lint, solhint, invariant suites).
- **Open items:** Governance SOP to codify “clear shortfall → migrate router” and suspend→drain→remove flows; consider configurable thresholds for very small vaults.
- **PR:** https://github.com/dtrinity/ethereum-solidity-contracts/pull/16 (branch `routerops/hashlock-m01-l02`).

### AdapterOps – Hashlock QA-01..QA-05 (Nov 2025)
- **Investigation:** Audited adapter + reward flows called out in QA-01..QA-05 and replayed the Hashlock reproductions (orphaned shares via public adapters, unrecoverable dStable in the collateral vault, thresholded reward omissions). Determined QA-01/02/03/04 are straightforward code fixes; QA-05 needs a product call because it changes compounding economics.
- **Mitigations:**
  - **QA-01 (emergency withdraw) & QA-04 (allowance reset):** `GenericERC4626ConversionAdapter` now inherits OZ `AccessControl`, adds `emergencyWithdraw`, accepts ETH, and zeroes allowances after deposits. Deployment script wires router/admin roles. (PR https://github.com/dtrinity/ethereum-solidity-contracts/pull/17 – branch `adapterops/hashlock-qa-01`)
  - **QA-02 (router-only callers):** Generic, WrappedDLend, and MetaMorpho adapters now gate `depositIntoStrategy` / `withdrawFromStrategy` behind an allowlist (router, optional automation) with `setAuthorizedCaller` helpers. Deployment + reward-manager scripts auto-authorize the router and DLend reward managers. (PR https://github.com/dtrinity/ethereum-solidity-contracts/pull/18 – branch `adapterops/hashlock-qa-02`)
  - **QA-03 (dStable rescue):** Removed the dStable restriction from `DStakeCollateralVaultV2.rescueToken` so governance can recover accidental transfers; added a focused rescue test. (PR https://github.com/dtrinity/ethereum-solidity-contracts/pull/19 – branch `adapterops/hashlock-qa-03`)
- **Testing:** `yarn hardhat test test/dstake/GenericERC4626ConversionAdapter.ts`, `yarn hardhat test test/dstake/WrappedDLendConversionAdapter.ts`, `yarn hardhat test test/dstake/DStakeRewardManagerDLend.ts`, `yarn hardhat test test/dstake/DStakeRewardManagerMetaMorpho.test.ts`, `yarn hardhat test test/dstake/DStakeCollateralVaultV2.rescue.test.ts`, plus shared pre-push guardrails (lint, solhint, Hardhat suite).
- **Open items (QA-05):** Still evaluating options for a “distribute claimed rewards without fresh exchange asset” helper in `RewardClaimable`. Needs product alignment on whether threshold bypass is acceptable, how to authenticate the reward-token list, and if automation should remain permissioned. Documented requirements for a follow-up design session before writing code.
