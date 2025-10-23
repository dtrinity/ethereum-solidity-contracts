# Test Ticket: Reward Receiver Griefing

## Objective
Ensure adversarial receivers (burn address, reverting contracts, ERC777 hooks) cannot destroy rewards or corrupt state when `compoundRewards` executes.

## Scope
- `contracts/vaults/dstake/rewards/DStakeRewardManagerDLend.sol`
- Base `RewardClaimable` implementation
- Spec `test/dstake/RewardReceiverGriefing.test.ts`

## Test Outline
1. Deploy reward manager with mock reward tokens and configurable receiver.
2. Case A: receiver = burn address; confirm transaction reverts or reroutes funds to vault.
3. Case B: receiver contract reverts on receive; ensure entire `compoundRewards` reverts atomically with state roll-back.
4. Case C: ERC777-style hook reenters; verify `nonReentrant` guard holds and state unchanged.
5. Fuzz receiver behaviours to confirm `compoundRewards` outcome matches expectations without leaking allowances.

## Fixtures & Tooling
- Mock tokens (ERC20 + ERC777) with instrumentation.
- Receiver harnesses (burn, revert, reenter).
- Coverage of both net reward and treasury fee paths.

## Deliverables
- Regression spec validating each receiver type.
- Optional invariant verifying reward manager balance returns to zero post-compound.

## Progress 2025-10-23
- Scaffolded `test/dstake/RewardReceiverGriefing.test.ts` with failing placeholders for burn, revert, and ERC777 reentry griefing cases.
- Pending: wire up mock receivers, integrate fixture deployments, and assert state/event outcomes plus fuzz coverage.
