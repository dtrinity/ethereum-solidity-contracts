# Security and design invariants for implementing agents

These requirements are part of the change, not optional comments to remove when a test fails.

## Keeper mechanism

1. dSTAKE `compoundRewards` is permissionless. A keeper who pays the threshold does not need `REWARDS_MANAGER_ROLE`. That role is for configuration and privileged acquisition operations, not auction execution.
2. The configured contribution is a minimum payment, not an independently priced fair-value quote. Do not invent a price oracle, auction bidding system or profitability restriction under the guise of fixing access control.
3. A contribution creates backing for existing holders, never an sdAsset liability for the keeper. Preserve minimum-payment and treasury-fee semantics, using the protocol's **1,000,000 = 100%** fee scale.
4. Pay rewards only after the underlying contribution has passed the full backing checks. Handle an exchange-asset reward without counting the keeper's own payment as inventory. Reject duplicate reward-token inputs.
5. Concrete dSTAKE managers customize acquisition only. Do not override the final public settlement or final contribution hook. Do not relax the unrelated generic `RewardClaimable` authorization policy.

## Reward ownership and controls

Claim dLEND rewards via StaticAToken's holder accounting, for the collateral vault. Use `getClaimer(collateralVault)`, not a manager authorized for the aggregate wrapper upstream user. An apparently dedicated wrapper is not proof that per-holder indices, cached rewards or public precollection can be skipped. Public precollection and stopped emissions must not strand properly funded accrued rewards. A second independent wrapper holder must retain their complete entitlement.

A RewardsController has one delegated claimer per holder address. Do not independently install competing managers for multiple wrappers sharing the same controller and collateral holder; that would overwrite authority. Resolve that topology explicitly before deployment (a separately reviewed dispatcher/multi-wrapper manager may be needed).

New managers start paused. Emergency pausers may stop, but only the administrative authority may reopen. Both a manager pause and a current-router pause can block compounding. New managers have **no** direct adapter AUTHORIZED_CALLER_ROLE, adapter admin, collateral ROUTER_ROLE or collateral admin. An immutable manager tied to a retired router must not keep using that router's old configuration.

Router migration retirement includes old managers' direct and reauthorization powers, not only old-router permissions. Scan RoleGranted/RoleRevoked history from contract creation and recheck current roles. Include historical adapters and reward claimers. Never confuse revoking REWARDS_MANAGER_ROLE with disabling a legacy permissionless implementation. Historical wrapper-level claims may have created a reward shortfall; changing the manager does not refill or erase it.

## Backing and rounding

Measure the change in the collateral vault's entire strategy position. Agreement among previewed, received and adapter-reported share counts is not economic proof. Retain both the strategy redemption-value and adapter-accounting-value checks, actual input/output balance deltas, and the operation-wide check before issuing outer shares.

The default precision allowance remains one **smallest underlying-token unit**. Authorized configuration while paused can set independent per-strategy and aggregate operation budgets from zero through 16. The hard ceiling is a policy guardrail, not a theorem that all strategies will always fit it. An operation may legitimately fail if its loss exceeds its reviewed budget. Never increase it dynamically with the caller's number of legs, configurable dust, a percentage of input, or a donation-sensitive share price. Repeated legs get one aggregate budget, not N budgets.

For a fixed honest StaticAToken normalized index `r`, depositing `a` mints `floor(a*RAY/r)` shares. A whole-position backing delta can be two units below nominal at r=1.09\*RAY. The deposit-only rounding loss is bounded by `ceil(r/RAY)` under those fixed-index formulas; this is not a general bound for arbitrary ERC4626 wrappers, adapters, withdrawals, rebases or fee-on-transfer assets. Review each supported implementation, current index, withdrawal path, and aggregate route. A two-unit policy at one rate is not a permanent universal setting.

A positive credited amount must have positive added backing even at the maximum allowance. Do not reject every zero-inner-share output blindly: already-owned shares can sometimes receive all the value. Reject insufficient economic backing, not merely a particular share quantity.

These are not independent valuation oracles. A malicious/compromised strategy that lies consistently is outside the guard's trust boundary. The patch does not certify Curve's external NAV price usage.

## Lifecycle and governance

Suspension changes eligibility, not ownership or NAV membership. Retained positions remain supported through a config replacement. A funded omitted strategy must revert. Enforce this in the new router because the currently deployed collateral contract is not replaced by this migration.

An unsolicited tiny share donation must not force material delisting or permanently prevent retirement. `disposeRetiredStrategyDust` is a privileged, paused, explicit transfer of the entire residual share balance to the governance caller only when **both** valuations are at most one underlying base unit, with status Suspended and target zero. Batch disposal and removal in one governance transaction. This limit is independent of the 16-unit accounting ceiling. Record the transfer and recipient. Material write-offs are not implemented: keep such positions in accounting until a separately reviewed resolution exists.

Fresh generation-3 router/modules must match their metadata and source layout. Do not mix them into a deployed generation-1/2 router. This delivery is a replacement-router migration, NOT a proxy upgrade of the router or collateral vault. Do not alter the live share token implementation, wipe shortfall, replace the debt token, or move principal merely to make assertions pass.

## Consent and freshness

A token allowance or permit is not consent to a third party selecting a Curve trade. Authenticate the external user before any side effect; keep pool/initiator callback authentication. Supporting relayers later requires a replay-protected, fully bound signed intent, including beneficiary, assets, quantities, limits, route and deadline. Do not add `tx.origin` shortcuts.

Keep both AMO repayment entries role-gated and nonReentrant. They call the private repayment implementation; never call one guarded external entry from another and never remove the guards to make permit tests pass.

A composite cannot claim to be fresher than its oldest price dependency. Reject zero and future timestamps before age arithmetic. Preserve the existing internal heartbeat policy unless separately reviewed; do not conflate changing the returned timestamp with a full oracle redesign.

## Release enforcement

The offline CI job is deliberately labeled as not EVM validation. Full Solidity compilation, runtime size limits, existing behavior, new EVM tests, fuzzing and pinned-fork governance/settlement are separate release gates. Do not enable unlimited contract size as a workaround: the local Hardhat config currently permits it, but production does not. Move logic into a correctly fingerprinted reviewed module if necessary without bypassing the shared checks. Never convert a failing exact reward assertion into `<=`, a `skip`, an empty catch or a source-text-only proof.
