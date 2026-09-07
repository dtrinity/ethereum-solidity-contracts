# Validation record and release gates

## Status

**Engineering PR candidate; not deployment approval.** The patch targets the
selected repository tree identified by the supplied pack as
`d3103f8807a0abb23277b79dc136d002b57a6687`.

The attachment is not a bootable full checkout. It omits installed dependencies,
the pinned lockfile/shared tooling and Foundry libraries. This review environment
has Node and TypeScript but no working Solidity compiler, Hardhat, ethers or
Foundry installation. Package/network access was unavailable. Consequently,
**no Solidity compilation, Solidity integration/fuzz test, production-bytecode
match, mainnet fork rehearsal, or live on-chain transaction was performed.**
Do not interpret offline model tests or source-pattern checks as substitutes.

## Executed checks

| Check                                                           | Result              | Scope and limitation                                                                                                                                                                                   |
| --------------------------------------------------------------- | ------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------ |
| Node `--test scripts/incident-2026-09-05/policy.test.mjs`       | 49 passed; 0 failed | Pure policy, arithmetic-model and CLI refusal tests; no EVM and no RPC. Includes 20,000 deterministic model cases inside one test, not 20,000 independent contract tests.                              |
| Source guardrails, `node scripts/incident-2026-09-05/check.mjs` | Passed              | Checks required call sites, pause guards, whole-position checks, absolute tolerance, module generation, and absence of direct adapter movement calls outside the guard. Not Solidity parsing or proof. |
| JavaScript syntax, `node --check`                               | Passed              | All four new `.mjs` files.                                                                                                                                                                             |
| Shell syntax, `bash -n .../validate.sh`                         | Passed              | Syntax only, not full release-script execution.                                                                                                                                                        |
| TypeScript 5.8.3 `transpileModule` diagnostics                  | Passed              | Four changed/new TS files: Hardhat config, fixture, core regressions and migration regressions. No dependency resolution or semantic type checking.                                                    |
| `git diff --check`                                              | Passed              | Whitespace/conflict-marker check; patch application is checked separately when packaging.                                                                                                              |

The captured Node test log is `validation/offline-tests.tap`. Its 94 tests are
**not** the Solidity tests described below. The validation JSON distinguishes
`passed` from `not_run` for machine consumers.

## Written Solidity/EVM tests — NOT executed here

### Core integration: 25 cases

`test/dstake/RouterBackingConservation.test.ts` has 24 `it()` declarations; one
runs for each of two rebalance entry points, yielding 25 cases. It covers:

- Agreed zero inner shares / no backing through solver deposit, standard deposit,
  and standard mint; agreed tiny nonzero shares with material economic loss;
  `solverDepositShares`; healthy plus bad legs; and duplicate-leg tolerance.
- One smallest-unit tolerance, rejection of one-unit zero-backing issuance,
  already-owned positions gaining sufficient value without new shares, and
  legacy Idle donations while preserving funded reward reserves.
- Reinvestment, governance sweep, both share-based rebalance entry points,
  actual cash in both solver withdrawals and standard withdrawal, loss to
  remaining strategy holders, and the standard withdrawal payout cap.
- Unlimited-cap/explicit-zero-weight semantics, finite caps, Suspended status,
  paused privileged operations and allowance cleanup.

The fixtures have no flash-loan callback, mainnet target addresses, extraction
routine, or profit-seeking transaction sequence. They exercise local rejection
and conservation properties.

### Migration integration: 8 cases

`test/dstake/RouterIncidentMigration.test.ts` uses a local OpenZeppelin
`TimelockController` and tests constructor pause, old-module rejection, successful
atomic migration, rollback when adapter retirement is omitted, nonzero legacy
cash, outstanding shortfall, an unpaused old router, and unauthorized guard access.
The old router in this local fixture is the patched base router acting as a legacy
surrogate. This verifies intended API/transaction sequencing only after the tests
are run; it is **not a mainnet-bytecode compatibility test**.

### Foundry: 5 test functions, including 3 fuzz tests

`foundry/test/dstake/StrategyBackingGuard.t.sol` exercises the actual Solidity
library's increase/withdrawal checks, zero-backing rejection, the one-unit boundary,
and overflow-safe arithmetic. It is distinct from the offline JavaScript model.

### Full existing regression suites

The release script also runs all dSTAKE Hardhat tests, the existing
`AdapterNavSpoof` and `IdleVaultRewardSweep` suites, and the full dSTAKE Foundry
suite. None ran in this environment. Existing mocks that do not model ERC-4626
redemption accounting may require fixture corrections. Do not weaken production
conservation checks just to accommodate an unrealistic mock.

## RED on unpatched source: expected versus measured

The pack requests tests that fail on the old implementation and pass after the
fix. **That EVM RED/GREEN cycle has not been measured here.** The following are
expected to expose the old behavior based on source inspection:

| New assertion                                                         | Expected pre-fix failure                                                                       |
| --------------------------------------------------------------------- | ---------------------------------------------------------------------------------------------- |
| Zero and tiny inner-share rejection through all nominal-credit routes | Old code checks quantities, not sufficient whole-position backing.                             |
| Healthy/bad and duplicate-loss routes                                 | Old code has no per-position economic check or aggregate one-unit loss bound.                  |
| Legacy Idle donation rejection                                        | Empty collateral-owned position can remain valueless while old code credits nominal input.     |
| Reinvestment, sweep and rebalance conservation                        | Old paths can move value using nominal/share-return assumptions without the new checks.        |
| Withdrawal-report mismatch with preexisting router cash               | Old code can accept the adapter's returned amount without comparing actual new receipts.       |
| Withdrawal-induced loss to remaining holders                          | Old code does not enforce the full-position debit bound.                                       |
| Standard withdrawal surplus stays in router                           | Old standard path can pay net proceeds exceeding the expected net amount priced into the burn. |
| Paused privileged sweep/rebalance rejection                           | Old wrappers do not have the new pause requirement.                                            |

Positive compatibility tests (already-owned position, one-unit tolerance,
cap/status semantics, allowance cleanup) are **not** all expected to be RED on the
baseline. Migration tests concern new functionality, not reproduction of the old
accounting bug.

When establishing RED, use the baseline's matching router and modules and omit
new migration-only contracts/tests that call new selectors. A compiler failure
from mixing generations, or a missing custom-error ABI entry, is not behavioral
RED evidence. Record actual old execution/issuance versus expected rejection.
Then run the exact new source/build as GREEN. Do not claim this comparison until
both executions are captured.

## Mandatory release gates

1. **Restore the real checkout and pinned dependencies.** Apply/rebase the patch,
   review differences from this source snapshot, and run:

   ```sh
   bash scripts/incident-2026-09-05/validate.sh
   ```

   Capture compiler versions, build-info, bytecode sizes, and all test output.
   Contracts must fit runtime/initcode limits; deployment tooling rejects absent,
   oversized or stale artifacts. Those checks have not produced size numbers here.

2. **Certify live identities and review authority.** Run block-pinned inventory
   against fresh Ethereum state; compare deployed router, modules, token/proxy,
   collateral vault, adapters and strategy implementations against reviewed source.
   A recorded code hash is not by itself a source match. Verify current roles,
   Safe thresholds/nonce/pending transactions and timelock delay/operation state.
   The source pack is not a certified mainnet match.

3. **Reconcile backing and decide legacy cash/shortfall disposition.** The guarded
   batch snapshots backing before legacy cash is reinvested, requires zero incentive,
   and verifies exact backing/supply conservation before pointer changes. It still
   requires zero shortfall. Do not clear a loss or drop a valued adapter solely to
   make a precondition pass. Preserve an auditable before/after ledger.

4. **Rehearse on pinned mainnet forks.** Run real deposit/mint/withdraw/redeem,
   both solver routes, reinvestments and all rebalance paths against actual Idle
   and wrapped-dLEND configurations across boundary and realistic amounts. Rehearse
   the exact atomic governance batch at the incident-state block and at a fresh
   proposed-execution state. Test failure/rollback and timelock maturity. A script
   refusing writes on mainnet is not a successful fork rehearsal.

5. **Independently review the fix and residual valuation risk.** The two valuation
   measurements still trust strategy implementations; they are not independent
   price oracles. Passing the router accounting tests does not certify Curve rate
   safety, profitability closure, absence of read-only reentrancy, recoverability
   of prior losses, or strategy liquidity. Do not widen the one-unit tolerance
   merely to pass a live integration. Keep incompatible strategies isolated or
   design a separately reviewed measured-credit interface.

6. **Approve isolation and reopening separately.** First approve deployment of
   verified paused components and the timelocked, guard-protected migration. Verify
   completed guard phase, pointers, retired privileges, exact transaction-boundary
   accounting and paused/Suspended state. The compressed migration restores its
   temporary dUSD unpause/dLEND unfreeze before cash verification; neither is a
   persistent reopening. New-router unpause, persistent dUSD/dLEND reopening and
   Curve liquidity restoration remain separate reviewed governance actions.

The runbook describes simulation and operation preparation. The compressed-rollout
amendment's pinned cash/core regression and execution-time rounding limitation are
documented in `docs/security/2026-09-05-followup/DEPLOYMENT.md`. This is not a complete
live-manifest rehearsal, a mainnet execution receipt, or an incident-closure certificate.
