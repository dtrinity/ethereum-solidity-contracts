# DStakeRewardManagerDLend — Design Notes

## Overview

`DStakeRewardManagerDLend` automates compounding for dLEND rewards earned by a
designated Static AToken wrapper. It inherits `RewardClaimable`, reusing shared
fee logic and configuration, while customising how exchange assets are routed
into dSTAKE strategies and how protocol rewards are harvested. Unlike the base
implementation, its `compoundRewards` entry point is permissionless so keepers
can service positions without holding privileged roles.

## Component Map

- **DStakeCollateralVaultV2 (`IDStakeCollateralVaultV2`)** – Custodies strategy
  shares and exposes the canonical `dStable` address. Adapters mint strategy
  shares directly to this vault.
- **DStakeRouterV2** – Discovers the default deposit strategy share and its
  registered `IDStableConversionAdapterV2`.
- **IDLendRewardsController** – Aave/dLEND controller from which emissions are
  claimed via `claimRewardsOnBehalf`; requires wrapper-level `setClaimer`
  approval.
- **targetStaticATokenWrapper** – The address whose rewards are harvested.
- **dLendAssetToClaimFor** – The underlying aToken tracked by the rewards
  controller.
- **exchangeAsset** – The dStable token contributed by callers for compounding.
- **treasury** – Receives the configurable protocol fee taken from each reward
  distribution.
- **Access control** – Reuses `DEFAULT_ADMIN_ROLE` and `REWARDS_MANAGER_ROLE`
  from `RewardClaimable`; no new roles are introduced.

## Workflow

1. **Validate input** – Enforces the inherited guards for `compoundRewards` (`amount >= exchangeThreshold`,
   non-zero `receiver`, non-empty `rewardTokens`). The override keeps the base
   revert reasons but removes the role check to allow permissionless calls.
2. **Collect exchange asset** – Pulls `amount` of `exchangeAsset` from the caller.
3. **Establish wrapper exposure** – `_processExchangeAssetDeposit` (overridden)
   runs *before* rewards are claimed: it looks up the router’s default strategy,
   approves the live adapter, and calls `depositIntoStrategy`. The adapter must
   mint strategy shares to the collateral vault; an `ExchangeAssetProcessed`
   event documents the conversion.
4. **Emit telemetry** – `RewardCompounded(exchangeAsset, amount, rewardTokens)`
   fires prior to external reward pulls for consistent monitoring.
5. **Claim rewards** – `_claimRewards` loops through `rewardTokens`, calling
   `claimRewardsOnBehalf` with `type(uint256).max` for each token and tracking
   the delta in balances.
6. **Distribute proceeds** – For every claimed amount, computes the treasury fee
   via `getTreasuryFee`, transfers the fee to `treasury`, and forwards the net
   amount to the caller-provided `receiver`. Distribution happens inline; no
   helper mirrors the now-removed `_processRewards`.

## Role Model

- `DEFAULT_ADMIN_ROLE` – Updates core wiring (dLEND controller, router) and
  manages role grants.
- `REWARDS_MANAGER_ROLE` – Retains control of treasury metadata and thresholds
  through inherited setters but is **not** required for `compoundRewards`.

## Risk Controls

- Thresholds, fee ceilings, and `nonReentrant` enforcement are inherited from
  `RewardClaimable`.
- Adapter interactions use `forceApprove` followed by explicit zero resets to
  avoid lingering allowances.
- Strategy share mismatches or adapter misconfiguration revert with bespoke
  errors (`AdapterReturnedUnexpectedAsset`, `AdapterNotSetForDefaultAsset`),
  preventing silent misroutes.
- Reward claiming validates token addresses and rejects zero receivers, keeping
  calldata well-formed for the Aave contracts.

## Integration Notes

- Ensure the Static AToken wrapper calls
  `setClaimer(targetStaticATokenWrapper, address(manager))` on the live
  `RewardsController` before automation attempts to harvest.
- Configure the router’s default deposit strategy and adapter; the manager reuses
  whatever mapping is current at call time.
- Keep `REWARDS_MANAGER_ROLE` on operations or treasury multisigs so thresholds
  can be tuned without redeploying.
- Monitoring should watch `RewardCompounded`, `ExchangeAssetProcessed`, and the
  outbound reward transfers to reconcile treasury income versus caller receipts.

## Assumptions

- Aave/dLEND maintains the behaviour of `claimRewardsOnBehalf` and continues to
  settle emissions into the receiver supplied by this contract.
- Registered adapters are trusted to convert dStable into the correct strategy
  share and to transfer minted shares directly to `DStakeCollateralVaultV2`.
- dStable, reward tokens, and strategy shares behave as standard ERC20 tokens;
  non-standard hooks may require additional wrapper logic.
