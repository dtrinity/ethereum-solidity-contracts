# Oracle Aggregator V1.1 Stack

The slimmed-down V1.1 stack keeps the aggregator stateless and moves most
oracle logic into small, provider-specific wrappers:

- `OracleAggregatorV1_1` – routes assets to wrappers and enforces base currency
  compatibility. No fallback routing, guardian flow, or last-good price store.
- `API3WrapperV1_1` (+ threshold and composite variants) – reads API3 proxies,
  normalises to the aggregator base unit, and optionally applies thresholding
  to cap drawdowns when the feed decays towards a peg.
- `RedstoneChainlinkWrapperV1_1` (+ threshold and composite variants) – consumes
  Chainlink-compatible feeds, converts decimals, and carries the heartbeat
  policies defined in the wrapper base contracts.
- `HardPegOracleWrapperV1_1` – returns a constructor-set value for assets that
  should always trade at the configured peg.

Every wrapper inherits from a lightweight base contract that exposes
`DEFAULT_ADMIN_ROLE` and `ORACLE_MANAGER_ROLE`. Operators use the manager role to
register feeds, proxies, and optional threshold parameters, or to adjust the
heartbeat stale time limit.

## Integration Checklist

1. Deploy the wrapper with the same base currency and unit as the target
   aggregator.
2. Configure feeds/proxies via the wrapper’s `ORACLE_MANAGER_ROLE`.
3. Optionally tune the heartbeat buffer with `setHeartbeatStaleTimeLimit`.
4. Call `setOracle(asset, wrapperAddress)` on the aggregator.

This design keeps the aggregator simple while preserving the ability to enforce
provider-specific safety rails inside the wrappers themselves.
