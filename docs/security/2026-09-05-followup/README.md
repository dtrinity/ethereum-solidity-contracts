# September 5 follow-up: PR amendment, not reopening approval

## Basis and scope

This amendment is built against the supplied complete `ethereum-solidity-contracts-main (1)(1).zip` with the previously supplied `dTRINITY_Ethereum_Incident_Remediation.patch` applied. It does not claim to match subsequent edits to the actual GitHub PR or current mainnet state. The delivery bundle records exact input hashes and the local baseline tree. Apply the **incremental** patch to the existing incident branch, not to untouched main.

The keeper mechanism remains intentional and permissionless: anyone pays at least `exchangeThreshold` in the underlying asset for selected rewards, less the treasury fee. The payment benefits existing sdAsset holders; the keeper receives no newly minted sdAsset. This is a fixed-threshold competition, not an oracle-priced auction. We do not add an execution whitelist, operator approval or price oracle. Generic non-dSTAKE `RewardClaimable` consumers keep their existing role policy.

Odos is deprecated per the project owner and is excluded. No Odos contract, deployment script or test was changed to remediate its historical findings.

## Disposition of the audit findings

| Finding                                     | Disposition in this amendment                                                                                                                                                                                                                                                                         |
| ------------------------------------------- | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Permissionless dLEND compounding / H-01     | Withdrawn as a vulnerability. Preserve and positively test permissionlessness. Clarify the generic/derived contract policy distinction.                                                                                                                                                               |
| Wrapper reward attribution / H-02           | Use the actual StaticAToken wrapper's `claimRewardsOnBehalf(collateralVault, receiver, tokens)`. Never claim the entire wrapper's upstream emissions as the manager. Exact two-holder tests use the real wrapper with controlled pool/reward-index mocks, both before and after public precollection. |
| Independent reward-manager risk path / H-03 | Shared final dSTAKE settlement function, explicit manager pause, current-router binding, and guarded `compoundDeposit`. No direct manager adapter authority. Retire old adapter, custody and claimer capabilities during migration.                                                                   |
| One-unit false rejection                    | Reviewed fixed per-strategy loss budgets and a separate operation-wide budget, each 0–16 underlying base units. Default remains one. No percentage, donation-derived tolerance or use of `dustTolerance`.                                                                                             |
| Curve user consent                          | Authenticate caller-supplied `user` at each vulnerable external entry before any permit, transfer, debt query or flash loan. Existing callback caller/initiator checks remain.                                                                                                                        |
| AMO nested reentrancy                       | Both protected entries call a private repayment implementation. Keep outer authorization and `nonReentrant`; repair the two invalid test setup calls.                                                                                                                                                 |
| Funded strategy delisting                   | Suspended/impaired positions remain in accounting. Reject funded removal in the new router/module even with an old non-upgradeable collateral vault. Add explicit paused one-base-unit dust disposal. No material write-off function.                                                                 |
| Composite freshness                         | Report the oldest dependency timestamp; reject zero/future timestamps and preserve the existing 25-hour internal bound. First-feed round metadata and latest-only historical semantics remain unchanged.                                                                                              |
| Weak recovery test                          | Remove the old `lte`/skip test that could pass with no recovery; replace with exact positive entitlements and unchanged external-holder claims at a stopped emission index.                                                                                                                           |

## Implementation locations

- `contracts/vaults/dstake/rewards/DStakeRewardManagerBase.sol`: final permissionless settlement, input isolation, independent pause and current-router check.
- The concrete dLEND and MetaMorpho managers: reward acquisition hooks only; new instances start paused.
- `DStakeRouterV2.compoundDeposit`: current-router pause, default/Active status, cap, exact input and per-strategy/aggregate backing checks, no outer mint.
- `StrategyBackingGuard`: whole collateral-owned position checks, actual movement, bounded precision policy.
- `DStakeRouterV2Storage` and modules: generation-3 fingerprint, reviewed per-strategy policy, funded position lifecycle.
- `incident/DStakeRouterMigrationGuard` and `scripts/incident-2026-09-05`: bind and verify the explicit legacy capability retirement inventory in the atomic router switch.
- `scripts/followup-2026-09-05`: read-only reward deployment/activation planning, archive role discovery, policy tripwires and validation entry point.
- `test/followup-2026-09-05`: self-contained holder entitlement, bounded rounding, lifecycle, consent and freshness regressions. Existing migration, reward, AMO and governance tests are also updated.

## Validation status in this delivery

**Executed:** 92 offline Node policy/model tests, including the 49 prior tests and 43 new tests. Source tripwires and JavaScript syntax checks passed. The outer bundle contains the actual logs, TypeScript syntax-only results, and clean-application result.

**Not executed here:** Solidity compilation, Solidity type checking, Hardhat EVM tests, Foundry fuzz/invariants, bytecode size measurement, mainnet runtime matching, live authority inspection, and a pinned Ethereum-fork rehearsal. There is no locally installed Hardhat/solc/Foundry toolchain or contract dependencies; package retrieval was unavailable. The full validation command deliberately fails instead of silently substituting the offline suite.

The new Hardhat files define 31 parameter-expanded cases; three additional migration cases exercise independent capability retirement. These are **written, not passed**. Existing test updates and a Foundry handler assertion also require execution. A model/source check is not a Solidity proof or exploit reproduction.

Run `bash scripts/followup-2026-09-05/validate.sh --offline` for the dependency-free checks. Run without that flag, after restoring the pinned toolchain, for the full local gate. Read `DEPLOYMENT.md`, `INVARIANTS.md`, and `AGENT_HANDOFF.md` before preparing governance proposals.

## Non-claims and remaining operational work

These changes address the identified code paths. They do not certify incident attribution, quantify loss, prove exploit non-profitability, repair historical reward underfunding, guarantee every external adapter valuation, or make donation-sensitive external market pricing safe. They do not automatically reopen dUSD, the router, rewards, dLEND, or Curve liquidity. All live balances, authority, wrapper indices and claim liabilities must be freshly reconciled. Original incident monitoring and response controls still require independent operational verification.
