# Test Ticket: Adapter Float Theft

## Objective
Verify reward managers zero allowances and observe vault balance changes so malicious adapters cannot siphon compounding float.

## Scope
- `contracts/vaults/dstake/rewards/DStakeRewardManagerDLend.sol`
- Adapter interface `IDStableConversionAdapterV2`
- Spec `test/dstake/RewardAdapterFloatTheft.test.ts`

## Test Outline
1. Deploy reward manager with malicious adapter that `transferFrom`s funds without returning shares.
2. Invoke `compoundRewards`; expect revert before allowances consumed or assets lost.
3. Confirm `forceApprove` resets allowance to zero even on revert paths.
4. Add positive case with honest adapter to ensure regression coverage.
5. Optional invariant validating collateral vault balance delta matches adapter-reported shares.

## Fixtures & Tooling
- Malicious adapter mock returning fabricated `strategyShare`.
- Collateral vault harness exposing balance snapshots.
- Event assertions for `ExchangeAssetProcessed`.

## Deliverables
- Regression spec covering malicious + honest adapters.
- Written guidance for monitoring share deltas post-compound.

## Progress 2025-10-23
- Scaffolded `test/dstake/RewardAdapterFloatTheft.test.ts` with failing placeholders for malicious theft and honest regression cases.
- Pending: implement malicious adapter mock, add explicit allowance reset assertions, and verify vault balance deltas.
