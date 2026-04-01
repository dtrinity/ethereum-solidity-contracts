# Ethereum Mainnet dLEND Collateral Rollout

This document describes the repo-native rollout flow for new dLEND collateral markets on Ethereum mainnet.

The rollout is intentionally split into two phases:

1. **init + stage**: initialize the reserve and immediately force it into a safe non-live posture.
2. **atomic enable**: enable collateral / borrowing / flash-loan features only after the market has been seeded above an explicit aToken floor.

This flow is built around `AtomicMarketListingHelper` and is the expected path for all new dLEND market listings.

## Why this flow exists

The dLEND incident and the Aave-family research on dust-supply / liquidity-index inflation show that the dangerous window is the period where a reserve is initialized or can be reduced to very low live supply while fee-accrual paths such as flash loans are still enabled. The rollout therefore makes the reserve safe first, then requires an explicit, seeded, atomic enable step.

## Hard Rules

- Never run these mainnet rollout flows with `--reset`.
- Never skip the staged posture and go straight to live collateral configuration.
- Never re-enable flash loans for a newly listed market unless you have explicitly acknowledged that choice and the broader accounting path has been remediated.
- Treat the aToken seed floor as a hard precondition, not an operator suggestion.

## New Helper

- Contract: `contracts/dlend/core/deployments/AtomicMarketListingHelper.sol`
- Deploy ID: `AtomicMarketListingHelper`
- Deployment script: `deploy/03_dlend/03_market/02_pool_configurator.ts`

The helper provides three owner-only entry points:

- `initAndStageReserves(pool, configurator, inputs)`
- `stageReserves(pool, configurator, inputs)`
- `enableReserves(pool, configurator, inputs)`

### Staged posture

A staged reserve is deliberately **non-live**:

- collateral disabled (`LTV = 0`, `liquidationThreshold = 0`, `liquidationBonus = 0`)
- borrowing disabled
- stable borrowing disabled
- flash loans disabled
- borrow cap forced to `0`
- borrowable-in-isolation forced to `false`
- final `debtCeiling` preconfigured while the reserve is still seedless
- reserve left `active + unpaused + unfrozen` so it can be seeded safely

### Atomic enable gate

The enable step refuses to proceed unless:

- the reserve is still in the staged posture
- the reserve is active and unpaused
- `aToken.totalSupply()` is at or above the explicit `minATokenSupply` value passed for that reserve
- any nonzero `debtCeiling` was already staged before that seed supply existed

## Mainnet Script Order

### 0. Preflight

```bash
USE_SAFE=true npx hardhat deploy --network ethereum_mainnet --tags setup-ethereum-mainnet-new-listings-preflight
```

Checks include:

- required deployments exist
- Safe governance configuration exists
- helper ownership is correct
- oracle rollout artifacts exist
- Safe can grant the helper listing roles

### 1. Safe role grants

```bash
USE_SAFE=true npx hardhat deploy --network ethereum_mainnet --tags setup-ethereum-mainnet-new-listings-role-grants-safe
USE_SAFE=true npx hardhat deploy --network ethereum_mainnet --tags setup-ethereum-mainnet-collateral-reserves-grant-risk-admin-safe
```

The staged rollout temporarily grants:

- `ASSET_LISTING_ADMIN_ROLE` to `AtomicMarketListingHelper`
- `RISK_ADMIN_ROLE` to `AtomicMarketListingHelper`

### 2. Oracle rollout

Run the oracle setup batches first.

Relevant scripts:

- `deploy/30_dlend_new_listings/01_setup_ethereum_mainnet_collateral_oracles_safe.ts`
- `deploy/30_dlend_new_listings/04_setup_ethereum_mainnet_eth_oracles_safe.ts`

### 3. Init + stage batches

Batch 1:

```bash
USE_SAFE=true npx hardhat deploy --network ethereum_mainnet --tags setup-ethereum-mainnet-collateral-reserves-safe
```

Batch 2:

```bash
USE_SAFE=true npx hardhat deploy --network ethereum_mainnet --tags setup-ethereum-mainnet-collateral-reserves-init-batch-2-safe
```

These scripts:

- initialize reserves that do not yet exist on-chain
- stage already-initialized reserves that are still seedless / non-live
- refuse to mutate a reserve that already has live-market features and non-zero aToken supply

### 4. Seed staged markets

After the staged batches are executed on-chain, seed each reserve with real liquidity before enabling it.

The enable step expects raw aToken units, so examples are:

- `1` whole 18-decimal token → `1000000000000000000`
- `1` whole 8-decimal BTC token → `100000000`

Choose reserve-specific floors that are materially above dust.

### 5. Atomic enable batch

The enable batch is intentionally explicit.

Required env:

```bash
export NEW_LISTINGS_ENABLE_ACK='true'
export NEW_LISTINGS_SEED_ACK='true'
export NEW_LISTINGS_MONITORING_ACK='true'
export NEW_LISTINGS_ENABLE_SYMBOLS_JSON='["WETH","wstETH"]'
export NEW_LISTINGS_MIN_ATOKEN_SUPPLY_JSON='{"WETH":"1000000000000000000","wstETH":"1000000000000000000"}'
```

Optional:

```bash
export NEW_LISTINGS_ALLOW_FLASHLOANS='true'
```

Then run:

```bash
USE_SAFE=true npx hardhat deploy --network ethereum_mainnet --tags setup-ethereum-mainnet-collateral-reserves-config-safe
```

### 6. Revoke helper roles

```bash
USE_SAFE=true npx hardhat deploy --network ethereum_mainnet --tags setup-ethereum-mainnet-collateral-reserves-revoke-risk-admin-safe
```

This cleanup step revokes listing roles from the atomic helper and also strips any lingering listing roles from the legacy `ReservesSetupHelper`.

## Flash-loan default

The atomic enable script forces `flashLoanEnabled = false` unless:

```bash
export NEW_LISTINGS_ALLOW_FLASHLOANS='true'
```

That override exists because the current exploit class is specifically tied to thin-supply reserves plus fee-accrual paths. New listings should default to **no flash loans** until the broader accounting path has been remediated and reviewed.

## Safety Notes

- `AtomicMarketListingHelper` reduces the dangerous init-to-enable window, but it does **not** fix the underlying exploit class by itself.
- Seeding a market is necessary, but it is not a substitute for protocol-level accounting hardening.
- If a market has already been made live outside this flow, do not try to force it back through the stage script. Review it manually.
