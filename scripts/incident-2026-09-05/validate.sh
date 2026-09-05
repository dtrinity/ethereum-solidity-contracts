#!/usr/bin/env bash
# Run from a FULL checkout with its pinned dependencies and submodules installed.
set -euo pipefail
cd "$(dirname "$0")/../.."
node --check scripts/incident-2026-09-05/ops.mjs
node scripts/incident-2026-09-05/check.mjs
node --test scripts/incident-2026-09-05/policy.test.mjs
npx hardhat compile
node scripts/incident-2026-09-05/check.mjs --compiled
# New self-contained integration fixtures first; do not confuse offline policy
# tests with these actual Solidity/EVM tests.
npx hardhat test test/dstake/RouterBackingConservation.test.ts test/dstake/RouterIncidentMigration.test.ts
# Existing dSTAKE behavior is also a release gate, including legacy mock fidelity.
tests=()
while IFS= read -r -d '' file; do tests+=("$file"); done < <(find test/dstake -type f -name '*.ts' ! -name 'fixture.ts' -print0)
npx hardhat test "${tests[@]}" test/amo/AdapterNavSpoof.test.ts test/amo/IdleVaultRewardSweep.test.ts
forge test --match-path 'foundry/test/dstake/**' -vv
