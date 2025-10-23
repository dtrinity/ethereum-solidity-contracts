# Test Ticket: Router Shortfall Spoofing

## Objective
Ensure malicious vault/adapters cannot fabricate settlement shortfalls to dilute share pricing or drain router-held liquidity.

## Scope
- `contracts/vaults/dstake/DStakeRouterV2.sol`
- `contracts/vaults/dstake/DStakeTokenV2.sol`
- `test/amo/RouterShortfallSpoof.test.ts` + invariant harness

## Test Outline
1. Deploy router/collateral vault with benign adapter and malicious stub capable of faking shortfalls.
2. Configure `settlementShortfall` via privileged role (impersonate governance) and perform deposit while shortfall active.
3. Assert share minting reverts or mints at expected penalized rate with no windfall to attacker.
4. Clear shortfall and withdraw to confirm accounting consistency.
5. Invariant: fuzz sequences of `recordShortfall`, deposits, `clearShortfall` ensuring `router.totalDebt` == sum of vault debts.

## Fixtures & Tooling
- Mock adapter exposing toggle for `reportShortfall`.
- Role impersonation helper for `CONFIG_MANAGER_ROLE`.
- Foundry/Hardhat invariant harness comparing router/vault totals.

## Deliverables
- Passing spec and invariant.
- Stored reproduction script for ops dry-runs.

## Progress (2025-10-23)
- Added `test/amo/RouterShortfallSpoof.test.ts` to exercise DStakeRouterV2 with TestMintableERC20, DStakeTokenV2, DStakeCollateralVaultV2, and MockAdapterPositiveSlippage.
- Baseline deposit, governance-recorded shortfall impacting previewDeposit, and clearing shortfall checks keep RouterDepositRouted emissions, share balances, and collateral value vs router totals aligned.
- TODO: build invariant fuzz suite to cover alternating shortfall adjustments across multi-vault allocations.
