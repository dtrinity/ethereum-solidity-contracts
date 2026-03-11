# Ethereum Mainnet dLEND Collateral Rollout

This document converts planning notes into an execution checklist for adding/updating dLEND collateral assets on Ethereum mainnet.

## Scope

- Update existing dLEND collateral risk parameters to match the latest table.
- Add new collateral assets to `config/networks/ethereum_mainnet.ts` and `config/dlend/reserves-params.ts`.
- Configure USD oracle routing for all rollout assets.
- Queue Safe transactions for oracle configuration and reserve initialization/configuration.

## Assets in Rollout

- Yieldcoin: `sUSDe`, `sUSDS`, `syrupUSDC`, `syrupUSDT`, `sfrxUSD`
- LST: `wstETH`, `rETH`, `sfrxETH`, `LBTC`
- Crypto: `WETH`, `WBTC`, `cbBTC`
- RWA: `PAXG`

## Oracle Model

- ERC4626 + Chainlink feed: `sUSDe`, `sUSDS`, `syrupUSDC`, `syrupUSDT`, `sfrxUSD`, `sfrxETH`
- Composite feeds: `wstETH`, `rETH`, `LBTC`, `WBTC`
- Direct USD feeds: `WETH`, `dETH`, `cbBTC`, `PAXG`

## Chainlink Feeds

Mainnet feed constants in `config/networks/ethereum_mainnet.ts` should be fully populated before execution.

## Hard Rule

- Never run deployment commands with `--reset` on mainnet rollout flows.
- `--reset` deletes `deployments/ethereum_mainnet/` state and can desynchronize Safe rollout batches.
- To re-run one step, remove only that step's migration key in `.migrations.json` and re-run the same tag without `--reset`.

## Safe Scripts

- `deploy/30_dlend_new_listings/01_setup_ethereum_mainnet_collateral_oracles_safe.ts`
  - Queues wrapper setup (`setFeed`, `addCompositeFeed`, `setERC4626Feed`) and `OracleAggregatorV1_1.setOracle` mapping updates.
- `deploy/30_dlend_new_listings/02_setup_ethereum_mainnet_collateral_reserves_safe.ts`
  - Queues reserve initialization (`PoolConfigurator.initReserves`) and risk config updates (`ReservesSetupHelper.configureReserves`) with temporary risk-admin grant/revoke.

## Execution Checklist

1. Verify all feed constants are populated with final mainnet addresses.
2. Run compile and lint.
3. Run deployment scripts in Safe mode to generate Safe builder batches.
4. Execute Safe transactions in order:
   - Oracle setup batch
   - Reserve setup batch
5. Re-run reserve/oracle checks after Safe execution.
