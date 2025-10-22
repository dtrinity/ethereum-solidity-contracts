# Title
Full Refresh Of `ethereum-solidity-contracts` From Katana & Sonic Repos

# Summary
- Replace the current Ethereum contracts repo with the latest implementations from `../katana-solidity-contracts` (core protocols, deployment stack, tooling, tests).
- Integrate Sonic-exclusive enhancements (Odos adapter v2 stack for dStake, debt AMO tooling, reward infrastructure, documentation) while deferring dLoop to a later migration wave.
- Ensure documentation and developer tooling reflect the migrated architecture; favour clean replacements over incremental merges because no contracts are live on Ethereum.

# Migration Snapshot
- **Keep (Ethereum)** Oracle Aggregator v1.1 suite and existing deployment scaffolding; treat these contracts/tests as the canonical source of truth.
- **Adopt (Katana)** Updated common libraries, dSTAKE v2 stack, deployment/typescript scaffolding, and any refreshed shared utilities compatible with Ethereum.
- **Adopt (Sonic)** Odos adapter v2 flow for dStake integrations, debt AMO contracts, and `RewardClaimable` wiring needed for the rewards stack.
- **Defer (Sonic dLoop)** All leveraged vault (dLoop) contracts, scripts, and tests are removed from this refresh; revisit once launch plans solidify.
- **Shared Tools** Continue syncing `.shared/` subtree via `yarn workspace @dtrinity/shared-hardhat-tools shared:update`; do not edit the subtree directly.

# Scope
- Solidity sources under `contracts/**`
- Deploy scripts (`deploy/**`) and TypeScript utilities (`typescript/**`, `scripts/**`)
- Shared libraries/config (`package.json`, `hardhat.config.ts`, configs, Makefile targets as needed)
- Test suite (`test/**`) and mocks
- Documentation (`docs/**`, `contracts/**/Design.md` and other design assets)

# Deliverables
- Updated contract set matching Katana (dSTAKE v2, oracle aggregator revamp, adapter libraries) plus Sonic additions (Odos v2 adapters for dStake, debt AMO components), excluding dLoop.
- Harmonised deployment and utility scripts compatible with the refreshed contracts.
- Passing TypeScript compile, Hardhat build, lint, and test runs.
- Revised design docs capturing the new architecture and removing v1 references.

# Implementation Checklist
- [x] **Environment prep**
  - [x] Sync `package.json`, `yarn.lock`, and config files with upstream changes (retain Ethereum RPC/network entries as required).
  - [x] Bring in new scripts (`scripts/mainnet-gas-estimation.ts`, helper shell scripts) and update `Makefile` targets if necessary.
- [ ] **Contracts**
  - [x] Copy Katana’s updated common libraries (`SupportsWithdrawalFee`, `WithdrawalFeeMath`, rescue helpers) and remove superseded versions.
  - [x] Replace dSTAKE v1 with Katana’s v2 suite (token/router/collateral vault, adapters, interfaces, libraries, mocks).
  - [x] Align Katana oracle aggregator updates while preserving Ethereum’s v1.1 stack (core contract, API3 + Chainlink wrappers, interfaces, README updates).
  - [x] Import Sonic’s Odos adapter v2 stack and associated helpers for dStake flows; drop dLoop contracts from scope pending future launch.
  - [x] Update rewards contracts to include Katana’s MetaMorpho manager and Sonic’s shared `RewardClaimable`.
  - [x] Port Sonic’s debt AMO suite (contracts, interfaces, supporting libraries) and prune deprecated Ethereum-only AMO logic.
- [x] **Deploy & tooling**
  - [x] Mirror Katana/Sonic deployment scripts while keeping Ethereum’s v1.1 oracle flows intact; ensure network/task names remain accurate for Ethereum.
  - [x] Refresh TypeScript support files (`typescript/**`, `config/**`) to match upstream expectations.
- [x] **Tests**
  - [x] Replace dSTAKE tests with Katana’s v2 suite; integrate new adapter, oracle, and reward tests from Sonic (dLoop suites removed).
  - [x] Verify Hardhat compilation and run the full test suite locally.
- [x] **Documentation**
  - [x] Overwrite design docs with the latest versions (dSTAKE, rewards, rewards_claimable, vesting); note dLoop removal in roadmap docs. _(Katana originals copied for dSTAKE/rewards/vesting; rewards_claimable sourced from Sonic; no Ethereum-specific deltas required.)_
  - [x] Update repository-level docs (`docs/manual-explorer-verification.md`, any deployment guides) for new scripts/contracts. _(No changes needed beyond existing Katana copies; Ethereum instructions already accurate.)_
- [x] **Validation**
  - [x] Run `make lint` (shared lint suite) and `make test` (full Hardhat battery); repo lacks dedicated `yarn lint`/`yarn build` scripts.
  - [x] Document any Ethereum-specific follow-up work after the refresh (e.g., deployment configuration tasks, audit diffs).

# Lessons Learned (Environment Prep)
- Copy upstream assets verbatim when possible; manual retyping of long scripts introduced avoidable typos and wasted cycles.
- Ensure prerequisite configs (e.g. `config/networks/katana_*.ts`) land before running migrated scripts to avoid missing-module failures.
- Smoke-test new utilities against existing deployments (`yarn gas-estimate -n ethereum_testnet`) immediately so peer dependencies and runtime expectations surface early.

# Progress Notes (Rewards Stack)
- Ported MetaMorpho reward manager, shared `RewardClaimable`, and morpho mocks from Katana/Sonic; added canonical MetaMorpho reward tests to exercise the claim/compound path while leaving the oracle v1.1 wiring untouched.
- Ported the Sonic debt AMO suite (AmoManagerV2, AmoDebtToken, deployment scripts, and TypeScript helpers), wired new hard peg oracles, and synced dStake reward tooling so deployment + unit specs pass under the localhost fixture.

# Progress Notes (dLoop Deferral)
- Removed all dLoop Solidity sources, tests, deployments, and CLI scripts to keep the Ethereum refresh focused on dSTAKE, dLEND, and debt AMO workstreams; future reintroduction can lift directly from Katana/Sonic when launch-ready.
- Pruned related Hardhat overrides, deploy IDs, ESLint globs, TypeChain/artifact outputs, and ticket references so tooling no longer assumes dLoop assets exist.

# Progress Notes (Deploy & Tooling)
- `make lint`, `make test`, and `make deploy` succeed against the refreshed scripts/configs; deployment tags provision sdUSD/sdETH stacks end-to-end while preserving the oracle v1.1 wiring.
- TypeScript helpers and network configs match Katana/Sonic baselines (with Ethereum-specific addresses), and no additional `.shared/` sync is required.

# Progress Notes (Tests)
- dSTAKE suites now iterate over sdUSD and sdETH using shared fixtures, exercising router/token/reward paths alongside Sonic’s adapter wiring; no further porting needed.
- Latest `make test` (646 passing / 12 pending) and `yarn hardhat compile` confirm the migrated stack compiles and runs cleanly with oracle v1.1 preserved.

# Progress Notes (Documentation)
- Copied dSTAKE, rewards, and vesting design docs wholesale from Katana and pulled rewards_claimable notes from Sonic; no Ethereum-only edits required after validation.

# Progress Notes (Validation)
- Ran `make lint` (shared Prettier/ESLint/Solhint suite) and `make test` (Hardhat + deployment fixture battery); both pass with oracle v1.1 stack intact.

# Lessons Learned (Rewards Stack)
- MetaMorpho flows rely on URD-driven balances—tests must stage claims against the manager contract directly to avoid regressions like the collateral vault merkle bypass.
# Lessons Learned (Debt AMO)
- Hard peg wrappers in OracleAggregator v1.1 no longer take an initial price; remember to configure pegs post-deployment when standing up local fixtures.
- dStake V2 splits router and collateral vault roles with new adapter plumbing; scripts/tests must prefer the `*_V2` contracts and strategy share APIs.

# Lessons Learned (dLoop Deferral)
- Removing dormant product lines early reduces friction while stabilising dStake; re-enable by re-importing Katana/Sonic sources and restoring the deleted deployment tags once the go-to-market plan revives dLoop.
