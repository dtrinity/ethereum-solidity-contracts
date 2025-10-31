# Oracle Aggregator V1.1 — Design Notes

## Overview

`OracleAggregatorV1_1` exposes a minimal on-chain price surface. Each asset is
mapped to a single wrapper that implements the shared
`IOracleWrapperV1_1` interface
(`contracts/oracle_aggregator/interface/IOracleWrapperV1_1.sol`). The aggregator
holds only two pieces of state: the common base currency (address + unit) and
the asset → wrapper routing table. There is no fallback routing, last-good price
storage, or guardian circuit breaker. Liveness and sanity checks are delegated
to the individual wrappers.

## Component Map

- **Aggregator** – maintains the asset → wrapper mapping and enforces base
  currency compatibility before updating routes
  (`contracts/oracle_aggregator/OracleAggregatorV1_1.sol`).
- **API3 wrappers** – normalise API3 proxy data and optionally apply
  thresholding (`contracts/oracle_aggregator/wrapper/API3WrapperV1_1.sol`,
  `.../API3WrapperWithThresholdingV1_1.sol`,
  `.../API3CompositeWrapperWithThresholdingV1_1.sol`).
- **Redstone Chainlink-style wrappers** – read Chainlink-compatible feeds,
  convert to the aggregator base unit, and support optional thresholding or
  composite pricing (`contracts/oracle_aggregator/wrapper/RedstoneChainlink*.sol`).
- **Hard peg wrapper** – returns a constructor-set price for assets that should
  always trade at a fixed peg (`contracts/oracle_aggregator/wrapper/HardPegOracleWrapperV1_1.sol`).

All wrappers inherit from small base contracts that expose an
`ORACLE_MANAGER_ROLE` used to configure feeds, proxies, threshold parameters, or
heartbeat stale windows.

## Price Evaluation Flow

1. The aggregator loads the wrapper configured for the requested asset.
2. It calls `getPriceInfo(asset)` on the wrapper. Wrappers return the price in
   the aggregator base unit together with an `isAlive` flag that reflects their
   internal heartbeat checks.
3. If `isAlive` is `false` the aggregator reverts with `PriceNotAlive`. When
   healthy, `getAssetPrice(asset)` returns the reported price.

Wrappers are responsible for all heartbeat, threshold, and decimal conversion
logic. The aggregator only verifies that the wrapper reports the same base
currency and base unit that it was initialised with.

## Roles

- **Aggregator** – `DEFAULT_ADMIN_ROLE` manages grants, while
  `ORACLE_MANAGER_ROLE` can `setOracle`/`removeOracle` for assets.
- **Wrappers** – inherit OZ `AccessControl`, granting deployer both
  `DEFAULT_ADMIN_ROLE` and `ORACLE_MANAGER_ROLE`. Operators use the manager role
  to add feeds, adjust thresholds, or tweak the heartbeat stale window.

## Integration Notes

1. Deploy the wrapper with the desired base currency and unit.
2. Configure feeds or proxies via the wrapper’s `ORACLE_MANAGER_ROLE`.
3. (Optional) adjust `setHeartbeatStaleTimeLimit` to tune the staleness buffer.
4. Call `setOracle(asset, wrapperAddress)` on the aggregator from an account
   holding the aggregator’s `ORACLE_MANAGER_ROLE`.
5. For pegged assets, deploy a dedicated `HardPegOracleWrapperV1_1` and route
   the asset to that wrapper.

With the stateless aggregator design, governance focuses on wrapper deployment
and configuration while the aggregator simply enforces compatibility and routes
calls at runtime.
