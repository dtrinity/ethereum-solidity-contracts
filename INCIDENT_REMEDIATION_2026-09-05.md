# Ethereum sdUSD incident remediation — PR handoff

Base: the selected `ethereum-solidity-contracts` tree supplied at
`d3103f8807a0abb23277b79dc136d002b57a6687`.

## Release status: engineering candidate, not deployment approval

The contracts, regression tests, deployment tooling, and migration assertions are
implemented. **Solidity compilation, contract-size measurement, Hardhat/Foundry
execution, mainnet-fork simulation, and mainnet source/runtime reconciliation were
NOT completed in the delivery environment.** The supplied archive omits required
source/dependency files and its lockfile; no Solidity compiler or Ethereum test
runtime was installed, and package-download access was unavailable.

The completed checks are listed in `docs/incidents/2026-09-05/VALIDATION.md`.
Do not interpret offline model tests or syntax checks as contract-test results.
No transaction was broadcast and no current incident status was independently
certified. The supplied root-cause hypothesis remains provisional; this patch
addresses the concrete accounting weaknesses identified in the supplied source.

## What changes

The router now validates actual underlying movement and the before/after value of
its **entire collateral-owned strategy position**, both through the strategy's
redemption quote and the adapter's accounting value. Matching inner preview,
actual and reported share quantities is no longer sufficient to credit nominal
assets. A positive deposit with no added backing is rejected. A deposit issuing
zero _new_ inner shares can still pass when already-owned shares gain enough
backing. The loss tolerance is one smallest underlying asset unit, bounded again
across each public multi-leg operation, not a percentage and not `dustTolerance`.

The common primitive covers ordinary deposit/mint routing, both solver deposit
variants, reinvestment, surplus sweeping, both withdrawal primitives and all
rebalancing variants. Withdrawals check **actual router cash received**, reject
unfunded adapter return values and excessive loss from the remaining position.
Standard withdrawals retain rounding surplus rather than pay an amount not
priced into the burned shares. Privileged sweeps/rebalances also stop on pause.

No token implementation or existing IdleVault is upgraded. The new module
compatibility generation prevents installation of old, unguarded modules on the
replacement router. The existing storage field layout is unchanged.

## Deployment shape

The live router is non-proxy. Deploy `DStakeRouterV2Incident` (paused in its
constructor), both new modules, and `DStakeRouterMigrationGuard`. Preserve the
existing sdUSD proxy, collateral vault, adapters, holdings, and user shares.

An unsigned **atomic timelock batch** authorizes the new router on the adapters,
changes both core pointers, retires old adapter authority, and checks exact
backing/supply/holding continuity. The guard requires the old router paused and
zero legacy cash and shortfall. It rejects an incomplete handover and requires
that deployer privileges have been removed. The replacement remains paused,
all strategies are Suspended, and its default strategy is cleared.

**No automatic unpause, dLEND unfreeze, shortfall clearing, adapter removal,
redemption of legacy holdings, proxy upgrade, or Curve LP restoration is included.**
A paused migration is isolation, not permission to reopen.

## Apply and validate

Apply `remediation.patch` from the delivery package to the full checkout after
checking its base. Run `git apply --check` before `git apply`; review conflicts
rather than overwrite concurrent incident work. The `changed-files/` directory
contains the same full-file changes for inspection.

```sh
# Full checkout; restore the project's existing pinned dependencies/submodules.
git apply --check /path/to/remediation.patch
git apply /path/to/remediation.patch
bash scripts/incident-2026-09-05/validate.sh
```

Do not update dependency versions merely to make the incident patch compile.
Follow `RUNBOOK.md` for the fork rehearsal and governance flow; satisfy every
release gate in `VALIDATION.md` before deployment approval.

- Design and trust limits: `docs/incidents/2026-09-05/ACCOUNTING.md`
- Operator steps: `docs/incidents/2026-09-05/RUNBOOK.md`
- Executed versus required tests: `docs/incidents/2026-09-05/VALIDATION.md`

The packet's top-level `scripts/dry_run_upgrade_router.ts` stub is superseded by
`scripts/incident-2026-09-05/ops.mjs`; it was not part of the supplied repo tree.
