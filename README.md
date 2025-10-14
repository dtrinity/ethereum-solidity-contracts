# dTRINITY Ethereum Contracts

This repository contains the code and tooling for dTRINITY on Ethereum.

Website: https://dtrinity.org/

Documentation: https://docs.dtrinity.org/

## Oracle Aggregator V1.1

The repository now includes the safety-focused oracle stack (`contracts/oracle_aggregator/*V1_1.sol`).
It introduces:

- `OracleAggregatorV1_1` with per-asset configuration, last-good-price caching, guardian freeze flows,
  and granular events for all threshold/heartbeat updates.
- New wrappers (`ChainlinkFeedWrapperV1_1`, `API3WrapperV1_1`, `ChainlinkRateCompositeWrapperV1_1`,
  `HardPegOracleWrapperV1_1`) sharing a common `OracleBaseV1_1` foundation and extended validation helpers.
- Expanded test coverage under `test/oracle_aggregator/OracleAggregatorV1_1.test.ts` demonstrating stale data rejection,
  deviation gating, guardian interventions, fallback routing, and wrapper-specific integrity checks.
