# Test Ticket: Oracle Fallback Deviation Trap

## Objective
Cover the scenario where the primary oracle feed exceeds `maxDeviationBps`, forcing the aggregator to fall back to a stale price. Ensure downstream consumers (IssuerV2, RedeemerV2) revert and monitoring hooks fire.

## Scope
- `contracts/oracle_aggregator/OracleAggregatorV1_1.sol`
- dStable issuer/redeemer paths relying on `getAssetPrice`
- Hardhat test harness under `test/oracles/FallbackDeviationTrap.test.ts`

## Test Outline
1. Deploy aggregator with `MockAggregatorV3` primary and HardPeg fallback.
2. Configure deviation/heartbeat thresholds per production defaults.
3. Drive primary price down > `maxDeviationBps`, keep fallback at prior peg.
4. Assert:
   - `getAssetPrice` reports `usedFallback = true`.
   - `IssuerV2.issue` and `RedeemerV2.redeem` revert with stale-price reason.
   - `FallbackTriggered` (or equivalent) event emitted once.
5. Restore primary price within bounds and confirm normal operations resume.

## Fixtures & Tooling
- Hardhat local network with deterministic block timestamps.
- Helper library to impersonate guardian for config updates.
- Optional fork-test variant using real deployment config.

## Deliverables
- Passing spec under `test/oracles/FallbackDeviationTrap.test.ts`.
- Script or assertion ensuring `usedFallback` state is observable for monitoring.
- Summary notes in PR linking to this ticket.

## Progress 2025-10-23
- Added `test/oracles/FallbackDeviationTrap.test.ts` covering primary deviation into the HardPeg fallback path and recovery back to the Chainlink feed.
- Pending IssuerV2/RedeemerV2 revert assertions until fallback gating is enforced in those flows.
- Environment reminder: `MNEMONIC_TESTNET_DEPLOYER is not set in the .env file`, `No private keys found for ethereum_testnet in the .env file`, `MNEMONIC_MAINNET_DEPLOYER is not set in the .env file`, `No private keys found for ethereum_mainnet in the .env file`.
