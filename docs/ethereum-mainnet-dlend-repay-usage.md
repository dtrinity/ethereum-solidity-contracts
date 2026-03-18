# Ethereum Mainnet dLEND Repay Usage

Use this after the recovery governance transaction has already put `dUSD` and `cbBTC` into the required pre-repay state.

## What the script does

- checks the current `dUSD` and `cbBTC` reserve flags
- reads the attacker's current variable `dUSD` debt
- checks the payer wallet `dUSD` balance and allowance
- approves the Pool if needed
- calls `Pool.repay(dUSD, MaxUint256 - 1, 2, attacker)`
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

## Execute the repay

```bash
cd ethereum-solidity-contracts
export PRIVATE_KEY='0x...'
yarn recovery:repay
```

## Required environment

- `PRIVATE_KEY`

Optional overrides if needed:

- `RPC_URL`
- `POOL`
- `DUSD`
- `CBBTC`
- `ATTACKER`

Defaults in the script already point to the current Ethereum mainnet dLEND deployment.

## Important notes

- The script uses `MaxUint256 - 1` intentionally.
- In this fork, exact `MaxUint256` is rejected for third-party repay-on-behalf, but `MaxUint256 - 1` is accepted and clipped to the actual debt.
- The wallet only needs enough `dUSD` to cover the real debt, not the oversized sentinel value.

## After the repay confirms

Run the Phase 2 assertion:

```bash
cd ethereum-solidity-contracts
export PHASE2_UNPAUSE_RESERVES_JSON='["0xb419EcDd222981E7E54cEc316797eCb799c6AFdC","0xC02aaA39b223FE8D0A0e5C4F27eAD9083C756Cc2","0x7f39C581F595B53c5cb19bD0b3f8dA6c935E2Ca0","0xae78736Cd615f374D3085123A210448E74Fc6393","0x9D39A5DE30e57443BfF2A8307A4256c8797A3497","0xa3931d71877C0E7a3148CB7Eb4463524FEc27fbD","0x80ac24aA929eaF5013f6436cdA2a7ba190f5Cc0b","0x356B8d89c1e1239Cbbb9dE4815c39A1474d5BA7D"]'
yarn recovery:assert:phase2
```
