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
| L-01 | Missing role revocation protection | Low | Guard `DEFAULT_ADMIN_ROLE` in `contracts/dstable/IssuerV2_1.sol` & `contracts/dstable/RedeemerV2.sol` | dz | Won't fix | Document SOP |
| L-02 | Missing constructor input validation | Low | Zero-address guards for Issuer constructor wiring | dz | Resolved (dz/hashlock-audit-findings) | `yarn hardhat test test/dstable/IssuerV2_1.ts` |
| L-03 | Permit front-running in admin function | Low | `AmoManagerV2.repayWithPermit` tolerant handling | dz | Resolved (dz/hashlock-audit-findings) | `yarn hardhat test test/dstable/AmoManagerV2.spec.ts` |
| I-01 | Missing zero check in `setCollateralVault` | Info | Prevent accidental zeroing of `collateralVault` | dz | Resolved (dz/hashlock-audit-findings) | `yarn hardhat test test/dstable/IssuerV2_1.ts` |
| I-02 | Gas optimization in `setFeeReceiver` | Info | Skip redundant writes/events in `RedeemerV2` | dz | Won't fix | Document rationale |
| I-03 | Redundant AccessControl inheritance | Info | Remove double inheritance since `OracleAware` already extends AC | dz | Won't fix | Document rationale |
| I-04 | Missing bounds check in `setTolerance` | Info | Sanity-check AMO tolerance updates | dz | Won't fix | Document SOP |

### Validation templates

#### L-01 – Missing role revocation protection
- **Scope reference:** `contracts/dstable/IssuerV2_1.sol`, `contracts/dstable/RedeemerV2.sol`.
- **Audit callout:** Prevent loss of `DEFAULT_ADMIN_ROLE` via `revokeRole/renounceRole`.
- **Decision:** Won’t fix. Governance relies on being able to fully disown contracts (post-deploy cleanups, emergency renounces) and frequently revokes roles from the incoming owner after handoffs. Enforcing a “last admin” guard would block those operational patterns and provide marginal benefit given multisig controls.
- **Operational notes:** SOP already requires multisig confirmation before disowning; residual risk (accidental last-admin revoke) is accepted.

#### L-02 – Missing constructor input validation
- **Scope reference:** `contracts/dstable/IssuerV2_1.sol`.
- **Audit callout:** Guard `_collateralVault`, `_dstable`, `oracle` against zero.
- **Implementation:** Added `CannotBeZeroAddress` constructor guard mirroring RedeemerV2 so Issuer cannot deploy with zero vault/token/oracle references; no other wiring changes required.
- **Validation:** ✅ Focused ctor revert tests in `test/dstable/IssuerV2_1.ts` cover zero inputs across all three args (command above). Deployment/config paths already enforce non-zero addresses, so no migration impact.
- **Implication prompts:** Revisit other dStable constructors during future touch-ups, but no additional work scoped here.
- **Recommendation slot:** ✅ Ship guard.

#### L-03 – Permit front-running in admin function
- **Scope reference:** `contracts/dstable/AmoManagerV2.sol`.
- **Audit callout:** `repayWithPermit` could be front-run, consuming the permit and reverting the original tx.
- **Implementation:** Added `PermitFailed` error and allowance pre-check so we only invoke `permit` when needed and gracefully continue if approval was already granted (front-run) while bubbling a clear revert otherwise; NatSpec now documents the behavior.
- **Validation:** ✅ `test/dstable/AmoManagerV2.spec.ts` exercises both the skip path (pre-existing allowance) and the revert path when permit fails without approval.
- **Implication prompts:** None – admin runbooks already cover retrying with `repayFrom` if needed.
- **Recommendation slot:** ✅ Harden code.

#### I-01 – Missing zero-address check in `setCollateralVault`
- **Scope reference:** `contracts/dstable/IssuerV2_1.sol`.
- **Audit callout:** Prevent admin from bricking issuance by pointing to `address(0)`.
- **Implementation:** `setCollateralVault` now reuses `CannotBeZeroAddress`, ensuring governance can’t misconfigure the pointer mid-flight.
- **Validation:** ✅ Added regression test in `test/dstable/IssuerV2_1.ts` (`yarn hardhat test test/dstable/IssuerV2_1.ts`).
- **Implication prompts:** None—existing runbooks already verify non-zero addresses before rotating vaults.

#### I-02 – Gas optimization in `setFeeReceiver`
- **Scope reference:** `contracts/dstable/RedeemerV2.sol`.
- **Audit callout:** Short-circuit identical assignments to save SSTORE/event.
- **Decision:** Won’t fix. The fee-receiver setter is rarely touched, emits configurational events intentionally, and extra branching would complicate a critical admin flow for negligible gas savings.
- **Operational notes:** Governance playbooks already batch this call, so redundant events/storage writes are acceptable.

#### I-03 – Redundant AccessControl inheritance
- **Scope reference:** `contracts/dstable/IssuerV2_1.sol`, `contracts/dstable/RedeemerV2.sol`.
- **Audit callout:** `OracleAware` already extends AccessControl; remove duplicate inheritance.
- **Decision:** Won’t fix. Trimming the redundant inheritance is cosmetic but churns two large governance-critical contracts and would require re-running full access-control regression for negligible bytecode savings.
- **Operational notes:** Leave as-is until a future major rev touches these files and naturally re-evaluates the hierarchy.

#### I-04 – Missing bounds check in `setTolerance`
- **Scope reference:** `contracts/dstable/AmoManagerV2.sol`.
- **Audit callout:** Guard tolerance updates to avoid bricking AMO ops or overly loose invariants.
- **Decision:** Won’t fix. Governance occasionally zeroes tolerance during incident response, so enforcing hard bounds would block existing SOPs. Current monitoring already alerts when tolerance deviates from the default.
- **Operational notes:** Documented expected ranges in runbooks; revisit if we see misuse on mainnet.

## dStake Finding Portfolio

### Tracking table
| ID | Title | Severity | Audit cue / files | Owner | Status | Validation anchors |
| --- | --- | --- | --- | --- | --- | --- |
| M-01 | Router migration during shortfall inflates share price | Medium | Gate `DStakeTokenV2.migrateCore` while `router.currentShortfall() > 0` | dz | Resolved (dz/hashlock-audit-findings) | ERC4626 invariant + migration sims |
| L-01 | Emission schedule lacks reserve check | Low | `DStakeIdleVault.setEmissionSchedule` funding validation | dz | Resolved (dz/hashlock-audit-findings) | Idle vault accrual tests |
| L-02 | Vault removal without balance check desyncs TVL | Low | Reinstate dust-aware guard in `DStakeCollateralVaultV2` | TBD | Won't fix | Vault removal + NAV tests |
| QA-01 | Missing emergency withdraw in GenericERC4626 adapter | QA | Add admin rescue hook | dz | Resolved | Adapter + reward emergency tests |
| QA-02 | Adapters callable by arbitrary users | QA | Restrict deposit/withdraw to router | dz | Resolved | Access tests |
| QA-03 | Collateral vault blocks dStable rescue | QA | Allow rescuing dStable (never intentionally held) | dz | Resolved (PR #19) | Rescue tests |
| QA-04 | Missing allowance reset in GenericERC4626 adapter | QA | Zero approvals after deposit | dz | Resolved (PR #20) | Allowance hygiene tests |
| QA-05 | Reward compounding threshold required to recover omissions | QA | Add recovery flow in `RewardClaimable` | dz | Won't fix | Ops runbook |
| Q-06 | Missing last-admin protection across dStake AC contracts | QA | Same pattern as dStable L-01 applied to router/token/vault/adapters | dz | Won't fix | Governance SOP |
| TAG-01 | Redundant `getWithdrawalFeeBps` | Tag | Remove duplicate view | dz | Resolved | ABI diff |
| TAG-02 | `reinvestFees` CEI deviation | Tag | Reshuffle CEI order | dz | Won't fix | Incentive rationale |

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
- **Decision:** ❌ Won't fix. Reintroducing balance checks reopens the griefing vector where dust donations (or stuck rewards) permanently block delistings. Governance instead commits to the documented suspend → drain → remove SOP, with off-chain dashboards ensuring TVL is 0 before removal.
- **Operational guardrails:** Update the vault sunset runbook to (1) `suspendVaultForRemoval`, (2) unwind via router automation, (3) verify `CollateralVault` balances off-chain, and (4) remove + prune adapter mappings. Monitoring will alert if removals occur with non-zero value so NAV discrepancies remain observable.
- **Implication prompts:** If future deployments demand on-chain gating, revisit absolute/relative dust thresholds once adapters can expose reliable value feeds without risking governance DoS.

#### QA-01 – Adapter emergency withdrawal
- **Scope reference:** `contracts/vaults/dstake/adapters/GenericERC4626ConversionAdapter.sol`, `.../WrappedDLendConversionAdapter.sol`, and reward managers under `contracts/vaults/dstake/rewards`.
- **Fix summary (Jan 2026):** Generic + Wrapped adapters now inherit OZ `AccessControl`, grant the deployer and collateral vault `DEFAULT_ADMIN_ROLE`, and expose `emergencyWithdraw(token, amount)` to push any ERC20 (dStable or ERC4626 shares) back to the collateral vault. `DStakeRewardManagerDLend` gained the same hook to forward stranded rewards to `treasury`, aligning it with the MetaMorpho reward manager. All hooks emit `EmergencyWithdraw` for ops visibility.
- **Validation:** `yarn hardhat test test/dstake/GenericERC4626ConversionAdapter.test.ts`, `yarn hardhat test test/dstake/WrappedDLendConversionAdapter.ts`, `yarn hardhat test test/dstake/DStakeRewardManagerDLend.ts`.
- **Coverage & scoped exclusions:** `MetaMorphoConversionAdapter` and `DStakeRewardManagerMetaMorpho` already expose audited rescue hooks; `DStakeCollateralVaultV2` retains its `rescueToken/ETH` flow; router/token/governance modules (`DStakeRouterV2*`, `DStakeTokenV2`) never custody arbitrary ERC20s and therefore do not require an emergency sweep surface. Documented that adapters send rescues to the collateral vault only; reward managers route to treasury by design.

#### QA-02 – Adapter caller restrictions
- **Scope reference:** All dStake conversion adapters plus reward manager compounders.
- **Fix summary (Jan 2026):** `GenericERC4626`, `WrappedDLend`, and `MetaMorpho` adapters now gate `depositIntoStrategy` / `withdrawFromStrategy` behind `AUTHORIZED_CALLER_ROLE`, expose a minimal `setAuthorizedCaller` toggle, and emit `UnauthorizedCaller` when unlisted accounts try to poke state. Adapter + dLend reward-manager deploy scripts (and Hardhat fixtures) auto-authorize the router and reward manager so no manual backfill is required.
- **Validation:** `yarn hardhat test test/dstake/GenericERC4626ConversionAdapter.test.ts`, `yarn hardhat test test/dstake/WrappedDLendConversionAdapter.ts`, `yarn hardhat test test/dstake/MetaMorphoConversionAdapter.access.test.ts`.
- **Operational notes:** Deploy scripts must set the router (and any automation/reward managers) as authorized callers after adapter deployment; additional tooling can be granted case-by-case via the new helper.

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
- **Decision:** ❌ Won't fix. Product and ops prefer to keep the exchange-threshold requirement invariant so compounders always front the same amount of exchange asset, even when replaying omitted tokens.
- **Operational notes:** Runbooks document the mitigation: (1) rerun `compoundRewards` with the required threshold amount once the omission is detected, or (2) temporarily lower the threshold via governance before calling `compoundRewards`, then restore it afterward. Both preserve accounting and the expectation that threshold changes are explicit governance actions.
- **Implication prompts:** Revisit if omission alerts become frequent enough to justify a specialized recovery hook or if automation costs become prohibitive on certain networks.

#### Q-06 – Last-admin protection across dStake
- **Scope reference:** `DStakeRouterV2`, `DStakeTokenV2`, `DStakeCollateralVaultV2`, adapters, rewards managers.
- **Audit callout:** Mirror dStable L-01 fix across all AccessControl surfaces.
- **Decision:** ❌ Won't fix. Governance already relies on multisig enforcement + off-chain runbooks to prevent stripping the final admin, matching the stance we took on the dStable portfolio. Adding on-chain guards across every AccessControl surface would bloat bytecode and complicate upgrades without materially improving safety given our operational SOPs.
- **Operational notes:** Runbooks require confirming at least one admin remains before revoking roles; monitoring alerts on role-change events so deviations are caught quickly. Any future module that needs immutable guardrails should adopt the dStable mixin explicitly rather than blanket everything.
- **Implication prompts:** Re-evaluate if governance ever moves to EOAs or if external integrators require on-chain assurances; otherwise no further action.

#### TAG-01 – Redundant `getWithdrawalFeeBps`
- **Scope reference:** `contracts/vaults/dstake/DStakeTokenV2.sol`.
- **Fix summary:** Removed the redundant `getWithdrawalFeeBps()` proxy so the ABI only exposes `withdrawalFeeBps()`. Verified no Solidity/TS callers used the alias and recompiled (`yarn hardhat compile`) to refresh artifacts.
- **Operational notes:** Deploy notes call out the ABI drop; integrators should already rely on `withdrawalFeeBps()` so no SDK updates were necessary.

#### TAG-02 – `reinvestFees` CEI alignment
- **Scope reference:** `contracts/vaults/dstake/DStakeRouterV2.sol`.
- **Decision:** ❌ Won't fix. Paying the solver incentive via `safeTransfer` before redepositing the remainder is intentional so keepers are compensated immediately; reordering for strict CEI compliance would either delay incentives or add extra state, with no new security benefit given the path is already `nonReentrant`.
- **Operational notes:** Documented in router runbooks that reinvest calls should be executed via trusted automation; monitoring ensures incentive payouts remain within configured bps.
- **Implication prompts:** If future audits surface an exploit requiring stricter CEI ordering, revisit with a more holistic router refactor; for now the current flow is pragmatic.

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
- **Open items (QA-05):** None—decision logged as Won't fix; any future change requires reopening the audit item with a new product mandate.
