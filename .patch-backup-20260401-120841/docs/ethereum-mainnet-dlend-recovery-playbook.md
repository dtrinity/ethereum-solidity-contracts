# Ethereum Mainnet dLEND Recovery Continuation Playbook
Date: 2026-03-23

This is the continuation from the prior recovery playbook. It starts **after** the prior containment / repay work and covers the remainder of the rollout:

1. upgrade dLEND to the minimal Pool remediation,
2. sanitize and drop `cbBTC` in the same Safe batch,
3. run final sanity checks from the new post-drop state,
4. unfreeze the remaining markets in a controlled way.

## Starting assumption

Do not start this continuation unless the earlier recovery posture is already true:

- attacker `dUSD` variable debt is `0`
- non-`cbBTC` reserves are in contained recovery posture
- `cbBTC` is still quarantined (`paused + frozen + borrowing disabled + stable borrowing disabled + flash loans disabled`)
- `cbBTC` holder set for sanitize is ready and exhaustive at execution time

The incident root cause remains the same: thin-supply reserve accounting plus flash-loan-premium-driven `liquidityIndex` inflation. The public exploit path is only durably closed once the Pool remediation is live. The exploit position on `cbBTC` also remains economically abnormal until that reserve is explicitly retired. See `root-cause-preliminary-2026-03-17.md` and the existing repo recovery playbook for the rationale.

## One repo improvement before rollout

Apply the small compatibility patch in `dlend-phase3-cbbtc-drop-compat.patch` before starting.

Reason:

- `deploy/32_dlend_recovery_mainnet/04_preflight_ethereum_mainnet_dlend_recovery_phase3_safe.ts`
- `scripts/recovery/assert-phase3.ts`

still assume `cbBTC` is listed and quarantined during Phase 3. If you drop `cbBTC` **before** Phase 3, those checks will fail even though the new state is the intended one.

The patch makes Phase 3 accept either:

- `cbBTC` still listed and quarantined, or
- `cbBTC` already delisted

while still forbidding `cbBTC` from every Phase 3 resume list.

## Rollout plan

## Phase A — Deploy remediation implementations

This is the deployer-EOA step only. It does **not** change live Pool behavior yet.

Run:

```bash
export RPC_URL='https://ethereum-rpc.publicnode.com'
export PRIVATE_KEY='0x...'

yarn recovery:remediation:deploy-impls
```

Expected deployments:

- `FlashLoanLogic_Remediation`
- `PoolImpl_Remediation`
- `SanitizableAToken_cbBTC_Impl`

The intended Pool change is still the minimal one:

- remove supplier-side `liquidityIndex` inflation during flash-loan repayment
- route the entire flash-loan premium to treasury accrual

## Phase B — Preflight the combined Pool-upgrade + cbBTC-drop batch

This batch is the main state transition. It will:

1. upgrade the Pool proxy to the patched implementation,
2. mint any pending `cbBTC` treasury accrual,
3. upgrade only the `cbBTC` aToken proxy to `SanitizableAToken`,
4. burn all remaining `cbBTC` aToken balances,
5. clear user-config bitmap bits for those holders,
6. rescue all underlying `cbBTC` to the designated recovery wallet,
7. deactivate and drop the `cbBTC` reserve.

Required env:

```bash
export USE_SAFE='true'
export CBBTC_SANITIZE_ACK='true'
export REMEDIATION_SKIP_POOL_UPGRADE='false'
export CBBTC_SANITIZE_RECOVERY_WALLET='0x...'
export CBBTC_SANITIZE_HOLDERS_JSON='["0x...","0x..."]'
```

Run:

```bash
yarn recovery:safe:cbbtc-sanitize:preflight
```

Preflight should pass all of these:

- Safe has the needed roles / ownership
- expected patched Pool implementation is available
- `cbBTC` is still paused, frozen, non-borrowable, flash-loans-disabled
- `cbBTC` stable debt and variable debt supply are zero
- attacker `dUSD` variable debt is zero
- holder set covers post-`mintToTreasury` scaled supply
- treasury is included in the holder set if `mintToTreasury([cbBTC])` will mint to it

If preflight fails on holder coverage, rebuild `CBBTC_SANITIZE_HOLDERS_JSON` from the `cbBTC` aToken `Transfer` history and re-run the preflight. Do not proceed on a guessed holder set.

## Phase C — Execute the combined Safe batch

Run:

```bash
yarn recovery:safe:cbbtc-sanitize:batch
```

Target batch order:

1. `PoolAddressesProvider.setPoolImpl(PoolImpl_Remediation)`
2. `Pool.mintToTreasury([cbBTC])`
3. `PoolConfigurator.updateAToken(cbBTC -> SanitizableAToken_cbBTC_Impl)`
4. `SanitizableAToken.forceBurnAllAndVerifyZero(holders)`
5. `Pool.clearReserveUserConfiguration(cbBTC, holders)`
6. `SanitizableAToken.rescueAllUnderlying(recoveryWallet)`
7. `PoolConfigurator.setReserveActive(cbBTC, false)`
8. `PoolConfigurator.dropReserve(cbBTC)`

Do not split this into separate Safe batches unless there is a hard operational reason. The point is to move directly from “quarantined toxic reserve” to “retired reserve on a patched Pool”.

## Phase D — Post-batch sanity checks

Before any market unfreeze, verify the new post-drop state.

### D1. Pool proxy really points to the patched implementation

Check the Pool proxy EIP-1967 implementation slot against the deployed `PoolImpl_Remediation` address.

Pseudocode:

```ts
const slot = "0x360894A13BA1A3210667C828492DB98DCA3E2076CC3735A920A3CA505D382BBC";
const currentImpl = readStorage(provider, poolProxy, slot).slice(-40);
assert(currentImpl == deployments["PoolImpl_Remediation"].address);
```

### D2. `cbBTC` is actually gone from the active reserve list

Read `Pool.getReservesList()` and verify `cbBTC` is absent.

### D3. The rescue leg completed

Verify:

- `CBBTC_SANITIZE_RECOVERY_WALLET` received the rescued `cbBTC` underlying
- the live `cbBTC` aToken proxy has zero total supply
- `forceBurnAllAndVerifyZero()` did not leave residual holders

### D4. No unintended feature re-enable happened on surviving reserves

For every active non-`cbBTC` reserve, verify:

- `borrowingEnabled == false`
- `stableRateBorrowingEnabled == false`
- `flashLoanEnabled == false`

This should still be true immediately after the sanitize batch. That batch should not touch the surviving reserves’ live posture.

### D5. Attacker debt is still zero

Verify the attacker’s `dUSD` variable debt is still zero.

If any of D1–D5 fail, stop here. Do not enter the unfreeze phase.

## Phase E — Controlled unfreeze of remaining markets

This phase should only unfreeze / reopen supply-side usage first.

Recommended first-live posture:

- unpaused
- unfrozen
- borrowing still disabled
- stable borrowing still disabled
- flash loans still disabled

That means:

- `PHASE3_ENABLE_BORROWING_RESERVES_JSON='[]'`
- `PHASE3_ENABLE_STABLE_BORROWING_RESERVES_JSON='[]'`
- `PHASE3_ENABLE_FLASHLOAN_RESERVES_JSON='[]'`

Set the mandatory acknowledgements:

```bash
export PHASE3_REMEDIATION_ACK='true'
export PHASE3_HEALTHCHECK_ACK='true'
export PHASE3_MONITORING_ACK='true'
```

Set the resume set to the active non-`cbBTC` reserves you actually want to unfreeze:

```bash
export PHASE3_RESUME_RESERVES_JSON='["0x...","0x..."]'
export PHASE3_ENABLE_BORROWING_RESERVES_JSON='[]'
export PHASE3_ENABLE_STABLE_BORROWING_RESERVES_JSON='[]'
export PHASE3_ENABLE_FLASHLOAN_RESERVES_JSON='[]'
```

If some reserves are still thin, Phase 3 will warn or block unless you explicitly acknowledge it. For a supply-only unfreeze with borrowing/flash loans still disabled, using:

```bash
export PHASE3_ALLOW_LOW_SUPPLY_RESUMES='true'
```

is acceptable **only after** reserve-by-reserve review.

Run:

```bash
yarn recovery:safe:phase3:preflight
yarn recovery:safe:phase3:batch
yarn recovery:assert:phase3
```

With the compatibility patch applied, the preflight and assert should accept the new state where `cbBTC` has already been dropped.

## Recommended first rollout shape

The conservative rollout I would use is:

1. deploy remediation implementations
2. combined Safe batch: upgrade Pool + sanitize/drop `cbBTC`
3. post-batch sanity checks
4. unfreeze surviving markets with:
   - borrowing off
   - stable borrowing off
   - flash loans off
5. observe
6. handle any later borrowing / flash-loan reopen in a separate decision

## Abort conditions

Abort and remain in the contained posture if any of the following happen:

- cbBTC sanitize preflight fails on holder coverage
- Pool implementation check does not match the patched impl after the Safe batch
- `cbBTC` still appears in `getReservesList()`
- any surviving reserve has borrowing or flash loans unexpectedly enabled before unfreeze
- attacker `dUSD` variable debt is nonzero
- the patched Phase 3 preflight or assert fails

## Minimal operator note

This continuation intentionally does **not** include:

- bridge remediation
- dSTAKE changes
- a second-stage borrowing reopen
- flash-loan re-enable

It is only the shortest safe path from the prior contained posture to:

- patched dLEND core,
- retired toxic `cbBTC` reserve,
- surviving markets unpaused and unfrozen, but still not borrow/live-risk-opened.
