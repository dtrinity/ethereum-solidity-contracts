# RewardClaimable Vaults — Design Notes

## Overview

Contracts under `contracts/vaults/rewards_claimable/` provide a reusable
framework for harvesting third-party incentives, applying protocol fees, and
forwarding net rewards to end users. The abstract `RewardClaimable` contract
supplies shared accounting, access control, and safety checks so concrete reward
managers only implement protocol-specific integrations.

## Core Abstractions

### RewardClaimable (`RewardClaimable.sol`)
- Inherits `AccessControl` and `ReentrancyGuard`; there is no Ownable shim.
- Configuration state:
  - `treasury`, `treasuryFeeBps`, `exchangeThreshold`.
  - Immutable `exchangeAsset` used for compounding and `maxTreasuryFeeBps`
    (hard ceiling on fee configuration).
- Events:
  - `TreasuryUpdated`, `TreasuryFeeBpsUpdated`, `ExchangeThresholdUpdated`,
    `RewardCompounded`.
- Access surface:
  - `DEFAULT_ADMIN_ROLE` manages role assignment.
  - `REWARDS_MANAGER_ROLE` updates treasury details, thresholds, and is required
    to call the base `compoundRewards`.
- `compoundRewards` (manager-gated by default) performs:
  1. Parameter validation (amount ≥ threshold, non-empty token list, receiver
     not zero).
  2. Transfer of `exchangeAsset` from the caller.
  3. Event emission before external calls.
  4. `_claimRewards` hook to pull protocol rewards.
  5. Inline fee calculation and distribution for each `rewardToken`. If a reward
     token equals `exchangeAsset`, the function isolates the freshly-claimed
     portion so the caller’s contribution is not double-counted.
  6. `_processExchangeAssetDeposit` hook to let descendants move the user-supplied
     `exchangeAsset` into downstream strategy vaults.
- Abstract hooks to implement in subclasses:
  - `_claimRewards(address[] calldata rewardTokens, address receiver)` must
    return claimed reward amounts aligned with the input list.
  - `_processExchangeAssetDeposit(uint256 amount)` handles post-claim use of the
    caller-supplied `exchangeAsset`.

### Patterns for Derived Managers
- Implement `_claimRewards` to call the upstream rewards controller(s) and return
  the per-token amounts actually received.
- Implement `_processExchangeAssetDeposit` to route the user’s contribution into
  strategy positions (or no-op when unused).
- Optionally override `compoundRewards` to adjust ordering or permissions
  (e.g., make settlement permissionless); any override should retain the guard
  conditions, event emission, fee accounting, and reentrancy protection defined
  by the base contract.

## Workflow: `compoundRewards`

1. **Validate input** – Enforces `amount >= exchangeThreshold`,
   `rewardTokens.length > 0`, and non-zero receiver.
2. **Receive funds** – Pulls `exchangeAsset` from `msg.sender` using SafeERC20.
3. **Emit telemetry** – `RewardCompounded(exchangeAsset, amount, rewardTokens)`
   fires prior to external calls for easier monitoring.
4. **Claim rewards** – `_claimRewards` retrieves protocol rewards into the
   provided receiver and returns claimed amounts.
5. **Distribute fees** – For each reward token, calculates basis-point fee via
   `getTreasuryFee`, checks it does not exceed the reward amount, transfers the
   fee to `treasury`, and forwards the remainder to the receiver.
6. **Deploy caller capital** – `_processExchangeAssetDeposit` is invoked last so
   derived contracts can compound or otherwise handle the supplied `exchangeAsset`.

## Role Model

- `DEFAULT_ADMIN_ROLE` – manages role grants/revocations and can bootstrap
  initial managers.
- `REWARDS_MANAGER_ROLE` – required for `setTreasury`, `setTreasuryFeeBps`,
  `setExchangeThreshold`, and the base `compoundRewards` flow.
- Additional roles may be introduced by descendants to govern external
  dependencies or to open settlement to automation addresses.

## Risk Controls

- `maxTreasuryFeeBps` caps fees at or below 100% and guards against
  misconfiguration.
- `exchangeThreshold` blocks uneconomic compounding attempts and prevents dust
  accumulations.
- `nonReentrant` wrapping protects the full workflow, including downstream hook
  overrides.
- Extensive input validation errors (`ZeroReceiverAddress`, `ZeroRewardTokens`,
  `RewardAmountsLengthMismatch`, etc.) make hook implementations easier to audit.
- Fee math uses `Math.mulDiv` for deterministic rounding and reverts if the
  computed fee would exceed the reward amount.

## Integration Notes

- Set `treasury` and `treasuryFeeBps` immediately after deployment; both revert
  on zero addresses or fees above the configured ceiling.
- Monitoring should listen to `RewardCompounded` plus the follow-up reward
  transfers to reconcile treasury inflows and beneficiary payouts.
- When `exchangeAsset` matches one of the claimed reward tokens, the base logic
  automatically separates user-supplied capital from fresh rewards—off-chain
  automation should account for this behaviour.

## Extension Guidelines

- Override `_processExchangeAssetDeposit` to convert `exchangeAsset` into vault
  positions, ensuring allowances get reset if approvals are used.
- When exposing permissionless settlement, keep the validation and event order
  from the base class to maintain consistent monitoring semantics.
- Derived contracts should document any additional roles or assumptions (e.g.,
  required adapter registry configuration) alongside this base design note.
