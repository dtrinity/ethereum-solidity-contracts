# Test Ticket: ERC20VestingNFT Lifecycle Invariant Suite

## Objective
Introduce Foundry property tests for `ERC20VestingNFT` that cover deposit caps, minimums, early redemption, maturity withdrawals, and the non-transferability rule for matured NFTs to ensure vesting programs cannot lose track of locked dSTAKE.

## Scope
- `contracts/vaults/vesting/ERC20VestingNFT.sol`
- Any helper libraries it depends on (ERC721Enumerable, ReentrancyGuard)
- New harness in `foundry/test/vesting/` (e.g., `ERC20VestingNFTInvariant.t.sol`)

## Why This Matters
The Design doc (`contracts/vaults/vesting/Design.md:8-80`) highlights critical guarantees:
- Total deposited tokens never exceed `maxTotalSupply`.
- Matured NFTs become soulbound; transfers must revert.
- Early redemptions burn NFTs and decrement `totalDeposited`.
No automated suite enforces these invariants today, so regressions in future upgrades could permanently lock user funds or re-open transferability of matured positions.

## Test Plan
1. **Fixture**
   - Deploy ERC20 mock for dSTAKE, mint to fuzz actors, and instantiate `ERC20VestingNFT` with a realistic vesting duration/cap/minimum.
   - Track token IDs and associated position metadata inside the harness for assertions.
2. **Action Set**
   - Random `deposit(amount)` bounded by `minDepositAmount`/`maxTotalSupply`.
   - `redeemEarly(tokenId)` when cliff not yet reached.
   - Warp time forward to trigger `withdrawMatured`.
   - Attempt ERC721 transfers (`safeTransferFrom`) for both pre-vest and post-vest NFTs.
   - Owner operations: toggle `depositsEnabled`, adjust `maxTotalSupply`, `minDepositAmount`.
3. **Invariants**
   - `totalDeposited` equals sum of active positions’ `amount`.
   - Matured positions (`matured == true`) cannot be transferred; any transfer attempt must revert.
   - Deposits never exceed `maxTotalSupply`; harness should expect revert otherwise.
   - Once redeemed early or withdrawn, NFT state is cleared (no double-withdrawals).
4. **Edge Cases**
   - Multiple deposits per user, interleaved early exits.
   - Owner lowering `maxTotalSupply` below current deposits (should revert).
   - Ensure `minDepositAmount` enforcement doesn’t block redemptions.

## Deliverables
- New Foundry invariant contract + helper tracking library for position sums.
- Wiring into `make test.foundry`.
- Optional doc snippet summarizing coverage under `contracts/vaults/vesting/Design.md`.

## Acceptance Criteria
- Suite reliably catches manual regressions (e.g., comment out soulbound check) by failing within a few sequences.
- Runtime ≤15s to keep foundry suite lean.
- Clear revert messages for each invariant breach to streamline debugging.
