# dTRINITY dLEND Ethereum Incident Post-Mortem

## Summary

On March 17, 2026, dTRINITY dLEND on Ethereum was exploited through the cbBTC reserve in a liquidity-index inflation attack. The attacker created a near-dust cbBTC aToken supply condition, repeatedly accrued flash-loan fees into that thin supplier base, inflated the reserve-wide liquidity index, and then borrowed **257,328.63221656 dUSD** against collateral value that was not economically real.

The exploit path was contained the same day. Since then, the recovery flow has repaid the attacker’s dUSD variable debt, moved non-cbBTC markets into a recovery-safe posture, and kept cbBTC quarantined while code-level remediation and reserve wind-down steps are prepared.

## Impact

- **257,328.63221656 dUSD** was borrowed from the protocol.
- Subsequent swap legs realized **226,483.114654 USDC**.
- **110 ETH** was later sent to a downstream deposit address in two transactions.
- The affected reserve was the **cbBTC collateral market** on Ethereum mainnet.

## What happened

The setup transaction established the unsafe state: the attacker reduced live cbBTC supplier exposure to a near-dust condition while preserving enough balance to remain the economic recipient of reserve-wide fee accrual. Once that state was in place, repeated flash-loan activity caused the cbBTC reserve’s liquidity index to rise sharply.

In dLEND’s Aave-style accounting model, visible collateral value is derived from a scaled balance multiplied by the reserve liquidity index. Under normal liquidity conditions, this works as intended. Under near-empty reserve conditions, it becomes fragile: if fee income is distributed across almost no live aToken supply, the liquidity index can jump discontinuously. That is the condition the attacker manufactured and then exploited.

After inflating the cbBTC collateral accounting, the attacker borrowed dUSD, routed it through swap and settlement legs, and moved part of the proceeds onward. The exact number of inner loop iterations does not change the root cause: the exploit depended on fee accrual being able to move the reserve index while the effective aToken supply was close to dust.

## Incident timeline

- **2026-03-17 11:05:47 UTC** — setup leg executed, establishing the thin-supply cbBTC reserve condition.
- **2026-03-17 11:06:11 UTC** — borrow leg executed, minting variable dUSD debt and transferring **257,328.63221656 dUSD** out of the pool.
- **2026-03-17 11:13:47 UTC** — first swap leg converted part of the borrowed dUSD.
- **2026-03-17 11:14:47 UTC** — second swap leg completed the conversion, realizing **226,483.114654 USDC** across both swaps.
- **2026-03-17 11:16:23 UTC** — settlement transaction finalized the swap output.
- **2026-03-17 11:24:47 UTC** — **100 ETH** sent to a downstream deposit address.
- **2026-03-17 11:25:47 UTC** — **10 ETH** sent to a downstream deposit address.
- **2026-03-17 11:53:23 UTC** — governance Safe paused seven reserves via MultiSend batch (initial circuit-breaker).
- **2026-03-17 12:26:47 UTC** — dUSD redemptions paused.
- **2026-03-18 15:17:35 UTC** — recovery batch executed: disabled borrowing, stable-rate borrowing, and flash loans; froze reserves; set cbBTC LTV to zero.
- **2026-03-18 19:39:23 UTC** — remaining paused non-cbBTC reserves moved to unpaused + frozen posture with flash loans disabled.
- **2026-03-18 19:42:35 UTC** — dUSD redemptions restored.
- **Post-incident** — attacker dUSD variable debt repaid to zero; cbBTC remained quarantined.

## Root cause

The protocol allowed flash-loan premium accrual to increase the reserve liquidity index under conditions where the effective cbBTC aToken supply had been reduced to a very small base. That let the attacker magnify apparent collateral value relative to economically real backing and then borrow dUSD against the inflated accounting state.

Put differently, the attack targeted the **liquidity index**, not the scaled balance itself. In a near-empty reserve, supplier-side premium distribution becomes unsafe because a large fee event can be divided across almost no live supply. That is the accounting discontinuity that enabled this exploit.

Before remediation, the flash-loan repayment path effectively included supplier-side index inflation logic of this form:

```solidity
uint256 premiumToProtocol = params.totalPremium.percentMul(params.flashLoanPremiumToProtocol);
uint256 premiumToLP = params.totalPremium - premiumToProtocol;

reserveCache.nextLiquidityIndex = reserve.cumulateToLiquidityIndex(
    IERC20(reserveCache.aTokenAddress).totalSupply()
        + uint256(reserve.accruedToTreasury).rayMul(reserveCache.nextLiquidityIndex),
    premiumToLP
);
```

That pattern is safe only when supplier liquidity is meaningfully distributed. It becomes exploitable when a reserve can be driven to dust while still exposing a fee-accrual path such as flash loans.

## Response and current state

Our first priority was containment, not reopening. The emergency response paused the original extraction path and preserved the incident state long enough to validate the mechanics on-chain.

The current recovery posture separates solvency repair from root-cause remediation:

- the attacker’s **dUSD variable debt has been repaid to zero**,
- every non-cbBTC reserve has been moved into an **unpaused + frozen** posture,
- borrowing, stable-rate borrowing, and flash loans are disabled on those non-cbBTC reserves,
- withdrawals, repayments, and liquidations remain available where needed,
- **cbBTC remains paused, frozen, non-borrowable, flash-loans-disabled, and at LTV = 0**.

That posture is intentional. Restoring dUSD solvency was necessary, but it was not sufficient. The cbBTC reserve remains quarantined until the accounting-path remediation and reserve wind-down steps are executed.

## Remediation

### 1. Remove supplier-side flash-loan index jumps

We have implemented a patched flash-loan repayment path that routes the **entire** flash-loan premium to protocol treasury accrual instead of splitting part of it into an immediate supplier-side liquidity-index increase.

```solidity
// keep total borrower fee unchanged, but remove the supplier-side index jump
uint256 premiumToProtocol = params.totalPremium;
uint256 amountPlusPremium = params.amount + params.totalPremium;

reserve.accruedToTreasury += premiumToProtocol
    .rayDiv(reserveCache.nextLiquidityIndex)
    .toUint128();

reserve.updateInterestRates(reserveCache, params.asset, amountPlusPremium, 0);
```

This preserves the fee paid by flash borrowers, but removes the precise mechanism that let a thin-supply reserve experience an outsized liquidity-index jump in a single transaction.

### 2. Permanently wind down the quarantined cbBTC reserve

We have also implemented a one-off quarantine aToken for the compromised reserve. The purpose is not to reopen cbBTC; it is to **sanitize and retire** it safely.

The planned sequence is:

1. mint any remaining treasury accrual into visible aToken balances,
2. upgrade only the quarantined cbBTC aToken implementation,
3. burn the full holder set under strict quarantine preconditions,
4. rescue remaining underlying to the designated recovery wallet,
5. clear residual reserve bitmap state for affected users,
6. deactivate and drop the reserve.

The quarantine burn path is intentionally strict:

```solidity
function forceBurnAllAndVerifyZero(address[] calldata holders)
    external
    onlyPoolAdmin
    returns (uint256 totalBurned)
{
    _requireReserveQuarantined();
    _requireZeroAccruedToTreasury();
    // burn every non-zero holder balance
    ...
    require(totalSupply() == 0, "SANITIZE_INCOMPLETE_HOLDER_SET");
}
```

To support that reserve retirement flow, the Pool implementation adds a single cleanup function — `clearReserveUserConfiguration(address asset, address[] calldata users)` — gated by `onlyPoolAdmin`. It clears only collateral and borrowing bitmap bits for named users on one listed reserve. It does not move funds, alter reserve parameters, or touch any state beyond the user configuration bitmap. This is a contained governance expansion: without it, users whose aToken balances were burned by `forceBurnAllAndVerifyZero` would retain phantom collateral/borrowing flags that block `dropReserve`.

```solidity
function clearReserveUserConfiguration(
    address asset,
    address[] calldata users
) external virtual override onlyPoolAdmin {
    // ...
    DataTypes.UserConfigurationMap storage userConfig = _usersConfig[user];
    userConfig.setUsingAsCollateral(reserveId, false);
    userConfig.setBorrowing(reserveId, false);
}
```

### 3. Change how new markets are listed or relisted

Containment alone does not fix the vulnerability class. We have therefore changed the listing model for new or replacement reserves.

New markets will no longer be initialized directly into a live posture. Instead, they will go through a staged flow:

1. initialize the reserve,
2. immediately force it into a safe non-live configuration,
3. seed the reserve above an explicit aToken floor,
4. only then atomically enable collateral, borrowing, and any other features that are intentionally being restored.

The new enable gate enforces a minimum seeded aToken supply before a reserve can be turned live:

```solidity
if (currentATokenSupply < input.minATokenSupply) {
    revert InsufficientATokenSupply(asset, currentATokenSupply, input.minATokenSupply);
}
```

And the staged posture deliberately disables the unsafe window:

```solidity
configurator.configureReserveAsCollateral(asset, 0, 0, 0);
configurator.setReserveBorrowing(asset, false);
configurator.setReserveStableRateBorrowing(asset, false);
configurator.setReserveFlashLoaning(asset, false);
configurator.setBorrowCap(asset, 0);
```

For as long as broader accounting remediation remains in progress, **flash loans will remain disabled by default on new listings** and will only be restored by explicit decision.

## Transaction references

### Attacker transactions

- Setup leg: [`0x8d33d688def03551cb77b0463f55ae5a670f5ebf3bbb5b8aa0e284c040ae7139`](https://etherscan.io/tx/0x8d33d688def03551cb77b0463f55ae5a670f5ebf3bbb5b8aa0e284c040ae7139)
- Borrow leg: [`0xbec4c8ae19c44990984fd41dc7dd1c9a22894adccf31ca6b61b5aa084fc33260`](https://etherscan.io/tx/0xbec4c8ae19c44990984fd41dc7dd1c9a22894adccf31ca6b61b5aa084fc33260)
- Swap leg 1: [`0x10494ef3ed8fc0c31d1740b2a56f2e91842049afd1dde3eefe05ed56cbd14b84`](https://etherscan.io/tx/0x10494ef3ed8fc0c31d1740b2a56f2e91842049afd1dde3eefe05ed56cbd14b84)
- Swap leg 2: [`0x589bc139bebdd97e4c7163668b3b8cd76d66f75e9ae2bfa5abb8005765aaa835`](https://etherscan.io/tx/0x589bc139bebdd97e4c7163668b3b8cd76d66f75e9ae2bfa5abb8005765aaa835)
- Settlement: [`0x5d74725e9fbe51cc3cf559e942aa451cb4e29e5a235499a331a25be1c8c0fd7e`](https://etherscan.io/tx/0x5d74725e9fbe51cc3cf559e942aa451cb4e29e5a235499a331a25be1c8c0fd7e)
- 100 ETH downstream deposit: [`0x2b1749de488a359fce4054e226fb64cc71a577f81e5c1388747f0cfb3602310f`](https://etherscan.io/tx/0x2b1749de488a359fce4054e226fb64cc71a577f81e5c1388747f0cfb3602310f)
- 10 ETH downstream deposit: [`0x5bf72b109bc6a2c200b6cfb0a36a2fed4c46c83fde85b98aede9bceda5c1eab1`](https://etherscan.io/tx/0x5bf72b109bc6a2c200b6cfb0a36a2fed4c46c83fde85b98aede9bceda5c1eab1)

### Mitigation and recovery transactions (governance Safe)

- Reserve pause circuit-breaker (7 reserves): [`0xe2aa11d71f1995103dac6063fb94487a499b1daca87278880ccc92c7fbaef70b`](https://etherscan.io/tx/0xe2aa11d71f1995103dac6063fb94487a499b1daca87278880ccc92c7fbaef70b)
- dUSD Redeemer role grant: [`0xe63a3b970e03733f4a1c7e250607b0e2d87069d3610e0dd55289c3d57c447380`](https://etherscan.io/tx/0xe63a3b970e03733f4a1c7e250607b0e2d87069d3610e0dd55289c3d57c447380)
- dUSD Redeemer role grant: [`0xd1ac1a1a3848a361e7f69a1742fe49e6e7098bb828807e87e0bea7ffcf89d7a7`](https://etherscan.io/tx/0xd1ac1a1a3848a361e7f69a1742fe49e6e7098bb828807e87e0bea7ffcf89d7a7)
- dUSD redemption pause: [`0x08855151feeee688ccb204ef975b0c2c45cd85a479afa0c5cd703ceef79421ad`](https://etherscan.io/tx/0x08855151feeee688ccb204ef975b0c2c45cd85a479afa0c5cd703ceef79421ad)
- Recovery batch (disable borrowing, flash loans; freeze reserves; set cbBTC LTV 0): [`0x6e8fed31f83cbd8453456bc68db580fae0f122984960808c70f32838057386fe`](https://etherscan.io/tx/0x6e8fed31f83cbd8453456bc68db580fae0f122984960808c70f32838057386fe)
- Non-cbBTC reserve posture change (unpaused + frozen + flash-loans-disabled): [`0x03165d0a90c084c87a524ac153e3da830334e4dfbeb5c5a39c74964e72e54c63`](https://etherscan.io/tx/0x03165d0a90c084c87a524ac153e3da830334e4dfbeb5c5a39c74964e72e54c63)
- dUSD redemption restore: [`0xa21ea9d30b563d05f093ce9132b7e2b48d7cec732ed843b5a4611e8328ac2e08`](https://etherscan.io/tx/0xa21ea9d30b563d05f093ce9132b7e2b48d7cec732ed843b5a4611e8328ac2e08)

## Closing

This exploit was a protocol-accounting failure triggered under a near-empty reserve condition. The remediation removes the supplier-side flash-loan index jump that made the attack possible, retires the compromised cbBTC reserve through a guarded wind-down path, and changes how reserves are listed to prevent thin-supply conditions from becoming exploitable.
