# Test Ticket: Exchange Asset Dust Sweep

## Objective
Prove that exchange-asset dust cannot be siphoned through reward token configuration and always resets to zero after compounding.

## Scope
- `contracts/vaults/rewards_claimable/RewardClaimable.sol`
- `contracts/vaults/dstake/rewards/DStakeRewardManagerDLend.sol`
- Spec `test/dstake/RewardExchangeDust.test.ts`

## Test Outline
1. Seed reward manager with uneven `exchangeAsset` amounts creating rounding dust.
2. Include `exchangeAsset` in reward token list and call `compoundRewards`.
3. Assert:
   - All exchange-asset balance returns to collateral vault/treasury.
   - Keeper receives only expected payout, not dust windfall.
   - Repeated compounding (100+ iterations) leaves residual balance ≤ 1 wei.
4. Introduce malicious reward ordering to verify dust handling is order-independent.

## Fixtures & Tooling
- Mock ERC20 supporting custom decimals/rounding.
- Loop helper executing multiple compound cycles.
- Snapshot utility logging balances before/after.

## Deliverables
- Regression test verifying dust round-trip.
- Optional fuzz harness covering random reward sets.
