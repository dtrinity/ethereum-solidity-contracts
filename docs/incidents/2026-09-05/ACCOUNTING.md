# Backing conservation: implementation and boundaries

## Source basis

The remediation pack identifies nominal outer credit versus insufficient inner
backing as the leading hypothesis. It does not demonstrate a profitable completed
exploit. This change is a source-level correction and a guarded migration path,
not a claim that an observed exploit has been reproduced or all potential losses
have been reconciled.

## Enforced invariants

Let `C` be the collateral vault, `R` the router, `v` the strategy, and `x` the
underlying assets routed. Immediately around each strategy operation, record:

```
B = asset.balanceOf(R)
Q = v.balanceOf(C)
V = v.previewRedeem(Q), or 0 when Q == 0
N = adapter.strategyShareValueInDStable(v, Q), or 0 when Q == 0
```

`V` is the strategy-side redemption quote for the whole position; `N` is the
adapter-side NAV actually used by protocol accounting. Keeping both checks means
an adapter's inflated report cannot alone excuse a loss visible in the strategy's
redemption quote. This is **not independent of the strategy implementation**.
A malicious or misleading strategy can still lie about `V` and `N` together.

A successful strategy deposit requires:

```
B_before - B_after == x
actual new strategy shares == adapter-reported new shares
actual new strategy shares >= previewed new shares
V_after > V_before and V_after - V_before >= x - 1
N_after > N_before and N_after - N_before >= x - 1
```

The inequalities are evaluated with overflow-safe subtraction. A one-unit deposit
with zero added backing fails: the tolerance is never permission to issue claims
for nothing. It is ONE raw underlying unit (one wei for an 18-decimal dUSD), not
one dUSD, one share, a basis-point allowance, or configurable dust. Fee-on-transfer
underlyings, material strategy entry/exit fees, and more lossy integrations fail
closed rather than silently dilute existing holders.

For ordinary deposit/mint and both solver deposit routes, an additional check
requires the aggregate managed-asset increase to cover the full nominal input
within the same one-unit bound. This stops a long route or repeated vault entries
from multiplying a per-leg tolerance. Every leg also has its own check, so a
healthy strategy cannot subsidize a bad leg.

A successful withdrawal requires an actual positive increase in `R`'s underlying
balance, exactly matching the adapter's return. Any decrease in each whole-position
valuation must be no greater than those received assets plus one raw unit. Both
solver withdrawal operations also check aggregate managed value _before_ the
customer payout; this bounds cumulative multi-leg rounding loss. Existing router
cash cannot masquerade as new withdrawal proceeds.

Reinvestments and governance sweeps use the guarded deposit primitive. Rebalance
withdrawals and deposits both use the same primitives; a wrapper-level aggregate
check limits net loss across the rebalance to one raw unit. Caller min-out checks
remain separate. The external-liquidity-named path now shares the guarded core;
its former dust-based exception to caller minimum shares is removed. A dust no-op
cannot satisfy a nonzero minimum.

## Zero new shares is not the invariant

When `C` already owns strategy shares, underlying sent into that strategy can
increase the value of its existing shares without issuing another integer share.
The guard accepts this only when the full collateral-owned position gains enough
backing. It does not credit appreciation belonging to outside strategy holders.
For an empty `C` position that remains empty, both position valuations remain zero
and a positive nominal outer deposit necessarily fails.

## Withdrawal payout correction

`handleWithdraw` formerly passed all net proceeds back even when share rounding
redeemed more than the amount priced into the user's burn. It now returns exactly
the expected net amount, after confirming sufficient real receipts. Surplus stays
in the router, included in managed assets and available to the existing fee-
reinvestment path. This matches the solver paths' capped-payout behavior. Fee
settings and shortfall semantics are otherwise unchanged.

## Pause and module compatibility

The replacement pauses in its constructor. Ordinary/solver flows were already
pause-gated; privileged sweeps and rebalances now are too. Old deployed bytecode
is NOT changed by this source patch. Governance cannot assume an old router's
privileged paths acquire these pause checks without migration.

`STORAGE_FINGERPRINT` advances to
`dtrinity.dstake.router.v2.storage:2:backing-conservation`. No storage fields move
or are appended. The generation change intentionally rejects the earlier modules,
whose independent sweep/rebalance implementations would bypass the new primitive.
Deploy both modules from the same build as the replacement.

## Why IdleVault is not changed in this emergency patch

The supplied IdleVault is constructor-based. Changing its source would not alter
the deployed vault. Replacing it also involves existing shares, reserved rewards,
emission schedules and possible value transfer between old and new holders.
Neither changing decimal offsets on existing shares nor ignoring existing raw
balances is a safe in-place accounting edit.

This migration retains its valuation entry and holdings but leaves it Suspended,
along with all other strategies. It does not delist a nonzero position or pretend
`targetBps == 0` closes explicit solver access. `depositCap == 0` remains unlimited.
A dedicated donation-neutral Idle replacement can be reviewed separately; the
outer router must retain these guards regardless of that future choice.

## Residual risks and release prerequisites

These guards do not supply independent strategy oracles, recover existing losses,
remove counterparty risk, prove immediate withdrawal liquidity, cure every
read-only reentrancy possibility, or certify external Curve pricing. Donation-
sensitive strategy quotes can still affect `sdUSD.totalAssets()` even while the
router is paused. Restoring secondary-market liquidity therefore needs separate
exchange-rate manipulation analysis and fork tests; merely passing this migration
is insufficient.

The one-unit bound may reject operations that previously succeeded, especially
very small deposits or real wrappers with more than one unit of round-trip
rounding. That is a deliberate fail-closed tradeoff, not a reason to silently raise
an economic tolerance. Test real strategy amounts at the incident block and the
proposed execution block. If a strategy cannot satisfy the invariant, keep it
isolated or design an explicitly reviewed credit-from-measured-backing route.

Public references informing these distinctions (not evidence of this incident):

- ERC-4626 specification and preview/oracle cautions: https://eips.ethereum.org/EIPS/eip-4626
- OpenZeppelin ERC-4626 implementation interface: https://docs.openzeppelin.com/contracts/5.x/api/token/erc20#ERC4626

## Prescriptions for future changes

Do not remove the whole-position check because previews agree. Do not substitute
`previewRedeem(newShares)` for a before/after full-position delta. Do not allow
configurable dust or percentage slippage to relax nominal outer credit. Do not
add direct adapter deposit/withdraw calls outside `StrategyBackingGuard`. Do not
remove aggregate checks or the standard-withdrawal payout cap. Do not reuse old
modules, reset shortfall, drop valued holdings, or treat a pause as reopening
approval. Run the source guardrails plus real integration/fuzz/fork tests whenever
adding a strategy route. Mocks must model the production ERC-4626 valuation
interface; do not weaken checks to accommodate an unrealistic plain-ERC20 mock.
