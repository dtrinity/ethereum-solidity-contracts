# Test Ticket: dSTAKE Shortfall & Fee Recycling Previews

## Objective
Cover the interaction between router shortfall accounting, withdrawal fee accrual, and ERC4626 previews so we can detect regressions where share price fails to reflect deficits or reinvestments.

## Scope
- `contracts/vaults/dstake/DStakeRouterV2.sol`
- `contracts/vaults/dstake/DStakeTokenV2.sol`
- Fee + shortfall helpers inside router
- New Hardhat specs under `test/dstake/` (e.g., `ShortfallAndFeeAccounting.test.ts`)

## Why This Matters
The router manages settlement shortfall and fee reinvestment (Design §“Manage fees” / “Offboard a strategy”), but no test touches `recordShortfall`, `clearShortfall`, `reinvestFees`, `sweepSurplus`, or `reinvestIncentive`. The Forge invariants only assert NAV relationships in aggregate; they never assert user previews respond to shortfalls or that reinvested fees goose share price. Without deterministic tests, a bad refactor could silently overpay exiting users or leak incentive rewards.

## Test Plan
1. **Shortfall vs Previews**
   - Deposit via ERC4626, record a manual shortfall (`router.recordShortfall`).
   - Assert `previewRedeem`, `maxWithdraw`, and `totalAssets` reflect the net NAV (supply minus shortfall) and withdrawals revert if the router cannot meet `expectedNet`.
   - Clear the shortfall and ensure previews bounce back.
2. **Withdrawal Fee Accumulation**
   - Set a non-zero withdrawal fee, execute a withdrawal, and assert router-held balance increases by the fee amount while user receives `netAssets`.
   - Check share price does not immediately drop (fees remain inside router).
3. **Reinvest & Incentive Path**
   - Set `reinvestIncentive`, fund the router with idle dStable, and call `reinvestFees` from a fee claimer.
   - Assert:
     - Incentive recipient receives the configured cut.
     - Router dust drops below `dustTolerance` after `sweepSurplus`.
     - `totalAssets()` increases for all shareholders (compare before/after previews).
4. **Edge Cases**
   - Attempt to reinvest when a deposit cap is saturated → expect noop.
   - Verify `sweepSurplus` respects caller-provided max amount and doesn’t underflow when balance < request.

## Deliverables
- Purpose-built Hardhat tests implementing scenarios above.
- Helper utilities for minting dStable to router/fee claimer as needed.
- Documentation snippet in the ticket update describing expected preview deltas.

## Acceptance Criteria
- Tests fail prior to adding coverage (due to missing assertions) and pass after adding the new suite.
- Each assertion ties to either ERC4626 preview expectations or router fee/shortfall state.
- Commands: `yarn hardhat test test/dstake/ShortfallAndFeeAccounting.test.ts`.
