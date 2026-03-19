# Ethereum Mainnet dLEND Repay Usage

Use this after the recovery governance transaction has already put `dUSD` and `cbBTC` into the required pre-repay state.

## What the script does

- checks the current `dUSD` and `cbBTC` reserve flags
- reads the attacker's current variable `dUSD` debt
- checks the payer wallet `dUSD` balance and allowance
- approves the Pool if needed
- calls `Pool.repay(dUSD, amount, 2, attacker)`
- prints the post-repay debt and account data

## Dry run first

```bash
cd ethereum-solidity-contracts
export PRIVATE_KEY='0x...'
yarn recovery:repay:dry-run
```

This does not send transactions. It prints:

- payer address
- attacker address
- current debt
- payer `dUSD` balance
- current allowance
- whether an approval tx will be needed

To dry-run a partial repay, pass `REPAY_AMOUNT` in human-readable `dUSD` units:

```bash
cd ethereum-solidity-contracts
export PRIVATE_KEY='0x...'
REPAY_AMOUNT=1000 yarn recovery:repay:dry-run
```

## Execute the repay

```bash
cd ethereum-solidity-contracts
export PRIVATE_KEY='0x...'
yarn recovery:repay
```

To execute a partial repay:

```bash
cd ethereum-solidity-contracts
export PRIVATE_KEY='0x...'
REPAY_AMOUNT=1000 yarn recovery:repay
```

## Required environment

- `PRIVATE_KEY`

Optional overrides if needed:

- `RPC_URL`
- `POOL`
- `DUSD`
- `CBBTC`
- `ATTACKER`
- `REPAY_AMOUNT` (optional, human-readable `dUSD` amount such as `1000` or `0.5`)

Defaults in the script already point to the current Ethereum mainnet dLEND deployment.

## Important notes

- The script uses `MaxUint256 - 1` intentionally.
- In this fork, exact `MaxUint256` is rejected for third-party repay-on-behalf, but `MaxUint256 - 1` is accepted and clipped to the actual debt.
- The wallet only needs enough `dUSD` to cover the real debt, not the oversized sentinel value.
- If `REPAY_AMOUNT` is set, the script repays exactly that amount instead of using the full-repay sentinel.
- `REPAY_AMOUNT` must be greater than zero and cannot exceed the current attacker debt snapshot.

## After the repay confirms

Run the Phase 2 assertion:

```bash
cd ethereum-solidity-contracts
yarn recovery:assert:phase2
```

By default, the assertion now expects the full post-repay recovery posture:

- `cbBTC` still paused
- every other reserve live in `unpaused + frozen` mode
- flash loans disabled on all live reserves

If you intentionally execute a smaller custom Phase 2 set, pass `PHASE2_UNPAUSE_RESERVES_JSON` to the assertion so it validates only that custom live set.
