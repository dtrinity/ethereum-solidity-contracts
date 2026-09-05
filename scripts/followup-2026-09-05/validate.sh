#!/usr/bin/env bash
# Default is FULL validation. --offline explicitly means policy/models ONLY.
set -euo pipefail
cd "$(dirname "$0")/../.."
if [[ $# -gt 1 || ( $# -eq 1 && "$1" != "--offline" ) ]]; then
  echo "Usage: $0 [--offline]" >&2; exit 2
fi
for script in scripts/incident-2026-09-05/*.mjs scripts/followup-2026-09-05/*.mjs; do node --check "$script"; done
node scripts/incident-2026-09-05/check.mjs
node scripts/followup-2026-09-05/check.mjs
node --test scripts/incident-2026-09-05/policy.test.mjs scripts/followup-2026-09-05/followup.test.mjs
if [[ "${1:-}" == "--offline" ]]; then
  echo "OFFLINE ONLY: Solidity compilation, EVM/fuzz/fork validation NOT performed."
  exit 0
fi
if [[ ! -x node_modules/.bin/hardhat ]]; then
  echo "Missing pinned Hardhat dependencies. Restore submodules and run yarn install --immutable; no unpinned auto-install attempted." >&2
  exit 1
fi
if ! command -v forge >/dev/null; then
  echo "Missing reviewed Foundry toolchain. Full validation is BLOCKED; do not count offline success as release approval." >&2
  exit 1
fi
node_modules/.bin/hardhat clean
node_modules/.bin/hardhat compile
node scripts/incident-2026-09-05/check.mjs --compiled
node scripts/followup-2026-09-05/check.mjs --compiled
node_modules/.bin/hardhat test test/followup-2026-09-05/RewardSettlement.test.ts test/followup-2026-09-05/RoundingAndLifecycle.test.ts test/followup-2026-09-05/PeripheryAndOracle.test.ts test/dstake/RouterBackingConservation.test.ts test/dstake/RouterIncidentMigration.test.ts
# Real existing behavior remains mandatory. No automatic skips of failing tests.
node_modules/.bin/hardhat test
forge test --match-path 'foundry/test/dstake/**' -vv
# Mainnet-fork rehearsal is intentionally separate: needs freshly reviewed RPC,
# authority inventory, exact deployment artifacts, and an immutable migration plan.
echo "Local EVM suites finished. A pinned Ethereum-fork governance/settlement rehearsal and independent review are STILL REQUIRED."
