# Title
Full Refresh Of `ethereum-solidity-contracts` From Katana & Sonic Repos

# Summary
- Replace the current Ethereum contracts repo with the latest implementations from `../katana-solidity-contracts` (core protocols, deployment stack, tooling, tests).
- Integrate Sonic-exclusive enhancements (Odos adapter v2 stack, updated dLoop logic, debt AMO tooling, reward infrastructure, documentation).
- Ensure documentation and developer tooling reflect the migrated architecture; favour clean replacements over incremental merges because no contracts are live on Ethereum.

# Scope
- Solidity sources under `contracts/**`
- Deploy scripts (`deploy/**`) and TypeScript utilities (`typescript/**`, `scripts/**`)
- Shared libraries/config (`package.json`, `hardhat.config.ts`, configs, Makefile targets as needed)
- Test suite (`test/**`) and mocks
- Documentation (`docs/**`, `contracts/**/Design.md` and other design assets)

# Deliverables
- Updated contract set matching Katana (dSTAKE v2, oracle aggregator revamp, adapter libraries) plus Sonic additions (Odos v2, dLoop shared logic, debt AMO components).
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
  - [ ] Migrate oracle aggregator to the Katana layout (core contract, API3 + Chainlink wrappers, interfaces, README updates) and delete legacy v1.1 files.
  - [ ] Import Sonic’s Odos adapter v2 stack and associated helpers; align dLoop contracts with the new swap logic.
  - [ ] Update rewards contracts to include Katana’s MetaMorpho manager and Sonic’s shared `RewardClaimable`.
  - [ ] Port Sonic’s debt AMO suite (contracts, interfaces, supporting libraries) and prune deprecated Ethereum-only AMO logic.
- [ ] **Deploy & tooling**
  - [ ] Mirror Katana/Sonic deployment scripts, removing obsolete v1.1 workflows, and ensure network/task names remain accurate for Ethereum.
  - [ ] Refresh TypeScript support files (`typescript/**`, `config/**`) to match upstream expectations.
- [ ] **Tests**
  - [ ] Replace dSTAKE tests with Katana’s suite; integrate new adapter, oracle, dLoop, reward, and dPOOL tests from Sonic.
  - [ ] Verify Hardhat compilation and run the full test suite locally.
- [ ] **Documentation**
  - [ ] Overwrite design docs with the latest versions (dSTAKE, rewards, dLoop, dPOOL, rewards_claimable, vesting).
  - [ ] Update repository-level docs (`docs/manual-explorer-verification.md`, any deployment guides) for new scripts/contracts.
- [ ] **Validation**
  - [ ] Run `yarn lint`, `yarn build`, and all relevant Hardhat tests.
  - [ ] Document any Ethereum-specific follow-up work after the refresh (e.g., deployment configuration tasks, audit diffs).

# Lessons Learned (Environment Prep)
- Copy upstream assets verbatim when possible; manual retyping of long scripts introduced avoidable typos and wasted cycles.
- Ensure prerequisite configs (e.g. `config/networks/katana_*.ts`) land before running migrated scripts to avoid missing-module failures.
- Smoke-test new utilities against existing deployments (`yarn gas-estimate -n ethereum_testnet`) immediately so peer dependencies and runtime expectations surface early.
