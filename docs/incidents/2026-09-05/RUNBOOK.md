# Operator runbook — paused Ethereum sdUSD router replacement

> **Follow-up amendment:** Before using this historical runbook, read `docs/security/2026-09-05-followup/DEPLOYMENT.md` and `AGENT_HANDOFF.md`. The follow-up requires fresh generation-3 router/modules, explicit rounding review and legacy reward-capability retirement. Old plan hashes, constructor arguments and generation-2 components are not reusable. No reopening approval is implied.

## Preconditions

Rollout is **three steps / one Timelock campaign**: (1) separately approved agent-wallet
CREATEs and bootstrap of paused replacements, (2) Governance Safe **3/5** submits one
`scheduleBatch`, (3) one `executeBatch` after the **24h** delay. The batch includes
legacy-router containment and execute-day cash handling. There is no separate
router-pause clock and no reopening in this campaign.

Use the full repository at the supplied base, or consciously rebase and re-review.
Restore its existing dependency lockfile and `.shared`/Foundry dependencies. The
selected remediation archive alone is not a bootable project. Run the complete
validation script and independently review its actual results. No compiler,
contract-test or fork-success result is implied by this document.

The default anchor configuration is `scripts/incident-2026-09-05/ethereum.json`.
All authority must be re-read. No dUSD/sdUSD/Idle proxy upgrade is part of this
change. Never send `upgradeTo` to the non-proxy router.

All examples below assume the repository root. RPC URLs are supplied through
named environment variables, not committed files. No command logs their values.
Only a live replacement deployment reads `$DEPLOYER_PK`; governance remains
unsigned Safe transaction data for human review.

## 1. Preserve containment; capture inventory

```sh
node scripts/incident-2026-09-05/ops.mjs inventory \
  --rpc-env ETHEREUM_RPC_URL --out /tmp/dstake-ir-live
```

The inventory captures one block, code hashes, EIP-1967 implementation-slot
addresses/hashes where present, full collateral-owned strategy balances,
strategy/adapter NAVs, roles, cash, shortfall, limits and pointer identities.
This records the live integration; it does **not** certify that old code matches
the workspace source. Compare the relevant verified/source builds independently.

The optional `containment` command is a standalone emergency tool, **not a step
in this compressed rollout**. Do not schedule its router-pause operation alongside
the migration: a duplicate `pause()` reverts. It creates unsigned files only when
a pause is still needed:

- `emergency-dUSD-pause.safe.json`: direct dUSD pause by the verified emergency Safe.
- `containment-schedule.safe.json`: Governance Safe schedules the router pause.
- `containment-execute.safe.json`: Governance Safe executes that pause after maturity.

Do not replace the already-pending emergency-Safe nonce or discard signatures.
The emergency pause file has no Safe nonce and is not a competing signed proposal.
It is calldata for comparison/reuse. Timelock roles and delay are queried rather
than inferred from signature thresholds. The delay begins when scheduling is
mined. The operation record includes the current scheduled timestamp: 0 means
unscheduled, 1 means executed, and a larger value is the ready timestamp. Reuse an
existing operation rather than blindly attempt to schedule it again.

A reserve freeze/LP withdrawal remains defense in depth, not proof of accounting
isolation. Containment never unfreezes reserves or restores liquidity. The migration
temporarily unfreezes dLEND only inside its never-split cash-handling batch, then refreezes it.

## 2. Compile and inspect

```sh
bash scripts/incident-2026-09-05/validate.sh
```

The script runs the offline guards, compiles, checks the EIP-170 runtime limit,
runs the new Hardhat integration/migration tests, the existing dSTAKE Hardhat
regressions, and the dSTAKE Foundry tests. Tests can expose incomplete/legacy mocks
or integration differences. Investigate; do not bypass the guard to make tests
pass. Compilation must use the added 0.8.20/via-IR/optimizer-200 overrides for
incident contracts and both modules.

Deployment tooling also compares artifact build-info against current source and
checks initcode size. On readback, it compares runtime to the artifact with ONLY
compiler-declared immutable slots normalized, then validates immutable addresses
and module metadata through their getters. It does not strip arbitrary differences
or silently accept an artifact built from a different source tree.

## 3. Rehearse before live deployment

Start a local Hardhat Ethereum fork at a reviewed block using the full project.
The local chain must be 31337, the RPC must be loopback, and `hardhat_metadata`
must identify an Ethereum fork. The tooling intentionally refuses remote/mainnet
providers for simulation writes. Choose the exact intended deployer address and
confirm its nonce. Use a private local RPC with access limited to your machine.

```sh
# FORK_RPC_URL points to your local Hardhat fork. No private key is needed here.
node scripts/incident-2026-09-05/ops.mjs deploy \
  --local-fork --rpc-env FORK_RPC_URL --deployer "$DEPLOYER_ADDRESS" \
  --out /tmp/dstake-ir-fork

# Inspect deployment-plan.json. Supply its printed digest, not a placeholder.
node scripts/incident-2026-09-05/ops.mjs deploy \
  --local-fork --execute --rpc-env FORK_RPC_URL --deployer "$DEPLOYER_ADDRESS" \
  --review-sha256 "$REVIEWED_DEPLOYMENT_SHA256" --out /tmp/dstake-ir-fork

node scripts/incident-2026-09-05/ops.mjs plan \
  --local-fork --rpc-env FORK_RPC_URL \
  --deployment /tmp/dstake-ir-fork/deployment.json --out /tmp/dstake-ir-fork

node scripts/incident-2026-09-05/ops.mjs simulate \
  --local-fork --execute --rpc-env FORK_RPC_URL \
  --plan /tmp/dstake-ir-fork/migration-plan.json --out /tmp/dstake-ir-fork
```

The local deployment impersonates only the specified deployment account, funds it
with local test ETH, deploys new paused components, and configures their roles.
It deliberately persists in the LOCAL fork so the plan can be built against real
local contracts. The subsequent migration simulation snapshots that fork, uses
Governance Safe impersonation to schedule/execute through the real Timelock,
advances time, executes a single atomic migration batch, verifies postconditions,
and restores its snapshot. A previously scheduled migration is not rescheduled.
The local `fork-simulation.json` records exactly that rehearsal, not a profitability
proof or a reopening decision.

In addition, run reviewed strategy-scale deposit/withdrawal/fuzz scenarios on the
incident block and the latest intended state. The supplied generic mocks are not
a substitute for the live Idle/dLEND integrations. This package contains no
flash-loan attack, profit loop, or theft transaction.

## 4. Deploy the inert replacement on Ethereum

```sh
node scripts/incident-2026-09-05/ops.mjs deploy \
  --rpc-env ETHEREUM_RPC_URL --deployer "$DEPLOYER_ADDRESS" \
  --out /tmp/dstake-ir-live

# Review hashes, source/build inputs, CREATE nonces, calldata, and gas estimates.
# DEPLOYER_PK must already be supplied securely in the environment.
node scripts/incident-2026-09-05/ops.mjs deploy \
  --broadcast --max-fee-gwei 2 --priority-gwei 0.05 \
  --rpc-env ETHEREUM_RPC_URL --deployer "$DEPLOYER_ADDRESS" \
  --review-sha256 "$REVIEWED_DEPLOYMENT_SHA256" --out /tmp/dstake-ir-live
```

No write happens without an explicit write flag and the exact current deployment
review digest. A different nonce/build/configuration changes that digest. Live
`--broadcast` is supported ONLY for replacement creation and replacement bootstrap.
There is no live governance execution mode. The deployer must match the reviewed
address. Check gas funding separately. Live `--broadcast` requires `--max-fee-gwei`; if the network is more expensive the script waits (aborts) instead of overpaying.

The bootstrap sets the two new modules, copies economic settings and target
weights, makes every strategy Suspended, grants the Timelock the six privileged
roles, and revokes the deployer's privileges with DEFAULT_ADMIN last. The token's
router role remains assigned to the existing sdUSD token. Default strategy stays
zero. No old pointer or adapter authorization is changed yet.

Each receipt is written to `deployment.json`. A failed run remains `complete:false`.
Do not wire an incomplete deployment. Do not blindly rerun a partially broadcast
sequence at new nonces: inspect the journal, abandon/retire unused deployments or
review an explicit recovery. Paused orphan components are not evidence that the
live system has been remediated. Public source verification is a separate release
gate; no explorer credentials or verification service is assumed by this script.

## 5. Build, review and schedule the atomic migration

```sh
node scripts/incident-2026-09-05/ops.mjs plan \
  --rpc-env ETHEREUM_RPC_URL \
  --deployment /tmp/dstake-ir-live/deployment.json --out /tmp/dstake-ir-live
```

Rehearse the exact live-address plan on a fresh local fork containing those live
deployments. Local and live deployment records must not be substituted for one
another when building or verifying plans. The plan checksum binds its recorded
inventory, deployment and calls; dynamic prices should still be reviewed again
before signatures and execution.

The migration Safe files contain ONE call each: `scheduleBatch` and later
`executeBatch` on the Timelock. The executeBatch contents, in order, are:

1. The replacement router rescues only pre-activation donated cash (still first).
2. Pause the old router **if the pinned inventory says unpaused**; omit otherwise.
3. `guard.begin()` checks paused old/new routers, unchanged graph, zero shortfall,
   matching economics, complete strategy inventory and Suspended status; then records
   backing, supply and strategy balances before any legacy cash conversion.
4. If dUSD was paused, Timelock calls `dUSD.unpause()`. If the dLEND reserve was
   frozen, verified Timelock PoolAdmin calls `PoolConfigurator.setReserveFreeze(dUSD, false)`.
5. Always old-router `unpause()` → `reinvestFees()` → `pause()`, with zero incentive,
   even if planning-time cash was zero. This cash is **holder backing**, not Safe funds.
   It is reinvested into the existing strategy graph, without changing cloned targets.
6. Refreeze dLEND if temporarily unfrozen, then re-pause dUSD if temporarily unpaused.
   `guard.verifyLegacyCashHandled()` requires zero remaining old cash and exact
   backing/supply conservation. No unpause/unfreeze is allowed after this point.
7. Retire legacy reward capabilities/claimers per the follow-up deployment handoff;
   every adapter authorizes the new router.
8. `collateral.setRouter(newRouter)` then `sdUSD.migrateCore(newRouter, sameCollateral)`
   switch pointers atomically; every adapter revokes the old router's caller role.
9. `guard.finish()` requires exact backing/supply/position continuity, correct
   pointers, retired old custody/adapter rights and no remaining deployer powers.

**Never split this into independently executable transactions.** The guard has no
admin/custody privileges and transfers no funds; atomicity is provided by the
single Timelock executeBatch. A failed final assertion reverts all preceding
changes in that batch. The builder enforces its exact semantic call sequence and
the simulation rechecks both the sequence and encoded envelope.

The old router must be paused **at begin**, which the same batch now establishes.
Only a mined `scheduleBatch` starts the clock, not signature collection. Re-read
pause state, reserve state and ACLs before scheduling and execution and rehearse
the exact saved payload. State drift may require cancellation/reproposal; never
edit scheduled calls or manually unpause to make them work. New router stays
paused with every strategy Suspended, including Idle. The brief dUSD/dLEND window
cannot be sandwiched by another transaction inside one `executeBatch`; this does
not waive callback/reentrancy or exact-backing checks.

### Blockers that require an explicit decision

Nonzero legacy router cash is reinvested inside the backing snapshot, never swept to a Safe.
Nonzero shortfall is not cleared. A cap below current NAV cannot be copied through
the existing setter and requires an explicit reviewed adjustment. Adapter admins,
EIP-1967 implementation differences, unsupported positions and role mismatches
also block this path. These are intentional failures, not fields to force to zero.

Legacy donations after planning are covered by unconditional reinvestment. If
dUSD is paused and the inactive replacement receives cash, first-call rescue can
still revert because transfers are paused: this is a fail-closed availability
limitation, not permission to move rescue after `begin` or reopen separately.
Missing Timelock dUSD PAUSER or frozen-reserve PoolAdmin blocks this selected
path. The freeze-only Safe cannot substitute. Deposit caps, wrapper pause or
rounding loss may also block reinvestment: require a successful exact fork rehearsal,
not relaxed continuity. See the pinned evidence in the follow-up deployment handoff.

## 6. Verify isolation; review reopening separately

```sh
node scripts/incident-2026-09-05/ops.mjs verify \
  --rpc-env ETHEREUM_RPC_URL \
  --deployment /tmp/dstake-ir-live/deployment.json --out /tmp/dstake-ir-live
```

Verify guard phase 2, both pointers, holdings/backing continuity in the migration
receipt, old role revocations, new Timelock authority, paused state, code and
module identities. Resume monitoring NAV per share and every strategy position,
not just supply or the collateral vault's raw dUSD balance. This package does not
rewrite the separate operational watchdog because its deployed environment is
not part of this repository packet.

Reopening requires an independent approval and the evidence in `VALIDATION.md`.
The intended decision order is: complete router isolation; assess whether dUSD
can safely resume unrelated settlement; use the real PoolAdmin/Timelock path to
unfreeze dLEND if approved; approve eligible strategy configurations and sdUSD
reopening; restore AMO/Curve LP LAST after exchange-rate risk review. The freeze
Guardian is not an unfreeze interface. Verify the live PoolConfigurator address
and authority instead of inventing a transaction target.

Do not reopen Idle merely by setting a zero target. Do not delist its still-valued
shares. Do not declare the incident resolved because the actor is quiet or because
a deployment, migration, syntax check, or offline model test passed.

## Rollback

Before cutover, the old graph is unchanged: leave the new router paused, cancel
unexecuted timelock operations through verified governance, and correct/redeploy
replacement-only components. If a migration assertion fails, the single batch
rolls back automatically. After successful cutover, **do not point back to the
vulnerable legacy router** as a convenience rollback. Keep the new router paused
and use a separately reviewed roll-forward or accounting-preserving recovery.
