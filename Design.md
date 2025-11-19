# dTRINITY Product & Architecture Overview

## Platform Goals
- Deliver institution-ready crypto-native dollar and ether substitutes (dUSD, dETH) that stay fully collateralised, liquid, and auditable on-chain.
- Offer native yield venues (sdUSD, sdETH) so treasuries can keep assets productive without leaving the dTRINITY risk perimeter.
- Provide a purpose-built money market (dLend) where the ecosystem’s assets can be borrowed against curated collateral with predictable rate policy.

The repo hosts the Solidity contracts, deploy scripts, and TypeScript helpers that implement those products. This document summarises how dSTABLE, dLEND, and dSTAKE work together at a high level for product, risk, and operations stakeholders.

## dStable: Collateralised Base Assets (dUSD & dETH)
**What it is** – An ERC20 stable-asset stack (`contracts/dstable/`) that can be parameterised for any base currency. Today it fronts dUSD (USD-pegged) and dETH (ETH-pegged).

**How issuance works**
1. Users or programmatic agents deposit approved collateral into `CollateralVault` instances (e.g., `CollateralHolderVault`).
2. `IssuerV2_2` values that collateral via the shared `OracleAggregator` and mints dStable up to the system-wide cap that supply ≤ collateral value.
3. Minted dStable is delivered directly to the caller; collateral stays in the vault.

**How redemption works**
- `RedeemerV2` burns user-submitted dStable and pays out the chosen collateral, applying protocol-wide and per-asset redemption fees. Governance can pause individual assets without halting the entire system, and protocol-controlled redemptions can bypass fees when rebalancing reserves.

**Collateral menus**
- *dUSD*: stablecoins and yield-bearing USD wrappers such as USDC, USDT, USDS/sUSDS, frxUSD/sfrxUSD, fxUSD, fxSAVE, and aTokens (aUSDC/aUSDT). Fees can be tuned per collateral to reflect liquidity or oracle quality.
- *dETH*: ETH-correlated assets like WETH, stETH, sfrxETH, and rETH.

**Yield routing mechanics**
- Collateral can be interest-bearing (e.g., sfrxUSD, static aUSDC). Instead of letting dStable holders capture that embedded yield, dTRINITY reroutes it to where liquidity is most productive: subsidising dLEND borrowers so lending rates stay attractive, or seeding Curve-style LP programmes so secondary markets for dStable remain deep. This keeps dStable itself credibly neutral while still monetising the backing assets for the ecosystem.

**Risk controls & accounting**
- `IssuerV2_2` enforces the invariant `totalSupply(dStable) ≤ vaultValue` on every mint, blocking issuance the moment collateral ratios degrade.
- Asset-level mint/redeem pauses allow surgical incident response.
- Fees, receiver addresses, and collateral lists are role-gated so governance changes can be scheduled and audited.
- Automated Monetary Operations (AMOs) give governance a controlled way to route freshly minted supply into external venues using transfer-restricted `AmoDebtToken` receipts so vault accounting always knows where collateral sits.

## dStake: Yield Vaults for dStable (sdUSD & sdETH)
**What it is** – ERC4626 share vaults (`DStakeTokenV2`) that accept a dStable, route capital into curated strategies, and stream protocol fees + incentives back to depositors. Instances like sdUSD and sdETH live under `contracts/vaults/dstake/`.

**Core components**
- `DStakeTokenV2`: ERC4626 share token handling user deposits/withdrawals while delegating strategy work to the router.
- `DStakeRouterV2`: Stateless orchestration contract living on the hot path. It receives callbacks from the token, transfers assets, executes strategy calls, and manages withdrawal fees and shortfall tracking.
- `Governance` & `Rebalance` modules: Delegatecall extensions that keep router bytecode small while exposing the long-tail admin, adapter, cap, and rebalance flows. Storage fingerprints guarantee module compatibility.
- `DStakeCollateralVaultV2`: Custodies strategy shares (MetaMorpho vault shares, static aTokens, generic ERC4626 wrappers) and reports total NAV in dStable terms. Only routers holding `ROUTER_ROLE` can move assets.
- `Adapters`: `WrappedDLendConversionAdapter`, `MetaMorphoConversionAdapter`, and `GenericERC4626ConversionAdapter` translate between dStable and external vault shares with slippage, dust, and allowance guards.

**Capital flow**
1. User deposits dStable into `DStakeTokenV2`.
2. Token mints shares and hands the assets to `DStakeRouterV2`.
3. Router selects the default (or solver-provided) adapter and calls `depositIntoStrategy`, instructing adapters to mint strategy shares directly to the collateral vault.
4. Withdrawals reverse the path, redeeming strategy shares back to dStable before transferring funds to the user and collecting withdrawal fees where configured.
5. Because sdAssets remain ERC4626 tokens, users can still supply them as collateral, LP them, or use them in other DeFi flows (wherever protocols choose to whitelist them) while the router continues to manage allocations under the hood.

**Strategy menu & allocation**
- **dLEND placements (underlying-only)** – `WrappedDLendConversionAdapter` routes dStable directly into dLEND markets via Static AToken wrappers (e.g., `stataDUSD`). The adapter holds the raw aToken while sdUSD/sdETH holders keep a simple ERC4626 receipt. Importantly, the sd tokens themselves are not listed on dLEND to avoid yield cannibalisation—only the underlying dStable participates in borrowing markets.
- **MetaMorpho and other ERC4626 venues** – adapters integrate partner vaults with configurable slippage ceilings and emergency controls. Because adapters mint strategy shares straight into `DStakeCollateralVaultV2`, the router can mix venues without bridging funds through intermediate custodians.
- **Target-based rebalancing** – routers and rebalance modules compare live vault balances against desired weights and orchestrate multi-vault moves automatically, so users never have to micromanage positions.

- **Passive allocations**: SdAsset holders auto-lend dStable into curated venues (lending protocols, MetaMorpho vaults, liquidity programs) and collect the blended yield passively while governance manages partner selection.
- **Composability**: Because sdAssets stay ERC4626 tokens, integrators can list them in DEX pools or structured products without needing to understand router internals. (dLEND intentionally does not list sdAssets so the underlying yield keeps flowing to borrowers instead of being looped.)
- Governance can rotate venues, adjust withdrawal fees, or pause deposits centrally, shielding end users from integration churn while keeping capital productive.

**Risk controls**
- Router shortfall accounting records any underfills during withdrawals so governance can decide whether to cover or socialise losses.
- Adapters reset allowances, enforce min-out checks, and value strategy shares before they are whitelisted.
- Modules expose asset-level caps, allowlists, and pausable entry points to stop new deposits or shut down specific strategies during incidents.

## dLend: dTRINITY Money Markets
**What it is** – A curated Aave v3 fork (`contracts/dlend/`) where the dTRINITY tokens, blue-chip LSTs, and yield-bearing stables can be lent or borrowed under parameters chosen by the DAO.

**Architecture**
- Core contracts (`Pool`, `PoolConfigurator`, `ACLManager`, `Treasury` etc.) match upstream Aave v3 at commits referenced in `contracts/dlend/README.md`, ensuring compatibility with tooling and audits while letting the DAO maintain its own parameters.
- Deploy scripts under `deploy/03_dlend/` stand up the address provider, configurator, pool, incentives controller, interest rate strategies, and reserve setups.
- Rewards flow through a `RewardsController` + `IncentivesProxy`, enabling emissions in dLend-native programs and feeding into dStake allocations when sdAssets farm dLend.

**Reserve set & policy (testnet config for illustration)**
- *Borrowable stables*: dUSD (supply cap 1M, borrow cap 800k, no collateral factor), sfrxUSD.
- *Borrowable ETH assets*: dETH (cap 500), WETH, stETH.
- *Collateral-only*: sfrxETH is enabled for deposits but cannot be borrowed, reducing recursive leverage risk.
- dStable reserves intentionally have 0% LTV so users can borrow against dStable but cannot loop it as collateral, isolating issuer risk from the lending book.
- Interest models are defined via rate strategy presets (`rateStrategyHighLiquidityStable`, `...Volatile`) encoded in RAY math with predictable slopes. Supply/borrow caps, liquidation thresholds, and protocol fees are set per asset in `config/dlend/reserves-params.ts`.
- Flash loans, isolation mode, and eMode flags are available but only enabled where config allows.

**Static aToken wrappers**
- `contracts/vaults/atoken_wrapper/` forks BGD’s Static AToken implementation to expose ERC4626 wrappers (e.g., `stataDUSD`, `stataWETH`). They preserve liquidity mining rewards, support permit/permit2 flows, and are upgradeable via governance.
- dStake relies on these wrappers as strategy shares, letting sdUSD or sdETH sit on top of dLend positions without inheriting the raw aToken interface.

## Putting It Together: Typical User Journeys
1. **Mint dStable** – A treasury deposits USDC into the dUSD vault. `IssuerV2_2` mints dUSD one-for-one (subject to valuation). If the treasury instead deposits a yield-bearing wrapper such as sfrxUSD, that upstream yield can later be redirected toward incentives for dLEND borrowers or Curve LPs.
2. **Deploy into dStake** – The treasury deposits freshly minted dUSD into sdUSD. Router allocates funds into the default strategy (today, static aTokens referencing dLend). Shares accrue yield from dLEND borrowers plus any incentive programs streamed via idle vaults while the sdUSD token remains composable collateral elsewhere.
3. **Borrow in dLend** – Other ecosystem actors deposit sfrxETH as collateral inside dLend and borrow dUSD for working capital. Because sfrxETH has conservative LTVs and dUSD has zero LTV, a single liquidation scenario cannot cascade back into the issuer.
4. **Provide liquidity** – The same sdUSD minted in step 2 can be paired with dUSD on Curve or other DEXs. Yield from the sd leg keeps accruing because the router still manages allocations, while the LP position earns trading fees.
5. **Risk event response** – If a collateral feed fails, governance pauses that asset inside both dStable and dLend via role-gated functions, keeping the rest of the system live while the issue is resolved.

## Operations, Governance, and Tooling
- Network-specific configs (`config/networks/*.ts`) drive every deployment: token lists, Safe addresses, adapter targets, oracle feeds, and reward schedules live there so changes are reviewable.
- Deploy pipelines are organised by product (`deploy/01_deth_ecosystem`, `02_dusd_ecosystem`, `03_dlend`, etc.) and can be replayed deterministically via Hardhat Deploy.
- Role automation scripts (in `.shared/`) help stewards scan, transfer, and revoke AccessControl roles whenever contract upgrades land.
- Tests live under `foundry/` and `test/` with invariant suites for dStable AMOs, dStake routers, reward managers, and vesting contracts to continually enforce supply, fee, and slippage invariants.

## Summary Table
| Product                    | Users interact via                                                        | Backed by                                                                               | Key controls                                                                  |
| -------------------------- | ------------------------------------------------------------------------- | --------------------------------------------------------------------------------------- | ----------------------------------------------------------------------------- |
| **dUSD / dETH (dStable)**  | Issuer + Redeemer contracts, governance/operator AMO hooks                | Whitelisted collateral in CollateralVault (mix of stablecoins and yield-bearing assets) | System-wide supply ≤ collateral, asset-level pauses, AMO peg guards           |
| **sdUSD / sdETH (dStake)** | ERC4626 deposits/withdrawals routed by DStakeRouterV2                     | Strategy shares held in DStakeCollateralVault (dLend, MetaMorpho, etc.)                 | Router fee knobs, adapter allowlists, rebalance modules, shortfall accounting |
| **dLend money market**     | Standard Aave v3 interfaces (pool, rewards, debt tokens, static wrappers) | Curated reserves: dStable assets, ETH LSDs, yield stables                               | Reserve caps/LTVs, ACL-managed onboarding, oracle validation                  |

Together these pieces let dTRINITY run a vertically integrated stable-asset, yield, and credit platform with transparent risk knobs and operational tooling owned inside the DAO’s repositories while keeping user-facing flows simple and composable.
