# Test Ticket: Oracle Heartbeat Drag

## Objective
Validate that stale oracle data beyond the configured heartbeat forces consumer contracts to halt price-dependent flows and emits observability signals.

## Scope
- `contracts/oracle_aggregator/OracleAggregatorV1_1.sol`
- `contracts/dstable/IssuerV2.sol` and `RedeemerV2.sol`
- Spec file `test/oracles/HeartbeatDrag.test.ts`

## Test Outline
1. Deploy aggregator, issuer, redeemer with mock feeds returning fixed price.
2. Advance block timestamp beyond `maxStaleTime` while leaving price unchanged.
3. Assert:
   - `getAssetPrice` returns `isAlive = false`.
   - Issuer/redeemer calls revert with expected stale-price error.
   - Heartbeat breach event emitted for monitoring.
4. Guardian refreshes price (mock wrapper update) inside heartbeat; verify normal operation resumes.

## Fixtures & Tooling
- Time manipulation helper (Hardhat `helpers.time.increase`).
- Mock wrapper exposing manual `pushPrice` with timestamps.
- Optional cron-emulation script checking `block.timestamp - updatedAt`.

## Deliverables
- Deterministic test covering stale window breach and recovery.
- Documentation of emitted events/metrics needed for ops dashboards.

## Progress 2025-10-23
- Added `test/oracles/HeartbeatDrag.test.ts` to exercise stale primary-feed flows on `OracleAggregatorV1_1`, covering heartbeat drag detection and recovery on fresh updates.
- Confirmed `getPriceInfo` flips `isAlive` to `false` once `heartbeat + maxStaleTime` elapses and that `getAssetPrice` reverts with `PriceNotAlive`; TODO coverage for Issuer/Redeemer remains.
- Environment blockers: `.env` currently reports `MNEMONIC_TESTNET_DEPLOYER is not set`, `No private keys found for ethereum_testnet`, `MNEMONIC_MAINNET_DEPLOYER is not set`, and `No private keys found for ethereum_mainnet`.
