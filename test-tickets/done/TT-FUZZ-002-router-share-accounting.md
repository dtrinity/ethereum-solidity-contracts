# Test Ticket: dSTAKE Router Share Accounting Fuzz

## Objective
Stress the dSTAKE router through random deposits, withdrawals, rebalances, shortfall adjustments, and fee reinvestments to ensure share supply tracks total NAV precisely.

## Scope
- `contracts/vaults/dstake/DStakeRouterV2.sol`
- `contracts/vaults/dstake/DStakeTokenV2.sol`
- `contracts/vaults/dstake/DStakeCollateralVaultV2.sol`
- Invariant test `foundry/test/dstake/RouterShareAccountingInvariant.t.sol`

## Progress 2025-10-24
- Implemented the invariant in Foundry at `foundry/test/dstake/RouterShareAccountingInvariant.t.sol` with a mintable dStable, mock dStake token, invariant collateral vault, deterministic adapter, and full `DStakeRouterV2`.
- Added reusable invariant helpers (router vault, adapter, tokens) under `foundry/test/utils/`.
- Command: `forge test --match-path foundry/test/dstake/RouterShareAccountingInvariant.t.sol`

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
- ✅ Passing invariant suite with deterministic adapter + shortfall/fee exercises.
- 🔜 Optional follow-ups: add multi-vault scenarios, rebalance permutations, and adapter dust edge cases if needed.
