# Test Ticket: dSTAKE Router Share Accounting Fuzz

## Objective
Stress the dSTAKE router through random deposits, withdrawals, rebalances, shortfall adjustments, and fee reinvestments to ensure share supply tracks total NAV precisely.

## Scope
- `contracts/vaults/dstake/DStakeRouterV2.sol`
- `contracts/vaults/dstake/DStakeTokenV2.sol`
- `contracts/vaults/dstake/DStakeCollateralVaultV2.sol`
- Invariant test `test/fuzz/dstake/RouterShareAccountingInvariant.t.sol`

## Progress 2025-10-23
- Scaffolded `test/fuzz/dstake/RouterShareAccountingInvariant.t.sol` with placeholder setup, action generators, and invariant checks mirroring TT-FUZZ-001 structure.
- Remaining work: connect real strategy adapters, swap placeholder accounting helper for live NAV tracking, and register the harness with the fuzz runner.
- Planned command once wiring lands: `forge test --match-path test/fuzz/dstake/RouterShareAccountingInvariant.t.sol`

## Fuzz Plan
1. Deploy router + collateral vault with multiple strategy adapters (honest mock) and reward manager hooks.
2. Randomly select actions per iteration:
   - User deposit/withdraw with varying amounts and recipients.
   - Strategy rebalance (move shares between adapters).
   - `recordShortfall` / `clearShortfall` toggles.
   - Treasury fee reinvestment and reward compounding events.
3. Maintain tracker computing expected NAV = router-held assets + adapter NAV - shortfall.
4. Invariant: `totalSupply == expectedNAV.convertToShares()` within defined rounding tolerance. Confirm no negative allocations or missing approvals.
5. Verify events emitted and router pause flags behave when liquidity depleted.

## Fixtures & Tooling
- Adapter mocks exposing configurable share price and dust behaviour.
- Accounting helper to sum balances across router, vault, and adapters.
- Snapshot/replay utilities to capture failing seeds.

## Deliverables
- Passing fuzz/invariant test with documented tolerance.
- Short write-up on any coverage gaps or required monitoring metrics.
