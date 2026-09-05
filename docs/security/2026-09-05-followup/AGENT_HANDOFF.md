# Agent handoff: amend the existing incident PR

## Objective and baseline

Apply and validate the incremental `followup.patch` supplied with this handoff. It was built on the user's full Ethereum source archive **plus the previously delivered incident remediation patch**, not on unmodified main. The bundle's `SOURCE_BASELINE.json` and per-file hashes identify that exact local baseline. Local Git commit IDs in that record are reproducibility identifiers, not upstream PR commits. Fetch the actual current PR branch, inspect intervening changes, and reconcile intentionally before applying anything. Do not replace the PR with a stale archive or apply the original incident patch twice.

This delivery is a review candidate. No mainnet transaction was broadcast. Solidity compilation, semantic type checking, runtime-size measurement, Hardhat tests, Foundry tests and mainnet-fork rehearsal were not executed in the authoring environment. The dependency-free policy/model suite passes 92 tests. Do not call that an EVM pass, RED/GREEN exploit reproduction, audit sign-off or incident resolution.

## Apply

From the existing incident branch with a clean working tree:

```bash
git status --short
git apply --check /path/to/followup.patch
git apply /path/to/followup.patch
bash scripts/followup-2026-09-05/validate.sh --offline
```

If application fails, compare the changed-file copies and baseline hashes. Port only the reviewed changes into the updated branch; do not force overwrite or discard intervening fixes. The patch is incremental and includes tests, code-enforced tripwires, operational tools and these instructions.

Restore the repository's pinned dependencies and submodules using its existing lockfile/toolchain (Yarn 4.5.0 in the supplied package configuration). Install a reviewed Foundry version through the team's normal process. Then run:

```bash
bash scripts/followup-2026-09-05/validate.sh
```

The full command intentionally fails when the pinned toolchain is missing. It compiles, checks contract sizes, runs focused regressions, the existing Hardhat suite and dSTAKE Foundry tests. Fix compiler errors, interface/fixture incompatibilities and test failures without removing protective assertions or broadly skipping old tests. Run the repository's semantic TypeScript/lint checks as applicable. A passing local suite still requires a pinned Ethereum-fork rehearsal and independent review.

## Non-negotiable design decisions

1. **Permissionless compounding is intended.** Keep the final dSTAKE settlement entry open to every payer meeting the threshold. No `REWARDS_MANAGER_ROLE` execution gate, price oracle or administrative approval of individual keepers. Preserve the fixed-threshold exchange, treasury fee and zero sdAsset mint to the keeper. Generic unrelated `RewardClaimable` consumers retain their existing role policy.
2. **Entitlement belongs to the collateral-vault holder.** Claim through StaticAToken's holder accounting, including rewards publicly precollected into the wrapper. Never grant a replacement manager the wrapper-wide aggregate upstream entitlement. Sharing is supported without assuming dSTAKE is the only holder. Historical unpaid liabilities still require reconciliation.
3. **One guarded current-router entry controls compounding deposits.** Replacement managers have no direct adapter or collateral-custody authority. They start paused, detect stale router bindings and need separate emergency pause authority. Revoking only old router permissions is not enough: enumerate and retire old managers, historic adapters, admin grants and both wrapper/holder claimer slots.
4. **Rounding policy is fixed, explicit and bounded.** Defaults remain one underlying base unit. Review per-strategy and aggregate limits in the 0–16 hard range; never derive a loss allowance from dust tolerance, deposit size or a donation-manipulable exchange rate. Never excuse zero added backing. Two units fixes the supplied fixed-index StaticAToken counterexample, not every strategy, withdrawal or multi-leg operation. Retain the aggregate budget across repeated legs.
5. **Suspension is not a write-off.** Retain funded strategies in NAV. Material delisting must revert; the explicit dust function is paused-only, bounded to one base unit by both valuations and intended for an atomic disposal/removal batch. Do not silently clear legacy cash, shortfall or reward liabilities.
6. **No Odos remediation.** It is deprecated and intentionally untouched. Do not expand the PR to repair it.

Read `INVARIANTS.md` for the complete constraints and `DEPLOYMENT.md` for the authority model and transaction order.

## Review and completion tasks

### Contract review and tests

- Compile every new/changed contract using the pinned repository settings. Measure deployed bytecode under the real EIP-170 limit; do not enable unlimited contract size as a release workaround. The router/modules use generation-3 storage metadata and require matching fresh deployments.
- Execute `TEST_MATRIX.md` cases, all existing incident regressions, the corrected AMO permit tests, reward integration tests and Foundry invariants. The 31 new parameter-expanded cases plus three migration cases are written but unexecuted in this delivery.
- On an archive Ethereum fork, use the actual deployed StaticAToken implementation, controller, current accrued indices and wrapper reward inventory. Reconcile both dSTAKE and an independent holder, including stopped emissions, public precollection, partial historical funding and existing claims. The local tests use the real wrapper with controlled pool/controller mocks, not a complete upstream integration.
- Exercise standard and solver deposits/withdrawals, repeated and multi-vault legs, rebalance, sweep and reinvestment at actual strategy indices. Justify each configured rounding bound, or preserve fail-closed behavior until a strategy-specific reviewed design is ready.
- Run positive authorized Curve trades and flash callbacks against real supported routes, not just the rejection/sentinel tests. Validate approvals, permits and ownership end to end. Relay support would require a separate signed-intent design; do not weaken the direct caller check.
- Exercise AMO permit repayment with a real signature, expired/bad signature, ordinary approval fallback if supported, unauthorized callers, existing debt and partial repayment. Do not remove role checks or outer reentrancy guards.
- Test composite prices and timestamps with real feed decimals and downstream freshness limits. First-feed round IDs and latest-only historical behavior are unchanged by this PR.

### Deployment and capability reconciliation

- Refresh all chain anchors, authority and financial state. The supplied configuration deliberately has `reviewed: false`. Do not flip it based on this handoff alone.
- Use `role-inventory.mjs` on every current/historical adapter and collateral contract, from their real deployment blocks; inspect controllers and claimers separately. Event discovery is limited to explicitly supplied contracts and cannot prove global completeness.
- Bind the reviewed retirement inventory and rounding policy into a **fresh** migration guard/deployment plan. Do not reuse a generation-2 router or mix module generations. If the earlier remediation is already on-chain, stop and generate a new plan from that current state.
- Rehearse the exact atomic Timelock batch, including separately owned emission-manager revocation preconditions. Verify that rollback restores state if even one capability or claim is left behind. Compare total supply, all underlying/strategy balances, backing, cash and shortfall before and after.
- Deploy new versioned reward managers paused. `reward-ops.mjs` only emits unsigned deployment/bootstrap/activation proposals and validates source/nonce/roles; it does not sign or broadcast. Clear legacy authority first, then authorize only the collateral-holder claimer. One holder/controller has only one upstream claimer slot: coordinate multiple managers explicitly. Review MetaMorpho URD/skim attribution independently.
- Follow the separate Curve, AMO and oracle deployment sections. They require actual deployed addresses, authority and dependent consumers; this bundle deliberately does not invent live replacement batches. New AMO managers must preserve the existing debt token and outstanding debt. Old Curve approvals require explicit user action; a new deployment cannot revoke them.
- Reopening dUSD, router/strategies, reward auctions, dLEND and Curve LPs is separate governance work. This patch intentionally performs none of those actions.

## Required return from the implementing agent

Update the existing PR with the reviewed patch and any necessary compatibility corrections. Include: exact base/head commits; dependency/compiler versions; successful full test and bytecode-size logs; a resolved failing-test ledger; pinned fork block and state reconciliation; reviewed rounding rationale; old/new role and claimer inventory; unsigned plan hashes, target addresses and authorities; rollback boundaries; and a list of any remaining blockers. Do not claim the incident resolved solely because source tests pass or the actor is quiet.
