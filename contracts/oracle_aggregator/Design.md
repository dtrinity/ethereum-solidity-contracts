# Oracle Aggregator V1.1 — Design Notes

## Overview

The V1.1 oracle stack hardens external price ingestion for dTRINITY protocols.
`OracleAggregatorV1_1` acts as the canonical price surface, sourcing data from
specialised wrapper contracts, enforcing heartbeat and deviation thresholds, and
providing guardian-operated circuit breakers. Every wrapper implements the
shared `IOracleWrapperV1_1` interface
(`contracts/oracle_aggregator/interface/IOracleWrapperV1_1.sol:5`) so the
aggregator can reason about prices in a common base currency.

## Component Map

- **Aggregator** – orchestrates primary and fallback wrappers per asset, stores
  last-good prices, and exposes guardian freeze tooling
  (`contracts/oracle_aggregator/OracleAggregatorV1_1.sol:14`).
- **Wrapper base** – `OracleBaseV1_1` defines shared roles, asset config schema,
  and validation helpers used by both the aggregator and wrappers
  (`contracts/oracle_aggregator/OracleBaseV1_1.sol:10`).
- **Chainlink adapters** – `BaseChainlinkWrapperV1_1` normalises Chainlink feeds,
  applies heartbeat, deviation, and min/max clamps, and records last-good prices
  per asset (`contracts/oracle_aggregator/wrapper/BaseChainlinkWrapperV1_1.sol:14`).
  `ChainlinkFeedWrapperV1_1` supplies a thin deployment wrapper
  (`contracts/oracle_aggregator/wrapper/ChainlinkFeedWrapperV1_1.sol:8`), while
  `ChainlinkRateCompositeWrapperV1_1` blends spot and rate feeds (not shown here
  but shares the base).
- **API3 adapter** – integrates API3 proxies with the same heartbeat metadata
  model (`contracts/oracle_aggregator/wrapper/API3WrapperV1_1.sol:1`).
- **Hard peg oracle** – guardian-governed override for pegged assets, enforcing
  upper/lower guard rails (`contracts/oracle_aggregator/wrapper/HardPegOracleWrapperV1_1.sol:1`).

All wrappers emit `PriceData` structures (price, timestamp, liveness flag) that
the aggregator consumes.

## Price Evaluation Flow

1. **Fetch primary wrapper** – aggregator pulls `PriceData` from the configured
   primary wrapper (`contracts/oracle_aggregator/OracleAggregatorV1_1.sol:422`).
   If the wrapper reports `isAlive = true` and passes heartbeat and deviation
   checks, the value is accepted.
2. **Fallback evaluation** – if the primary feed is stale or dead, the
   aggregator queries the fallback wrapper, insisting it shares the same base
   currency (`contracts/oracle_aggregator/OracleAggregatorV1_1.sol:429`).
3. **Last-good price** – when both primary and fallback fail, the aggregator
   returns the stored last-good price (LGP) and flags `isAlive = false`
   (`contracts/oracle_aggregator/OracleAggregatorV1_1.sol:438`). Oracle managers
   can refresh the LGP manually via `updateLastGoodPrice`
   (`contracts/oracle_aggregator/OracleAggregatorV1_1.sol:237`).
4. **Frozen assets** – guardians may freeze an asset, forcing reads to the frozen
   snapshot or to a manually pushed override
   (`contracts/oracle_aggregator/OracleAggregatorV1_1.sol:189`,
   `contracts/oracle_aggregator/OracleAggregatorV1_1.sol:220`).

Every returned price is normalised to the aggregator base unit via wrapper-level
decimals handling (`contracts/oracle_aggregator/wrapper/BaseChainlinkWrapperV1_1.sol:79`).

## Risk Controls

- **Heartbeat + staleness** – each asset tracks heartbeat and max-stale windows;
  wrappers or the aggregator revert when exceeded
  (`contracts/oracle_aggregator/OracleBaseV1_1.sol:97`).
- **Deviation guards** – per-asset basis point deviation gates compare new
  prices against the previous last-good price to avoid sudden jumps
  (`contracts/oracle_aggregator/wrapper/BaseChainlinkWrapperV1_1.sol:112`,
   `contracts/oracle_aggregator/OracleAggregatorV1_1.sol:480`).
- **Bounds clamping** – min/max answers prevent obvious outliers from passing
  into the system (`contracts/oracle_aggregator/OracleBaseV1_1.sol:117`).
- **Primary/fallback separation** – aggregator rejects fallback wrappers that
  point to the same address as the primary feed to avoid circular reads
  (`contracts/oracle_aggregator/OracleAggregatorV1_1.sol:348`).
- **Guardian freeze** – guardians can pause assets, push replacement prices, and
  unfreeze once conditions stabilise
  (`contracts/oracle_aggregator/OracleAggregatorV1_1.sol:189`,
   `contracts/oracle_aggregator/OracleAggregatorV1_1.sol:220`).

## Role Model

- **Admins** – manage role grants and can initiate/accept admin handovers
  (`contracts/oracle_aggregator/OracleAggregatorV1_1.sol:97`).
- **Oracle managers** – wire feeds, adjust thresholds, store last-good prices,
  and configure fallbacks (`contracts/oracle_aggregator/OracleAggregatorV1_1.sol:143`).
- **Guardians** – freeze/unfreeze assets, push frozen prices, and trigger
  last-good price circuits (`contracts/oracle_aggregator/OracleAggregatorV1_1.sol:189`,
  `contracts/oracle_aggregator/OracleAggregatorV1_1.sol:220`,
  `contracts/oracle_aggregator/OracleAggregatorV1_1.sol:237`).

Wrappers inherit the same role set from `OracleBaseV1_1`, enabling dedicated
operator accounts per provider.

## Integration Notes

- Downstream contracts (e.g., dStable’s issuer and redeemer) should depend on
  the aggregator’s `getAssetPrice` and treat `isAlive = false` as a failure.
- When onboarding a new asset:
  1. Deploy or configure a wrapper with heartbeat/threshold parameters.
  2. Register it on the aggregator with optional fallback and deviation bounds.
  3. Store an initial last-good price once the feed has proven stable.
- For pegged assets, prefer the hard peg wrapper and delegate guardian accounts
  to maintain frozen prices during oracle outages.
