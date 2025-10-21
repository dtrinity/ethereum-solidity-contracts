# Oracle Aggregator V1.1 Stack

The V1.1 release introduces a hardened oracle stack centred around `OracleAggregatorV1_1`
and a refreshed suite of wrappers. Key components include:

- `OracleAggregatorV1_1` – central registry of per-asset configuration with last good price
  caching, guardian driven freeze/LGP flow, fallback orchestration and deviation gating.
- `ChainlinkFeedWrapperV1_1` – canonical Chainlink adapter with heartbeat overrides,
  min/max clamps and optional rate-of-change detection.
- `API3WrapperV1_1` – API3 proxy integration with heartbeat metadata respect and
  configurable bounds.
- `ChainlinkRateCompositeWrapperV1_1` – combines a Chainlink spot feed with an external
  rate provider to deliver composite prices with per-leg liveness checks.
- `HardPegOracleWrapperV1_1` – guardian governed peg with guard-rails and manual
  overrides for hard-pegged assets.

Operational roles:

- **Admins** manage role assignments via a two-step handover.
- **Oracle Managers** update feeds, thresholds, and oracle wiring.
- **Guardians** can freeze assets, push last good prices, and unfreeze once conditions
  normalise.

## Existing considerations

### Why don't we have a generic CompositeOracleWrapper which allows us to composite feeds from different oracle providers?
There is risk in surfacing a partially desynced oracle feed. If we decide to mix and match,
we should do a thorough risk analysis first.
