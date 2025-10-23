# Test Ticket: Dust Tolerance DoS

## Objective
Validate that dust threshold adjustments cannot freeze withdrawals or strand collateral via pathological share rounding.

## Scope
- `contracts/vaults/dstake/DStakeRouterV2.sol`
- `contracts/vaults/dstake/DStakeTokenV2.sol`
- Spec `test/amo/DustToleranceDos.test.ts`

## Test Outline
1. Deploy router + collateral vault with configurable `dustTolerance`.
2. Execute deposits/withdrawals around threshold (±1 wei) and ensure operations complete.
3. Raise `dustTolerance` via governance impersonation; verify withdrawals still succeed or fail with intentional error message.
4. Stress-test multiple strategies to ensure queue draining and event emissions remain consistent.
5. Fuzz harness covering random tolerance changes and partial liquidity ensuring no stuck funds.

## Fixtures & Tooling
- Token mock with adjustable decimals to hit rounding edges.
- Governance helper for `setDustTolerance`.
- State snapshot utility logging residual balances and pause flags.

## Deliverables
- Passing regression + fuzz tests.
- Report summarizing tolerated ranges and monitoring guidelines.
