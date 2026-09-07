# Deployment and operational handoff

**No live transaction has been sent by this work.** This is not authorization to deploy or reopen. All supplied production manifests remain intentionally unreviewed. Do not substitute guessed current addresses, balances, Safe thresholds, emission ownership or interest indices.

## 1. Establish the real branch and live state

Confirm whether the earlier incident PR is still un-deployed. The incremental patch is based on the supplied original incident implementation; it does not read GitHub. If a generation-2 replacement already became active, stop using the old anchors: review a new migration from the actual active router. Do not try to replace its delegatecall modules with generation-3 modules.

Restore the full repository and its pinned dependencies (`packageManager` specifies Yarn 4.5.0; `yarn install --immutable`; initialize configured submodules). Restore the reviewed Foundry toolchain/dependencies. Run the default full validation script. Fix compilation and real integration failures while preserving `INVARIANTS.md`. The local `allowUnlimitedContractSize` setting does not waive the explicit production runtime-size gate.

Record a fresh canonical block/hash, token/collateral pointers, every current/historical adapter, authorities, old manager addresses, aggregate/holder claimers, supplies, shares, backing, cash and shortfall. Also record wrapper indices, unclaimed amounts, wrapper/controller/manager reward balances and any earlier aggregate claims. Do not treat unchanged sdAsset supply as a no-loss proof.

The read-only role tool accepts:

```json
{
  "chainId": 1,
  "blockNumber": 0,
  "contracts": [{ "address": "FILL_FROM_VERIFIED_STATE", "fromBlock": 0, "label": "current/historical adapter or collateral or manager" }]
}
```

Replace blockNumber with the actual pinned block and fromBlock with the deployment block or earlier. The tool refuses a starting block after the contract already existed. It requires archive state/log access and fails on any missing log range. Run:

```bash
node scripts/followup-2026-09-05/role-inventory.mjs reviewed-role-input.json /secure/path/roles.json
```

It scans only supplied contracts and AccessControl events. It does not discover all historical contract addresses or enumerate arbitrary RewardsController user mappings; use deployment history, source review and emission ownership checks as well. Unknown roles/claimers must be resolved, not overwritten.

## 2. Maintain containment and retire legacy capabilities

Maintain dUSD containment. The router rollout is now **paused replacement CREATEs → one Governance Safe 3/5 `scheduleBatch` → one Timelock `executeBatch` 24h later**. Do not schedule a separate old-router pause campaign or a standalone execute-day dUSD unpause. Permissionless compounding itself is not a vulnerability, but the old direct-adapter implementation is outside the new isolation boundary. Revoking an old manager's configuration role is not containment.

Fill `scripts/incident-2026-09-05/ethereum.json` (or a reviewed private copy):

```json
{
  "retirement": {
    "reviewed": true,
    "evidence": "ACTUAL archive-block hash and complete authority/claimer evidence reference",
    "callers": ["OLD_REWARD_MANAGER_ADDRESS"],
    "extraAdapters": ["HISTORICAL_ADAPTER_NOT_IN_CURRENT_CONFIG"],
    "claimers": [
      { "controller": "REWARDS_CONTROLLER", "emissionManager": "EMISSION_MANAGER", "user": "STATIC_WRAPPER" },
      { "controller": "REWARDS_CONTROLLER", "emissionManager": "EMISSION_MANAGER", "user": "COLLATERAL_VAULT" }
    ]
  },
  "rounding": {
    "reviewed": true,
    "operationLoss": "2",
    "strategies": [{ "vault": "STATIC_WRAPPER", "loss": "2" }]
  }
}
```

This snippet is schematic, **not executable configuration**. The two-unit example is appropriate only after reviewing the actual implementations, index and supported operation shapes. All omitted strategies retain the one-unit default; the operation-wide budget remains independent. Multi-leg operations with larger legitimate combined loss can still revert. Review those routes rather than multiplying tolerance by caller-supplied array length.

If the EmissionManager is owned by the same Timelock, claimer zeroing is included in the atomic migration batch. Otherwise obtain a separately reviewed transaction from its actual owner first, and set `preconditionOnly: true` for that mapping. Planning then requires it already to be zero; the on-chain final guard checks it again. Do not impersonate the other owner in a production plan or silently exclude the check. Both aggregate-wrapper and collateral-holder mappings are required for recognized legacy dLEND managers. A nonzero claimer outside the retirement list causes planning to fail.

The core batch is:

1. Rescue only pre-activation replacement-router cash (first); pause the old router if inventory says unpaused, omitting a duplicate pause. Then `guard.begin()` snapshots backing while both routers are paused.
2. If dUSD was paused, Timelock unpauses it. If dLEND dUSD was frozen, verified Timelock PoolAdmin calls `setReserveFreeze(dUSD, false)`. Atomically unpause/reinvest/pause the legacy router with zero incentive even when planning-time cash is zero. Refreeze the reserve and re-pause dUSD when temporarily changed, **before** `verifyLegacyCashHandled()`. Verification requires zero remaining legacy cash and exact supply/backing conservation. Holder cash remains in sdUSD backing, not a Safe; cloned targets and the complete Idle/dLEND graph are unchanged.
3. Revoke listed old managers' adapter AUTHORIZED_CALLER_ROLE and admin, plus collateral ROUTER_ROLE and admin, across current and explicitly listed historical adapters.
4. Zero listed legacy reward claimers (or verify separately executed zero preconditions).
5. Authorize the new router, switch token/collateral pointers, revoke old router adapter authorization.
6. Finish assertions, including retired manager capabilities and zero claimers. Failure rolls back the entire batch.

No replacement reward manager is authorized in that batch. No reward claim, principal exit to a Safe, shortfall forgiveness, **new-router unpause**, persistent dUSD unpause/dLEND unfreeze or Curve LP restoration is included. No unpause/unfreeze is allowed after cash verification. The retirement list is hashed into the immutable migration guard; changing it requires a new reviewed guard/deployment plan, not silently editing the saved plan.

### Cash-path ACL evidence (read-only; refresh before signing)

Ethereum block **25923361**, hash `0xd4079757543ee2522d030c769f24887c24055adee2f73812928956bb2f65be1e`:

- Timelock `0x18CB0EB73D953eD20F2157ce6bDE2A85E30e681B` has `PAUSER_ROLE` on both old router `0xdD26C236ec95d03DDf3cB67b7f54864719E9Be5a` and dUSD `0x07fFf99e1664d9B116fbC158c0E99785F81cA236`.
- Old router `paused() = false`; dUSD `paused() = true`; dLEND reserve configuration bit 57 (frozen) = true.
- Provider `0xa5CaE880272183d7C8B69F8B0edF395f8E42e751` resolves ACL `0x80F7023e25a32E4A020ed71346c0f37C10589609`, PoolConfigurator `0x464792C57aEc24C32AfFDe65e6990F2a89695b2a`, Pool `0x6598DaD18Bda89A0E58A1F427c8CeBc0dE90F153`.
- ACL `isPoolAdmin(timelock) = true` (also `isRiskAdmin = true`). Selected path: existing PoolConfigurator unfreeze/reinvest/refreeze, **not** Idle retargeting and never the freeze-only Safe. Inventory rediscovers these endpoints and permission at a pinned block.

This amendment changes no router/module/guard Solidity or CREATE bytecode and does not flip `ethereum.json` reviewed flags. Live CREATEs, reviewed inventory, exact live-address fork rehearsal, human Safe signoff, the 24h delay and a separate reopening decision remain gates. If paused dUSD prevents first-call rescue of a donation to the inactive replacement, or reinvestment loses even a base unit of backing, stop; do not weaken guards.

**Pinned regression is not a guarantee for every execution timestamp.** At the block above, the preferred cash/core path succeeds with schedule timestamp `block.timestamp + 600` and execute timestamp `schedule + 86400 + 1` (1788845568). At `schedule + 86400 + 2`, dLEND accrued-index rounding causes `MigrationCheckFailed("cash-backing-changed")`; the entire transaction rolls back, retaining old cash and original containment. Both cases are asserted by `RouterIncidentMigration.test.ts`. A diagnostic Idle retargeting also completed at the successful timestamp, but is not the selected planner path. Do not time a mainnet broadcast from these historical timestamps: rehearse the actual intended state and retain fail-closed behavior.

Run `node --test scripts/incident-2026-09-05/policy.test.mjs scripts/followup-2026-09-05/followup.test.mjs` and `yarn hardhat test test/dstake/RouterIncidentMigration.test.ts`. To include the real, block-pinned cash/core regression, securely export `MIGRATION_FORK_RPC_URL` from `$ETHEREUM_RPC_URL` before the Hardhat test command. It resets only the in-process `hardhat` chain (31337), impersonates Governance Safe only there, and restores the local network afterward. It tests existing live router/token/wrapper behavior, real 24h Timelock and planner ABI encoding; it does **not** certify the completeness of the production retirement list or bypass the CLI's reviewed-manifest gates. The default offline run reports this opt-in integration as pending.

Use the existing incident `ops.mjs` inventory/deploy/plan/simulate/verify commands, now generation-3 aware. Start with `node scripts/incident-2026-09-05/ops.mjs help` and its runbook. Rehearse on a local Hardhat fork with the real Safe/Timelock permissions, not an impersonated Timelock. The old operations tool retains its explicit broadcast option for **new paused component deployment only**; no new live governance execution ability was added. This delivery did not exercise that option.

Run the core `verify` **before** later reward activation: its isolated-state checks deliberately require the listed claimers still to be zero.

## 3. Replace reward managers, still paused

The old managers bind their router immutably. Do not reuse them. The generic `deploy/08_dstake/04_dlend_rewards.ts` now uses fresh SettlementV2 names and is local/test-only; it refuses live deployment. Do not rerun legacy `deploy/31_dstake_dlend_mainnet` setup tags to configure the new generation: those tags target historical names/authority assumptions. The explicit tool below owns the new handoff.

Copy `scripts/followup-2026-09-05/reward-manifest.example.json` outside the repo and fill every required field from verified state. Use the actual **already migrated** generation-3 router. Copy the full retirement inventory and evidence. Set the threshold/fees deliberately, not from example zero values. The deployer must be separate from the administrative/operator/emergency authorities. `expectedNonce` must match its mined and pending nonce with no pending transaction. Deployment identity is versioned; the original name is not overwritten.

For dLEND, specify wrapper, aToken, controller and EmissionManager. For MetaMorpho, change `kind`, specify `metaMorphoVault`, `urd` (zero is allowed) and `rewardAttributionReviewed: true`; independently establish who owns the URD claims/skim recipient and how a new address obtains its entitlement. The tool does not transfer old Merkle entitlements, old balances or skim authority.

```bash
# ETHEREUM_RPC_URL points at the reviewed endpoint; never paste private keys.
node scripts/followup-2026-09-05/reward-ops.mjs plan reviewed-reward.json /secure/path/reward-plan
```

This generates **unsigned** CREATE data and a sequential unsigned deployer role-handoff plan. It verifies source-matched build-info, 0.8.20/viaIR/optimizer-200 settings, runtime and initcode size, core bindings, retired roles, expected nonce, and correct wrapper/controller identities. It does not sign or send anything. Review and simulate the exact constructor and all bootstrap transactions. The manager starts paused in its constructor; bootstrap grants Timelock admin, reviewed configuration operator, emergency/Timelock pause roles, then removes all deployer roles (admin last). Do not authorize the new manager on any adapter or on the collateral vault.

After separately approved deployment and bootstrap:

```bash
node scripts/followup-2026-09-05/reward-ops.mjs activate reviewed-reward.json /secure/path/reward-activation
```

The manager's actual runtime and settings must match its reviewed artifact. All required roles must be present, deployer privileges absent, and the manager/router still paused. For dLEND it outputs a holder-level `setClaimer(collateralVault, newManager)` proposal to the verified authority. If that authority is the Timelock, unsigned schedule/execute Safe payloads are generated; if the governance Safe owns the EmissionManager directly, an unsigned direct Safe payload is generated. Other ownership arrangements fail closed for explicit review. **No unpause is generated.** Aggregate-wrapper claimer remains zero. The tool rejects overwriting an existing different holder claimer.

After the approved claimer transaction executes:

```bash
node scripts/followup-2026-09-05/reward-ops.mjs verify reviewed-reward.json /secure/path/reward-verification
```

This is paused-state verification, not a reopening test. Simulate active-strategy setup and permissionless settlement separately on the pinned fork, including a second real wrapper holder, precollected rewards, zero new emissions, receiver/treasury deltas, underlying reward aliases, manager/router/token pause, cap, Suspended status, and stale router binding. Do not satisfy a claim shortfall by silently sweeping another holder's allocation.

## 4. Separate non-router replacements

These fixes are in the patch but **not** smuggled into the incident router migration. Existing immutable deployments do not change when their Solidity source is edited. Inventory whether each component is deployed and approved before deciding production urgency.

### Curve

Deploy fresh reviewed `CurveLiquiditySwapAdapter`, `CurveRepayAdapter`, `CurveWithdrawSwapAdapter` instances with the original verified addresses-provider, pool, Curve router and governance owner. Use new deployment identities such as `..._ConsentV2`; verify constructor bindings, runtime and ownership. Update UI/SDK/agent configuration to use them. Old user aToken approvals remain on the old address; a new deployment cannot revoke them for users. Coordinate revocation and new approvals, and remove deprecated routes from all interfaces. Positive self-call swaps and flash/nonflash callbacks must be tested against actual supported routes. The local sentinel tests verify early consent, not successful mainnet swaps. No relayer support is added.

### AMO

Use a fresh manager identity such as `..._PermitFixV2` with the **existing** verified oracle, AmoDebtToken, dStable and collateral vault. Do not redeploy/reset AmoDebtToken or debt balances, and do not blindly rerun the generic deploy helper that creates both objects. Clone tolerance, peg deviation, allowed AMO wallets and internal operator roles through reviewed governance; no minter/withdrawer privilege is granted before configuration and deployer retirement are verified.

Review and atomically coordinate the external `AmoDebtToken.AMO_MANAGER_ROLE` and allowlist, dStable MINTER_ROLE, collateral COLLATERAL_WITHDRAWER_ROLE, and any additional live roles, granting the new manager and retiring the old one as authorized. Confirm pre/post debt supply, debt holdings, dStable supply and collateral value are unchanged by the role switch. Test ordinary repayment, valid permit, an already-executed permit, wrong operator, peg/slippage limits and reentrant attempts. The source fix is intentionally only the private implementation split; historical balances are not changed.

### Composite oracle

Deploy the corrected aggregator under a fresh identity such as `RETH_USD_ChainlinkCompositeAggregator_OldestTimestampV2`, using verified existing feed and threshold inputs. Inspect every consumer and its authorized source-update mechanism. The legacy deployment's `func.id`/name is not an upgrade or automatic repointing mechanism. Preserve the old deployment record, propose explicit governed consumer updates, verify source pointers and price values, and test both timestamp orderings plus downstream age policies. There is no oracle proxy upgrade or new per-feed heartbeat policy in this patch.

## 5. Reopening and rollback boundaries

Reopening is a separate governance decision after independent review, size/type/EVM/fork validation, backing/loss reconciliation and external pricing risk review. Safely configure an approved default strategy and its status before attempting reward settlement; the router migrates with all strategies Suspended and no default. A source patch and a quiet actor/watchdog are not reopening criteria. Restore external Curve liquidity last after its pricing risks are addressed.

Before the atomic switch fails/succeeds, standard Timelock cancellation/reproposal rules apply. A failed finish assertion reverts its whole batch. After migration, do not roll back to the unguarded old router merely because a precision or integration test fails; keep isolation and deploy a reviewed correction. New managers' emergency pause is independent, but all remain bound to the verified current router. Never mutate stored shortfall or remove material positions to make migration/reopening pass.
