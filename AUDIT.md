# dSTAKE v2 Audit Log

Central registry for findings discovered during the dSTAKE v2 audit. All subagents must read this document before reporting new issues to avoid duplicates.

## Reporting Guidelines
- Use the template below for each unique finding.
- Severity levels:
  - Critical – Attack can steal or permanently freeze a substantial amount of user funds.
  - High – Attack can temporarily deteriorate the product or freeze user funds.
  - Medium – Governance/operator missteps can easily cause damage.
  - Low – All other issues (including gas, clarity, tooling).
- For Critical/High findings include clear reproduction steps or scenario walkthroughs.
- Link to specific contracts/lines when possible (e.g., `contracts/vaults/dstake/DStakeRouterV2.sol:123`).

```
### [Severity] Title
- **Status:** Open
- **Reporter:** <name>
- **Summary:** <one paragraph overview>
- **Details:** <key reasoning, with reproduction steps for Critical/High>
- **Notes:** <optional follow-ups, affected assumptions, etc.>
```

## Findings

### [High] ERC4626 withdrawals fail when liquidity is split across vaults
- **Status:** Acknowledged
- **Reporter:** RouterCore-W1
- **Summary:** `handleWithdraw` delegates every ERC4626 withdrawal to a single vault; when assets are diversified across multiple vaults, any request larger than the largest individual vault balance reverts with `NoLiquidityAvailable`, freezing standard ERC4626 exits despite total system liquidity being sufficient.
- **Details:** 
  1. Ensure at least two vaults are active with adapters.
  2. Send liquidity into both vaults (e.g., call `solverDepositAssets([vaultA, vaultB], [X, X], …)` so each holds ~X dSTABLE exposure).
  3. A holder of ≥2X dSTAKE shares calls `DStakeTokenV2.withdraw(2X, receiver, owner)`.
     - `handleWithdraw` (`contracts/vaults/dstake/DStakeRouterV2.sol:423`) asks `_selectVaultForWithdrawal` for one vault that can satisfy the full request.
     - `_selectVaultForWithdrawal` iterates the vault list and calls `_vaultCanSatisfyWithdrawal` (`contracts/vaults/dstake/DStakeRouterV2.sol:1035`), which requires that a single vault can cover the entire amount. Because each vault only holds X, every check fails and the call reverts with `NoLiquidityAvailable`, leaving the ERC4626 withdraw path unusable.
- **Notes:** Users can technically assemble a manual multi-vault exit via the solver interfaces, but all integrations that rely on the ERC4626 `withdraw`/`redeem` flows are blocked once balances are diversified, so funds are effectively frozen until operators intervene. Team has acknowledged this liquidity limitation.

### TokenOps-W1 – No Findings
- Scope: contracts/vaults/dstake/DStakeTokenV2.sol, DStakeRouterV2 handleDeposit/handleWithdraw callbacks, withdrawal fee math, ERC4626 preview/limit helpers.
- Notes: No additional security or accounting issues identified in this wave.

### Collateral-W1 – No Findings
- Scope: contracts/vaults/dstake/DStakeCollateralVaultV2.sol and representative adapters under `contracts/vaults/dstake/adapters/`, focusing on custody, NAV valuation, and adapter trust boundaries.
- Notes: No additional storage custody or adapter invariants issues identified in this wave.

### Invert-Solver-W2 – No Findings
- Scope: solver deposit/withdraw paths, multi-vault arithmetic, and `DStakeRouterV2RebalanceModule` delegatecall flows, including allowance handling, slippage guards, and fingerprint validation.
- Notes: No new gaps identified beyond the existing single-vault ERC4626 withdrawal freeze.

### [High] Config manager can loot vault via artificial shortfall cycle
- **Status:** Acknowledged
- **Reporter:** Invert-Gov-W2
- **Summary:** A `CONFIG_MANAGER_ROLE` holder can fabricate a shortfall, buy shares at the depressed price, then clear the shortfall to restore NAV and redeem, extracting profit from existing depositors.
- **Details:**
  1. Acting with `CONFIG_MANAGER_ROLE`, call `recordShortfall(δ)` (`contracts/vaults/dstake/DStakeRouterV2GovernanceModule.sol:119` via router entry at `contracts/vaults/dstake/DStakeRouterV2.sol:798`), inflating `settlementShortfall` up to `totalManagedAssets()` without any real loss.
  2. Because `DStakeTokenV2.totalAssets()` subtracts `settlementShortfall` (`contracts/vaults/dstake/DStakeTokenV2.sol:95`), the ERC4626 share price drops, so deposits (`previewDeposit`, `contracts/vaults/dstake/DStakeTokenV2.sol:145`) mint extra shares per dStable.
  3. After accumulating shares cheaply, clear the fabricated deficit via `clearShortfall(δ)` (`contracts/vaults/dstake/DStakeRouterV2GovernanceModule.sol:133` through router entry at `contracts/vaults/dstake/DStakeRouterV2.sol:803`) to return NAV to its original level while retaining the inflated share position.
  4. Redeem the bloated shares (`contracts/vaults/dstake/DStakeTokenV2.sol:158`) to withdraw more dStable than deposited, effectively looting honest LPs. The flow requires only temporary control of the config role; no invariant ties shortfall adjustments to realized losses.
- **Notes:** Violates the assumption that config managers cannot extract value from depositors and undermines on-chain accounting that treats shortfall as operator-only bookkeeping. Team notes this risk is out of audit scope due to privileged role access.

### [High] Single-vault deposit routing blocks ERC4626 deposits when first vault hits cap
- **Status:** Open
- **Reporter:** Fanout-Liquidity-W3
- **Summary:** `maxDeposit()` only considers the first auto-selected vault; if that vault’s upstream `maxDeposit` returns zero, all ERC4626 deposits and router fee reinvests revert even though other vaults still have capacity.
- **Details:**
  1. With balanced allocations and multiple active vaults, `DeterministicVaultSelector.selectTopUnderallocated` falls back to index 0 (`contracts/vaults/dstake/libraries/DeterministicVaultSelector.sol:130-148`).
  2. `_selectAutoDepositVault` and `_vaultDepositLimit` (`contracts/vaults/dstake/DStakeRouterV2.sol:275-299`, `contracts/vaults/dstake/DStakeRouterV2.sol:397-409`) therefore check only that vault’s `IERC4626.maxDeposit`. If the upstream strategy is capped, the limit is zero.
  3. `DStakeTokenV2.deposit` enforces `assets <= maxDeposit(receiver)` and thus reverts for any positive amount. `reinvestFees()` reuses `_depositToAutoVault`, so fee reinvestments also fail (`contracts/vaults/dstake/DStakeRouterV2.sol:412-420`, `contracts/vaults/dstake/DStakeRouterV2.sol:898-920`).
 4. Result: ERC4626 integrations cannot add liquidity and idle fees accumulate until governance reorders or retargets vault configs, despite remaining capacity in other vaults.
- **Notes:** Mirrors the withdrawal freeze pattern on the deposit path, extending the impact of single-vault routing assumptions.

### [High] Shortfall repayments can be front-run
- **Status:** Open
- **Reporter:** Fanout-Shortfall-W3
- **Summary:** Anyone can deposit immediately before `clearShortfall` executes, minting inflated shares that capture most of the reimbursement once the shortfall is cleared, leaving prior holders uncompensated.
- **Details:**
  1. With `settlementShortfall > 0`, share pricing in `DStakeTokenV2` subtracts this amount when computing `totalAssets()` (`contracts/vaults/dstake/DStakeTokenV2.sol:95-147`), depressing the share price.
  2. Governance prepares to restore funds by injecting assets and calling `clearShortfall(Δ)` (`contracts/vaults/dstake/DStakeRouterV2GovernanceModule.sol:133-143` via router dispatch).
  3. An attacker front-runs the transaction, depositing a large amount at the depressed price to mint an outsized share of supply.
  4. When `clearShortfall` executes, NAV jumps back up while the attacker retains their inflated share position.
  5. The attacker immediately withdraws through ERC4626 or solver exits, capturing roughly `Δ * attacker_share_of_supply`, siphoning the intended repayment from long-term LPs.
- **Notes:** Shortfall repayments currently benefit whoever is holding shares at execution time, enabling opportunistic capture by outsiders monitoring governance flows.
