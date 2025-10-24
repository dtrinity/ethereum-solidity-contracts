# Test Ticket: Multi-Collateral Redemption Fee Invariant

## Objective
Fuzz multi-collateral issue/redeem flows to make sure treasury fees, per-asset liquidity caps, and oracle conversions never let the system leak value or under-collateralise dSTABLE. This extends the existing AMO invariant to the high-risk redemption path with diverse collateral decimals and price shocks.

## Scope
- `contracts/dstable/RedeemerV2.sol`
- `contracts/dstable/IssuerV2.sol`
- `contracts/dstable/CollateralHolderVault.sol`
- `contracts/common/WithdrawalFeeMath.sol`
- Reuse `foundry/test/utils/MockPriceOracle.sol` + add helpers for collateral registration
- New Forge file: `foundry/test/dstable/MultiCollateralRedemptionInvariant.t.sol`

## Motivation
Real deployments juggle USDC (6 decimals), USDT (6), DAI (18), and potentially lower-liquidity assets. Fee tiers, withdrawal caps, and oracle deviations can interact in surprising ways. We currently only fuzz a single collateral path, so cross-asset rounding bugs or fee overflows could sneak in.

## Harness Sketch
1. Deploy issuer, redeemer, collateral vault, and oracle.
2. Register 3+ collateral tokens with varying decimals and configurable price feeds (mock oracle).
3. Configure withdrawal fee schedule (basis-point tiers) and collateral-specific withdrawal caps.
4. Fuzz operations:
   - `issue()` in random collateral proportions (respecting caps).
   - `redeem()` choosing random destination collateral + amount.
   - Toggle withdrawal fee, cap, and pause flags through authorised roles.
   - Perturb oracle prices within safe ranges, including downward shocks.
   - Trigger treasury sweeps (`redeemer.claimFees`) intermittently.

## Invariants
- `issuer.circulatingDstable()` never drops below total collateral value minus accrued fees (converted to base unit).
- Treasury fee accumulator equals the sum of per-redeem fee skims (no lossy rounding).
- Per-collateral balances never underflow; withdrawals respect caps and pauses even under rapid price moves.
- Redemption emits expected base value within ±1 wei when re-priced through the oracle.
- AMO supply stays synced: allocations + vault balances equal issuer’s recorded collateralisation.

## Edge Cases To Hit
- Switching target collateral mid-run while prices diverge.
- Zero-fee tier vs. max-fee tier transitions.
- Large oracle price drops causing cap hit mid redemption.
- Redeems that completely drain a collateral asset (ensure fallback asset selection or revert path holds).
- Treasury sweep during ongoing fuzz run (post-sweep invariants still hold).

## Deliverables
- Passing Forge invariant with seed logging on failure.
- Utilities for multi-decimal collateral minted under `foundry/test/utils/`.
- Documentation snippet describing how to toggle collateral sets/prices when replaying counterexamples.
