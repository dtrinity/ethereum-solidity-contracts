# ERC20VestingNFT — Design Notes

## Overview

`ERC20VestingNFT` provides a “soft lock” for dSTAKE: users deposit the ERC20
underlying, receive an ERC721 representing the position, and later exit either
by burning the NFT early or by withdrawing after the vesting period has elapsed.
Once funds are withdrawn at maturity the NFT becomes soul-bound so the program
can track long-term participation.

## Key Mechanics

### Position lifecycle
- **Deposit** – `deposit(amount)` pulls dSTAKE, mints a new NFT (IDs start at 1),
  and stores `VestingPosition { amount, depositTime, matured }`.
- **Pre-vest** – NFTs remain freely transferable and may be redeemed early.
- **Post-vest withdraw** – `withdrawMatured` returns the locked tokens, marks the
  position as `matured = true`, and the NFT becomes non-transferable.
- **Early redemption** – `redeemEarly` burns the NFT, returns funds, and reduces
  `totalDeposited`.

### Exit controls
- `redeemEarly` reverts once the cliff has passed (`VestingAlreadyComplete`),
  while `withdrawMatured` enforces the vesting timestamp (`VestingNotComplete`).
- Matured NFTs persist with metadata for historical programmes; they cannot be
  transferred because the `_update` override reverts `TransferOfMaturedToken`
  whenever both sender and receiver are non-zero.

### Supply management
- `maxTotalSupply` caps cumulative deposits and can be adjusted by the owner.
- `minDepositAmount` prevents dust deposits; `DepositBelowMinimum` guards the
  entry point.
- `depositsEnabled` toggles new deposits without impacting existing positions.

## Implementation Notes

- Inherits OZ `ERC721`, `ERC721Enumerable`, and `ReentrancyGuard`; all external
  flows that move tokens are marked `nonReentrant`.
- Vesting duration and referenced ERC20 are immutable constructor parameters;
  governance cannot shorten the vesting schedule after deployment.
- `_tokenIdCounter` starts at 1 for a cleaner UX and sequential mint order.
- `tokenURI` renders a Base64 SVG showing vesting progress, querying token
  metadata such as amount, symbol, and remaining time.
- `_tokenExists` checks rely on stored position amount rather than `_exists`
  because positions are deleted on early redemption.

## Security & Risk Controls

- Owner powers are limited to toggling deposits and adjusting program-wide
  thresholds (`maxTotalSupply`, `minDepositAmount`); funds always flow back to
  users, never the owner.
- Deposits revert on zero amounts, disabled flag, exceeding the cap, or if the
  contract would overflow `totalDeposited`.
- `safeTransfer` calls ensure ERC20 transfers propagate reverts from non-standard
  tokens.
- Immovable vesting window prevents governance from rug-pulling participants.
- `withdrawMatured` deregisters stake from `totalDeposited` before transferring
  tokens, keeping supply accounting accurate even if ERC20 transfers fail.

## Extension Ideas

- Implement batched deposit or withdrawal helpers to reduce gas for power users.
- Add governance delegation hooks so locked positions retain voting power.
- Expand the on-chain metadata renderer to showcase vesting schedules or
  integrate with external dashboards.

## Program Lifecycle

1. **Deployment** – Configure vesting period, cap, and minimum deposit threshold.
2. **Active phase** – Users deposit dSTAKE and receive transferable NFTs.
3. **Wind-down** – Owner may disable deposits while allowing existing positions
   to complete vesting.
4. **Maturity** – Participants withdraw via `withdrawMatured` or exit early by
   burning their NFT through `redeemEarly`.
