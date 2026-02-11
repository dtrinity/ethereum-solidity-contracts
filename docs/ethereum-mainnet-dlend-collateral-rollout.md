# Ethereum Mainnet dLEND Collateral Rollout

This document converts planning notes into an execution checklist for adding/updating dLEND collateral assets on Ethereum mainnet.

## Scope

- Update existing dLEND collateral risk parameters to match the latest table.
- Add new collateral assets to `config/networks/ethereum_mainnet.ts` and `config/dlend/reserves-params.ts`.
- Configure USD oracle routing for all rollout assets.
- Queue Safe transactions for oracle configuration and reserve initialization/configuration.

## Assets in Rollout

- Yieldcoin: `sUSDe`, `sUSDS`, `syrupUSDC`, `syrupUSDT`, `sfrxUSD`
- LST: `wstETH`, `rETH`, `sfrxETH`, `frxETH`, `LBTC`
- Crypto: `WETH`, `WBTC`, `cbBTC`
- RWA: `PAXG`

## Oracle Model

- ERC4626 + Chainlink feed: `sUSDe`, `sUSDS`, `syrupUSDC`, `syrupUSDT`, `sfrxUSD`, `sfrxETH`
- Composite feeds: `wstETH`, `rETH`, `frxETH`, `LBTC`, `WBTC`
- Direct USD feeds: `WETH`, `dETH`, `cbBTC`, `PAXG`

## Placeholder Feeds Requiring Manual Fill

The following values are intentionally invalid strings in `config/networks/ethereum_mainnet.ts` and must be replaced before execution:

- `REPLACE_ME_INVALID_CHAINLINK_USDE_USD_FEED`
- `REPLACE_ME_INVALID_CHAINLINK_RETH_ETH_FEED`
- `REPLACE_ME_INVALID_CHAINLINK_FRXETH_ETH_FEED`
- `REPLACE_ME_INVALID_CHAINLINK_LBTC_BTC_FEED`
- `REPLACE_ME_INVALID_CHAINLINK_WBTC_BTC_FEED`
- `REPLACE_ME_INVALID_CHAINLINK_CBBTC_USD_FEED`
- `REPLACE_ME_INVALID_CHAINLINK_PAXG_USD_FEED`

## Safe Scripts

- `deploy/99_cleanup/03_setup_ethereum_mainnet_collateral_oracles_safe.ts`
  - Queues wrapper setup (`setFeed`, `addCompositeFeed`, `setERC4626Feed`) and `OracleAggregatorV1_1.setOracle` mapping updates.
- `deploy/99_cleanup/04_setup_ethereum_mainnet_collateral_reserves_safe.ts`
  - Queues reserve initialization (`PoolConfigurator.initReserves`) and risk config updates (`ReservesSetupHelper.configureReserves`) with temporary risk-admin grant/revoke.

## Execution Checklist

1. Replace all invalid placeholder feed strings with final feed addresses.
2. Run compile and lint.
3. Run deployment scripts in Safe mode to generate Safe builder batches.
4. Execute Safe transactions in order:
   - Oracle setup batch
   - Reserve setup batch
5. Re-run reserve/oracle checks after Safe execution.
