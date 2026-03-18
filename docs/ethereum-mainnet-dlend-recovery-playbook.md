# Ethereum Mainnet dLEND Recovery Playbook

This document turns the March 17, 2026 recovery kit into repo-native operator steps for Ethereum mainnet.

## Goals

- preserve the current incident state
- prevent a fresh borrow loop while selectively reopening only what is necessary
- repay the attacker's dUSD variable debt from the recovery wallet
- verify that reopening dUSD redemptions does not silently reopen the exploit path

## Key Rules

- Keep `cbBTC` paused until the accounting path is patched or the market is migrated/reset.
- Do not rely on `frozen` to disable flash loans. In this fork, flash loans are blocked by `paused` or `flashLoanEnabled = false`.
- Treat economic repair and exploit neutralization as separate tasks.
- Use private submission / bundle relays for the Safe batch and the repay transaction.

## Repository Entry Points

- Operator read/check scripts:
  - `scripts/recovery/preflight-checks.ts`
  - `scripts/recovery/repay-attacker-variable-debt.ts`
  - `scripts/recovery/assert-post-repay.ts`
- Safe batch generation:
  - `deploy/32_dlend_recovery_mainnet/00_preflight_ethereum_mainnet_dlend_recovery_safe.ts`
  - `deploy/32_dlend_recovery_mainnet/01_prepare_ethereum_mainnet_dlend_recovery_safe.ts`

## Suggested Sequence

### Phase 0. Snapshot the live state

Run:

```bash
npx tsx scripts/recovery/preflight-checks.ts
```

Recommended env:

```bash
export RPC_URL='https://ethereum-rpc.publicnode.com'
export ATTACKER='0xbA5E1E36b0305772D35509c694782fB9118D4ecc'
export RESERVES_JSON='["0x07fFf99e1664d9B116fbC158c0E99785F81cA236","0x8236a87084f8B84306f72007F36F2618A5634494","0x2260FAC5E5542a773Aa44fBCfeDf7C193bc2C599","0xcbB7C0000aB88B473b1f5aFd9ef808440eed33Bf","0x45804880De22913dAFE09f4980848ECE6EcbAf78","0xac3E018457B222d93114458476f3E3416Abbe38F","0xcf62F905562626CfcDD2261162a51fd02Fc9c5b6"]'
```

Record at minimum:

- reserve flags
- liquidity index
- aToken total supply
- attacker dUSD variable debt
- attacker account data
- any reserve that is low-supply and still flash-loan-enabled

### Phase 1. Generate the Safe batch

This repo-native flow uses Hardhat Deploy plus `GovernanceExecutor`.

Set the reserve list that should enter recovery-safe mode:

```bash
export USE_SAFE='true'
export RECOVERY_RESERVES_JSON='["0x07fFf99e1664d9B116fbC158c0E99785F81cA236","0xb419EcDd222981E7E54cEc316797eCb799c6AFdC","0xC02aaA39b223FE8D0A0e5C4F27eAD9083C756Cc2","0x7f39C581F595B53c5cb19bD0b3f8dA6c935E2Ca0","0xae78736Cd615f374D3085123A210448E74Fc6393","0x9D39A5DE30e57443BfF2A8307A4256c8797A3497","0xa3931d71877C0E7a3148CB7Eb4463524FEc27fbD","0x80ac24aa929eaf5013f6436cda2a7ba190f5cc0b","0x356B8d89c1e1239Cbbb9dE4815c39A1474d5BA7D"]'
export RECOVERY_SET_CBBTC_LTV_ZERO='true'
```

Then run:

```bash
npx hardhat deploy --network ethereum_mainnet --tags setup-ethereum-mainnet-dlend-recovery-safe
```

The batch follows this ordering:

- disable stable-rate borrowing
- disable borrowing
- disable flash loans
- freeze
- unpause

Populate `RECOVERY_RESERVES_JSON` from the live preflight output, not from stale incident notes. As of March 18, 2026, the read-only snapshot still flags `dETH`, `WETH`, `wstETH`, `rETH`, `sUSDe`, `sUSDS`, `syrupUSDC`, and `syrupUSDT` as unpaused low-supply reserves with flash loans enabled, so they need explicit handling before Phase 3 can pass.

For `cbBTC`, the batch instead:

- keeps it paused
- disables flash loans
- disables borrowing
- freezes it if needed
- optionally sets `LTV = 0` while preserving liquidation threshold and bonus

### Phase 2. Repay the attacker's dUSD variable debt

Prerequisites:

- `dUSD` unpaused
- `dUSD` frozen
- `dUSD` borrowing disabled
- `dUSD` flash loans disabled
- `cbBTC` still paused

Run:

```bash
export PRIVATE_KEY='0x...'
npx tsx scripts/recovery/repay-attacker-variable-debt.ts
```

The script uses the on-behalf-of repay pattern:

- approve `MaxUint256`
- call `repay(dUSD, MaxUint256 - 1, 2, attacker)`

This avoids depending on a stale off-chain debt read.

### Phase 3. Move all remaining non-cbBTC paused markets into frozen mode

After the bad debt is repaid, the next operational step is to restore orderly withdrawals, repayments, and liquidations on every non-`cbBTC` market that is still fully paused.

The repo now defaults this phase to:

- discover every reserve that is currently `paused`
- exclude `cbBTC`
- exclude `dUSD` because it was already brought live in Phase 1
- disable flash loans if still enabled
- disable borrowing and stable borrowing if still enabled
- freeze the reserve
- unpause the reserve

Use the packaged command if you want this default "all remaining paused non-cbBTC reserves" behavior:

```bash
export PK_MAINNET_DEPLOYER='0x...'
yarn recovery:safe:phase2:all-paused:preflight
yarn recovery:safe:phase2:all-paused:batch
```

The `all-paused` commands set `PHASE2_ALLOW_LOW_SUPPLY_RESERVES=true` intentionally, because the remaining paused markets are thin and the point of this phase is to move them into an explicitly safer `unpaused + frozen + flash-loans-disabled` posture.

If you need a custom subset instead, provide `PHASE2_UNPAUSE_RESERVES_JSON` and use the base `recovery:safe:phase2:*` commands.

### Phase 4. Assert the post-phase-2 state

Run:

```bash
npx tsx scripts/recovery/assert-post-repay.ts
```

The assertion pass checks:

- attacker dUSD variable debt is zero
- attacker borrow capacity is zero or explicitly tolerated
- `cbBTC` remains paused
- `dUSD` is unpaused but frozen with borrowing and flash loans disabled
- every non-`cbBTC` reserve is unpaused and frozen unless you intentionally provide a smaller `PHASE2_UNPAUSE_RESERVES_JSON` set
- no unpaused reserve is both low-supply and flash-loan-enabled

## Failure Modes

- Unpausing a reserve before disabling flash loans
- Repaying debt before eliminating future borrow paths
- Unpausing `cbBTC` before the accounting path is patched
- Treating restored dUSD solvency as equivalent to root-cause resolution

## Notes

- These scripts intentionally separate operational repair from protocol patching.
- Full closure still requires code-level hardening or a market migration/reset for `cbBTC`.
