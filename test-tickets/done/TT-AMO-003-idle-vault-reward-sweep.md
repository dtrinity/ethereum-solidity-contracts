# Test Ticket: Idle Vault Reward Sweep

## Objective
Guarantee that accrued rewards remain with treasury even when idle vault supply hits zero, preventing first-depositor snipes.

## Scope
- `contracts/vaults/dstake/vaults/DStakeIdleVault.sol`
- Reward manager funding flows impacting idle vault
- Spec `test/amo/IdleVaultRewardSweep.test.ts`

## Test Outline
1. Deploy idle vault with reward manager mock that accrues tokens while no shares exist.
2. Simulate reward funding period followed by single wei deposit and immediate withdrawal.
3. Assert depositor receives only proportional share, treasury retains accrued rewards.
4. Repeat with keeper-triggered sweep to ensure no rewards leak.
5. Invariant: fuzz reward accrual cadence vs sweep frequency verifying treasury balance >= expected payouts.

## Fixtures & Tooling
- Mock reward token (ERC20) with mint hooks.
- Keeper harness calling sweep functions.
- Accounting helper comparing expected vs actual reserves.

## Deliverables
- Deterministic regression test covering zero-supply edge.
- Invariant helper verifying long-run treasury balance.

## Progress 2025-10-23
- Authored `test/amo/IdleVaultRewardSweep.test.ts` exercising sentinel-withdraw sweeps and multi-interval keeper cadence checks against `DStakeIdleVault`.
- Built in emission-rate tolerances so depositor balances stay flat despite block-timestamp rounding while asserting treasury captures every accrued wei.
- Ran `yarn hardhat test test/amo/IdleVaultRewardSweep.test.ts`.
