# dStable — Design Notes

## Overview

dStable is the dTRINITY collateralised stablecoin stack. The system pairs an
upgradeable ERC20 (`contracts/dstable/ERC20StablecoinUpgradeable.sol:1`) with
issuer, redeemer, and AMO controllers that enforce collateral backing and allow
governance to route supply into strategy vaults. All components share one price
oracle interface (`contracts/dstable/OracleAware.sol:1`) so collateral balances
and mint/redemption quotes are computed in a common base currency.

## Core Components

- **Token layer** – `ERC20StablecoinUpgradeable` exposes mint, burn, permit, and
  flash-mint hooks behind `MINTER_ROLE`/`PAUSER_ROLE` gates while keeping name
  and symbol mutable post-deployment (`contracts/dstable/ERC20StablecoinUpgradeable.sol:14`).
- **Collateral vaults** – `CollateralVault` is the abstract base that tracks the
  allowlisted collateral set and handles value translation using the oracle
  (`contracts/dstable/CollateralVault.sol:33`). `CollateralHolderVault`
  implements a passive custody vault with collateral-to-collateral swaps for
  rebalancing (`contracts/dstable/CollateralHolderVault.sol:21`).
- **Issuer** – `IssuerV2_2` accepts supported collateral, mints dStable, and
  enforces that aggregate collateral value remains greater than or equal to the
  global dStable supply (`contracts/dstable/IssuerV2_2.sol`). It supports
  asset-level mint pauses and “excess collateral” issuance for incentive
  programs without special-casing AMO balances.
- **Redeemer** – `RedeemerV2` burns dStable in exchange for collateral pulled
  from the vault and applies configurable default/per-asset fees
  (`contracts/dstable/RedeemerV2.sol:31`). It shares the same oracle and pause
  controls as the issuer.
- **AMO management** – `AmoManagerV2` co-ordinates individual AMO vaults, tracks
  their allocated supply via the transfer-restricted `AmoDebtToken`
  (`contracts/dstable/AmoDebtToken.sol:19`), and lets operators shuttle
  collateral back to the main vault when strategies unwind. Unified accounting
  enables atomic mint/burn flows and peg deviation safeguards
  (`contracts/dstable/AmoManagerV2.sol:24`).

## Minting Workflow

1. Caller approves collateral and invokes `IssuerV2_2.issue`
   (`contracts/dstable/IssuerV2_2.sol`).
2. The contract checks the asset is supported and not paused, values it through
   the oracle, and computes the dStable to mint using `baseValueToDstableAmount`
   (`contracts/dstable/IssuerV2_2.sol`).
3. Collateral moves directly into the `CollateralVault`, while newly minted
   dStable is sent to the caller (`contracts/dstable/IssuerV2_2.sol`).
4. The issuer enforces a system-wide invariant: total dStable supply must never
   exceed the collateral’s base value (`contracts/dstable/IssuerV2_2.sol`).

## Redemption Workflow

1. Users call `RedeemerV2.redeem` with dStable, target collateral, and minimum
   acceptable payout (`contracts/dstable/RedeemerV2.sol:97`).
2. The redeemer verifies the asset is supported and not paused, converts the
   requested dStable amount into base value, and then into collateral units using
  the vault (`contracts/dstable/RedeemerV2.sol:123`).
3. Default or per-asset fees are calculated in collateral terms; fee proceeds
   route to `feeReceiver` (`contracts/dstable/RedeemerV2.sol:131`).
4. dStable is burned after transfer-in, and net collateral is withdrawn to the
   caller (`contracts/dstable/RedeemerV2.sol:158`).
5. Governance-controlled roles may trigger `redeemAsProtocol` for fee-free
   exits when rebalancing reserves (`contracts/dstable/RedeemerV2.sol:152`).

## AMO Operations

- `AmoManagerV2` mints dStable into allowlisted AMO wallets via
  `increaseAmoSupply` while issuing matching `AmoDebtToken` receipts to the
  collateral vault, then retires the allocation with `decreaseAmoSupply`
  (`contracts/dstable/AmoManagerV2.sol`).
- Collateral strategies borrow value from the vault through `borrowTo` and
  must return equivalent base value with `repayFrom`; both paths enforce vault
  invariants and operator allowlists.
- Peg deviation guards halt AMO actions if oracle prices drift beyond
  `pegDeviationBps`, preventing supply expansion while assets are off-peg.

## Oracle Integration

All contracts inherit from `OracleAware`, which stores the shared oracle address,
base unit, and admin setter (`contracts/dstable/OracleAware.sol:17`). Value
conversions use the oracle directly:

- `CollateralVault.assetValueFromAmount` converts balances into base currency
  (`contracts/dstable/CollateralVault.sol:150`).
- Issuer and redeemer translate between base value and dStable via
  `baseValueToDstableAmount`/`dstableAmountToBaseValue`
  (`contracts/dstable/IssuerV2_2.sol`, `contracts/dstable/RedeemerV2.sol:188`).

Swapping or disabling collateral requires oracle support; attempts to allow a
token without a live price revert (`contracts/dstable/CollateralVault.sol:176`).

## Role Model

- **Token** – `DEFAULT_ADMIN_ROLE`, `PAUSER_ROLE`, `MINTER_ROLE`
  (`contracts/dstable/ERC20StablecoinUpgradeable.sol:20`).
- **Issuer** – `DEFAULT_ADMIN_ROLE`, `INCENTIVES_MANAGER_ROLE`,
  `PAUSER_ROLE` (`contracts/dstable/IssuerV2_2.sol`).
- **Redeemer** – `DEFAULT_ADMIN_ROLE`, `REDEMPTION_MANAGER_ROLE`, `PAUSER_ROLE`
  (`contracts/dstable/RedeemerV2.sol:57`).
- **Vaults** – `COLLATERAL_MANAGER_ROLE`, `COLLATERAL_WITHDRAWER_ROLE`,
  `COLLATERAL_STRATEGY_ROLE` across `CollateralVault`
  (`contracts/dstable/CollateralVault.sol:48`).
- **AMO managers** – `DEFAULT_ADMIN_ROLE`, `AMO_INCREASE_ROLE`,
  `AMO_DECREASE_ROLE` with allowlisted wallet/ vault controls
  (`contracts/dstable/AmoManagerV2.sol:60`).

## Invariants & Risk Controls

- Total dStable supply must remain ≤ collateral value; `IssuerV2_2` compares the
  vault’s base valuation against the global supply to enforce the invariant on
  each issuance (`contracts/dstable/IssuerV2_2.sol`).
- Asset-level minting and redemption pauses allow surgical responses to collateral
  incidents without halting the entire system
  (`contracts/dstable/IssuerV2_2.sol`, `contracts/dstable/RedeemerV2.sol:210`).
- AMO mint/burn operations enforce symmetric debt adjustments bounded by a
  tolerance to absorb rounding (`contracts/dstable/AmoManagerV2.sol:84`).
- Foundry invariant coverage (`foundry/test/dstable/AmoManagerV2Invariant.t.sol`)
  simulates oracle shocks, guardian pauses, and AMO allocation churn to confirm
  `AmoManagerV2` debt supply mirrors wallet allocations and peg guards halt
  inflationary increases.
- Oracle heartbeat, min/max answers, and deviation checks propagate through
  every value conversion by relying on the shared oracle contract.

## Operational Notes

- Adding new collateral: configure the oracle feed, call `allowCollateral`, then
  enable minting/redemption as needed (`contracts/dstable/CollateralVault.sol:167`).
- Incentive programs mint dStable using `issueUsingExcessCollateral`, which caps
  issuance by current excess collateral (`contracts/dstable/IssuerV2_2.sol`).
- AMO vault rotations: managed directly via `AmoManagerV2.borrowTo` and
  `AmoManagerV2.repayFrom` with invariant checks to preserve vault value
  (`contracts/dstable/AmoManagerV2.sol`).
