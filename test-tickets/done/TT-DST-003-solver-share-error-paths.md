# Test Ticket: dSTAKE Solver Share/Error Paths

## Objective
Exercise router solver entrypoints (`solverDepositShares`, `solverWithdrawShares`, collateral exchange helpers) against real adapters to ensure share preview math, vault status gating, and error bubbling behave as documented.

## Scope
- `contracts/vaults/dstake/DStakeRouterV2.sol`
- Adapter preview/convert implementations under `contracts/vaults/dstake/adapters/*`
- Hardhat suite (e.g., `test/dstake/SolverRoutes.test.ts`)

## Why This Matters
Operations relies on solver routes to migrate capital and service power users, but our tests never invoke those externally facing methods—only ERC4626 deposit/withdraw is covered. Foundry fuzzing uses permissive mocks, so we still lack proof that the real router:
- Respects `minShares`/`maxLoss` constraints.
- Stops routing into Suspended/Impaired vaults mid-call.
- Surfaces adapter reverts via the documented custom errors.
Missing coverage could let a regression mint/burn the wrong number of shares or silently skip vaults during live rebalances.

## Test Plan
1. **Happy Path Share Deposits**
   - Using the existing fixture, call `solverDepositShares` into multiple vaults with pre-minted strategy shares.
   - Verify `previewDepositShares` matches minted ERC4626 shares, router events fire, and vault balances shift exactly as requested.
2. **Failure Modes**
   - Flip a vault to Suspended mid-test and assert solver calls targeting it revert with `VaultNotActive`.
   - Force adapter `withdraw` to revert (e.g., set mock to fail) and ensure router surfaces the revert + leaves other vault balances untouched.
   - Provide `minShares` larger than preview → expect `SlippageCheckFailed`.
3. **Max Loss Enforcement**
   - Simulate NAV loss during withdrawal and ensure `solverWithdrawAssets` respects `maxLossBps`, reverting when exceeded.
4. **Collateral Exchange Helpers**
   - Invoke `exchangeCollateralAssets` to swap between two strategy shares.
   - Assert conversion uses adapter previews, respects `minAmountOut`, and emits `Exchanged`.
5. **Event & Role Checks**
   - Confirm only `SOLVER_ROLE` (or designated role) may call solver functions; unauthorized signer should revert.

## Deliverables
- Comprehensive Hardhat tests covering deposit/withdraw/exchange solver paths and associated error cases.
- Fixture tweaks enabling deterministic adapter failure toggles.
- Updated docs (ticket notes) describing commands: `yarn hardhat test test/dstake/SolverRoutes.test.ts`.

## Acceptance Criteria
- Tests fail today (router methods unused) and pass once assertions are implemented.
- Each failure points to the exact solver method/regression.
- Coverage includes both assets- and shares-based solver flows plus collateral exchanges.
