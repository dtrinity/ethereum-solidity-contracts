# Test Ticket: Adapter NAV Spoof

## Objective
Detect and block adapters that over- or under-report strategy NAV, preventing mint/redeem mispricing and allocation drift.

## Scope
- `contracts/vaults/dstake/DStakeCollateralVaultV2.sol`
- Adapter interfaces (trusted vs malicious)
- New tests under `test/amo/AdapterNavSpoof.test.ts`

## Test Outline
1. Deploy router with collateral vault and register two adapters: honest + malicious (returns inflated NAV).
2. Trigger router sync; verify NAV sanity checks clamp or reject spoofed values.
3. Attempt deposits/withdrawals routed through malicious adapter; expect revert with explicit reason.
4. Compare adapter-reported NAV to oracle-derived reference and record mismatch metric.
5. Invariant: fuzz adapter NAV values ensuring deviation beyond tolerance toggles mitigation state.

## Fixtures & Tooling
- Malicious adapter mock returning configurable NAV.
- Reference oracle/mock returning ground-truth price.
- Telemetry hook capturing nav mismatches.

## Deliverables
- Spec demonstrating mitigation behaviour.
- Fuzz harness verifying tolerance enforcement.
- Ops note describing monitoring of `nav_mismatch_count`.
