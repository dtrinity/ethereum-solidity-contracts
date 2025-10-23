# AUDIT PROGRAM

## Purpose
- Align subagents on scope, invariants, and risk themes captured in the design notes.
- Provide a living findings log that can be updated as modules are audited.
- Keep module context isolated so reviewers can work in parallel without stepping on each other.

## Shared Findings Log
- Keep one bullet per finding. Template: `- [status] ID:<id> Severity:<level> Module:<module> Owner:<handle> Summary:<one-liner> Notes:<optional extra context>`
- Example: `- [open] ID:OA-001 Severity:high Module:Oracle Aggregator Owner:alice Summary:Fallback wrapper can loop Notes:seeking reproduction`
- [open] ID:OA-101 Severity:medium Module:Oracle Aggregator V1.1 Owner:subagent-oa Summary:Manual decimals inputs in API3/composite wrappers can silently mis-scale prices Notes:`configureProxy` trusts caller-supplied `decimals` to build the scaling factor without validating it against the proxy output (contracts/oracle_aggregator/wrapper/API3WrapperV1_1.sol:55), and `configureComposite` does the same for both legs of the composite feed (contracts/oracle_aggregator/wrapper/ChainlinkRateCompositeWrapperV1_1.sol:58). A fat-fingered or malicious override shifts prices by orders of magnitude, bypassing the configured bounds/deviation checks that assume correct scaling and can leak inflated collateral values downstream. Recommend pulling decimals from the feed where available (e.g., `AggregatorV3Interface.decimals()`), or at minimum asserting the operator-provided factor matches an expected constant per asset.
- [none] ID:DS-000 Severity:info Module:dStable Core System Owner:subagent-ds Summary:No material findings Notes:n/a
- [none] ID:DV-000 Severity:info Module:dSTAKE V2 Vault Suite Owner:subagent-dv Summary:No material findings Notes:n/a
- [open] ID:DR-001 Severity:low Module:RewardClaimable & dSTAKE Rewards Owner:subagent-dr Summary:DLend reward manager leaves adapter allowance uncleared after compounding Notes:contracts/vaults/dstake/rewards/DStakeRewardManagerDLend.sol:197 approves the adapter with `forceApprove` but never zeroes it, leaving residual allowance contrary to the documented hygiene pattern and giving a compromised/misconfigured adapter a standing right to sweep any dStable that later lands on the manager.
- [open] ID:DR-002 Severity:info Module:RewardClaimable & dSTAKE Rewards Owner:subagent-dr Summary:DLend compounding path fully trusts the registered adapter to mint strategy shares to the collateral vault Notes:contracts/vaults/dstake/rewards/DStakeRewardManagerDLend.sol:200-212 only checks the adapter-reported share address and does not verify the vault’s balance delta (unlike the MetaMorpho manager), so loss of trust in the router/adapter registry directly exposes user deposits.
- [none] ID:VN-000 Severity:info Module:ERC20VestingNFT Program Owner:subagent-vn Summary:No material findings Notes:n/a

## Module Index
- [Oracle Aggregator V1.1](#oracle-aggregator-v11-contracts_oracle_aggregatordesignmd)
- [dStable Core System](#dstable-core-system-contractsdstabledesignmd)
- [dSTAKE V2 Vault Suite](#dstake-v2-vault-suite-contractsvaultsdstakedesignmd)
- [RewardClaimable & dSTAKE Rewards](#rewardclaimable--dstake-rewards-contractsvaultsrewards_claimabledesignmd--contractsvaults_dstakerewardsdesignmd)
- [ERC20VestingNFT Program](#erc20vestingnft-program-contractsvaultsvestingdesignmd)
- [Cross-Cutting Themes](#cross-cutting-themes)

## Cross-Cutting Themes
- Oracle surfaces power both minting and redemption logic for dStable and allocation logic for dSTAKE (contracts/oracle_aggregator/Design.md:93, contracts/dstable/Design.md:95, contracts/vaults/dstake/Design.md:37). Double-check price liveness propagation, failure handling, and `isAlive` semantics across these call sites.
- dStable supply invariants hinge on accurate AMO accounting and collateral valuation (contracts/dstable/Design.md:49, contracts/dstable/Design.md:72). Any shortfall in dSTAKE routing must reconcile with issuer assumptions about circulating supply (contracts/vaults/dstake/Design.md:37, contracts/vaults/dstake/Design.md:160).
- Reward managers pipe fees and incentives back into the dSTAKE collateral vault through adapters (contracts/vaults/rewards_claimable/Design.md:61, contracts/vaults/dstake/rewards/Design.md:1). Review allowance handling, adapter trust assumptions, and fee pathways alongside router dust-tolerance rules (contracts/vaults/dstake/Design.md:41, contracts/vaults/dstake/Design.md:112).
- Aggregator and wrappers always share one base currency/unit; decimals are enforced at the wrapper boundary. Oracle providers such as API3 proxies and custom rate adapters do **not** expose on-chain decimals, so we rely on governance-supplied configuration and cannot auto-discover scaling changes. Future work should codify one-time resolution and immutable scaling checks during onboarding.

## Oracle Aggregator V1.1 (`contracts/oracle_aggregator/Design.md`)

### Scope Snapshot
- Aggregator orchestrates primary and fallback wrappers, stores last-good prices, and exposes guardian freeze tooling (contracts/oracle_aggregator/Design.md:15).
- Wrapper base unifies heartbeat, deviation, and bounds checks for Chainlink, API3, and hard-peg adapters (contracts/oracle_aggregator/Design.md:18, contracts/oracle_aggregator/Design.md:21, contracts/oracle_aggregator/Design.md:28, contracts/oracle_aggregator/Design.md:30).
- Downstream consumers must treat `isAlive = false` as a failure signal and rely on last-good prices when both feeds fail (contracts/oracle_aggregator/Design.md:45, contracts/oracle_aggregator/Design.md:93).

### Key Interfaces & Dependencies
- Shared `IOracleWrapperV1_1` interface normalises return types (contracts/oracle_aggregator/Design.md:9).
- Wrapper deviation, heartbeat, and bounds enforcement split between base contracts and aggregator level checks (contracts/oracle_aggregator/Design.md:60, contracts/oracle_aggregator/Design.md:64).
- Role surface includes admins, oracle managers, and guardians with overlapping authorities on feed configuration and freezes (contracts/oracle_aggregator/Design.md:79).

### Attack Surfaces & Prompts
- Confirm fallback feeds cannot be configured to loop back to primaries (`primary == fallback`) and assess upgrade or misconfiguration risks (contracts/oracle_aggregator/Design.md:69).
- Inspect guardian freeze and manual price push flows for griefing or stale price release vectors (contracts/oracle_aggregator/Design.md:50).
- Validate heartbeat/deviation parameters are enforced consistently when wrappers revert vs. when aggregator stores last-good prices.
- Review role handover and revocation paths for time-of-check/time-of-use gaps.

### Checklist
- [ ] Walk through `getAssetPrice` to ensure LGP updates and `isAlive` propagation match design intent.
- [ ] Trace wrapper deployment patterns (Chainlink, API3, hard peg) for oracle precision, decimal math, and failure modes.
- [ ] Review admin and guardian controls for missing emit events or reversible actions.
- [ ] Evaluate aggregator storage layout for upgradability hazards and collision risks.

### Module Findings
- [open] ID:OA-101 Severity:medium Module:Oracle Aggregator V1.1 Owner:subagent-oa Summary:Manual decimals inputs in API3/composite wrappers can silently mis-scale prices Notes:`configureProxy` trusts caller-supplied `decimals` to build the scaling factor without validating it against the proxy output (contracts/oracle_aggregator/wrapper/API3WrapperV1_1.sol:55), and `configureComposite` does the same for both legs of the composite feed (contracts/oracle_aggregator/wrapper/ChainlinkRateCompositeWrapperV1_1.sol:58). A fat-fingered or malicious override shifts prices by orders of magnitude, bypassing the configured bounds/deviation checks that assume correct scaling and can leak inflated collateral values downstream. Recommend pulling decimals from the feed where available (e.g., `AggregatorV3Interface.decimals()`), or at minimum asserting the operator-provided factor matches an expected constant per asset.
    - Limitation: API3 proxies and custom rate providers do not surface decimals on-chain; until wrappers enforce immutability during initial configuration, governance must ensure scale matches the source documentation when wiring assets.

## dStable Core System (`contracts/dstable/Design.md`)

### Scope Snapshot
- Upgradeable ERC20 backed by collateral vaults, issuers, redeemers, and AMO tooling sharing a price oracle surface (contracts/dstable/Design.md:5, contracts/dstable/Design.md:14).
- Issuer enforces circulating supply <= collateral value and manages AMO supply adjustments (contracts/dstable/Design.md:49, contracts/dstable/Design.md:52).
- Redeemer handles per-asset fees and protocol exits while mirroring pause controls (contracts/dstable/Design.md:58, contracts/dstable/Design.md:64).
- AMO managers coordinate strategy allocations and peg deviation guards through `AmoDebtToken` (contracts/dstable/Design.md:33, contracts/dstable/Design.md:80).

### Key Interfaces & Dependencies
- `OracleAware` unifies valuation and heartbeat expectations across contracts (contracts/dstable/Design.md:91).
- Collateral vault abstractions manage allowlists and conversions via the oracle (contracts/dstable/Design.md:17, contracts/dstable/Design.md:95).
- Role surfaces span minting, redemption, collateral management, AMO supply, and fee collection (contracts/dstable/Design.md:106, contracts/dstable/Design.md:117).

### Attack Surfaces & Prompts
- Validate minting path guards around asset allowlists, pauses, and collateral valuation rounding.
- Review AMO increase/decrease flows for debt token parity and peg deviation enforcement (contracts/dstable/Design.md:80).
- Assess redemption fee logic for rounding, fee collector permissions, and potential sandwich windows.
- Ensure oracle downtime or `isAlive = false` propagates through issuer/redeemer safeguards.

### Checklist
- [ ] Simulate issuer invariants under extreme oracle deviations and collateral decimals.
- [ ] Inspect vault switching and collateral offboarding for trapped funds or stale allowlist entries.
- [ ] Review AMOManagerV2 bookkeeping for supply deltas and tolerance boundaries.
- [ ] Confirm pauser roles cannot permanently lock balances or bypass governance expectations.

### Module Findings
- [none] ID:DS-000 Severity:info Module:dStable Core System Owner:subagent-ds Summary:No material findings Notes:n/a

## dSTAKE V2 Vault Suite (`contracts/vaults/dstake/Design.md`)

### Scope Snapshot
- ERC4626 token delegates routing logic to `DStakeRouterV2` with collateral held in `DStakeCollateralVaultV2` (contracts/vaults/dstake/Design.md:7, contracts/vaults/dstake/Design.md:13, contracts/vaults/dstake/Design.md:20).
- Router manages deterministic allocation, solver flows, fee retention, collateral exchanges, and adapter registry (contracts/vaults/dstake/Design.md:20, contracts/vaults/dstake/Design.md:36).
- Adapters convert dStable into strategy shares with strict mint/burn invariants (contracts/vaults/dstake/Design.md:27).
- Operational playbooks cover onboarding, rebalancing, fee management, and offboarding (contracts/vaults/dstake/Design.md:120).

### Key Interfaces & Dependencies
- Router hooks invoked by token `_deposit`/`_withdraw` orchestrate all downstream actions (contracts/vaults/dstake/Design.md:37, contracts/vaults/dstake/Design.md:46).
- Fee reinvestment and solver entry points rely on router-only mint/burn helpers (contracts/vaults/dstake/Design.md:73, contracts/vaults/dstake/Design.md:90).
- Access control spans token, router, and collateral vault roles including strategy rebalancers and adapter managers (contracts/vaults/dstake/Design.md:104).
- Dust tolerance and health checks govern adapter interactions and slippage acceptance (contracts/vaults/dstake/Design.md:109, contracts/vaults/dstake/Design.md:112).

### Attack Surfaces & Prompts
- Review deterministic vault selection for griefing (e.g., starvation or dust accumulation) and verify reentrancy guards around solver flows.
- Validate adapter assumptions: mint/burn endpoints, preview math, allowance resets, and health check bypass attempts.
- Assess withdrawal fee plumbing and incentive payouts for rounding errors or incentive gaming.
- Inspect settlement shortfall tracking, router-held balances, and reinvestment cadence for accounting drift.

### Checklist
- [ ] Trace `handleDeposit` and `handleWithdraw` for asset custody, approvals, and revert propagation.
- [ ] Evaluate solver entry points for partial completion, dust leakage, and role gating.
- [ ] Inspect `reinvestFees`, surplus sweeps, and default strategy rotations for privilege escalation.
- [ ] Confirm collateral vault rescue paths cannot drain supported strategy shares.

### Module Findings
- [none] ID:DV-000 Severity:info Module:dSTAKE V2 Vault Suite Owner:subagent-dv Summary:No material findings Notes:n/a

## RewardClaimable & dSTAKE Rewards (`contracts/vaults/rewards_claimable/Design.md` & `contracts/vaults/dstake/rewards/Design.md`)

### Scope Snapshot
- `RewardClaimable` standardises fee handling, thresholds, and reward distribution for strategy managers (contracts/vaults/rewards_claimable/Design.md:21).
- `DStakeRewardManagerDLend` integrates with dLEND rewards controller, router adapters, and collateral vault before claiming rewards (contracts/vaults/rewards_claimable/Design.md:43, contracts/vaults/rewards_claimable/Design.md:65).
- Reward manager depends on router-provided adapter lookups and treasury fee caps (contracts/vaults/rewards_claimable/Design.md:61, contracts/vaults/rewards_claimable/Design.md:93).

### Key Interfaces & Dependencies
- Requires router default deposit strategy share and adapter registration to succeed (contracts/vaults/rewards_claimable/Design.md:61).
- Needs `setClaimer` approval on the dLEND rewards controller to pull incentives (contracts/vaults/dstake/rewards/Design.md:1, contracts/vaults/rewards_claimable/Design.md:74).
- Fee distribution splits treasury vs receiver and relies on `SafeERC20` semantics (contracts/vaults/rewards_claimable/Design.md:75).

### Attack Surfaces & Prompts
- Inspect `_processExchangeAssetDeposit` for approval hygiene, adapter pull trust, and failure handling.
- Validate treasury fee bounds, rounding, and event coverage for accounting.
- Confirm reward token lists cannot cause unbounded loops or denial-of-service.
- Review role separation between DEFAULT_ADMIN_ROLE and REWARDS_MANAGER_ROLE for misconfiguration risk.

### Checklist
- [ ] Walk through `compoundRewards` state machine with malformed adapter responses and token behaviour edge cases.
- [ ] Ensure adapter registry references cannot be swapped mid-transaction to redirect funds.
- [ ] Evaluate `exchangeThreshold` usage for griefing (extreme thresholds, bypass attempts).
- [ ] Confirm claimer approvals on external controllers are revocable and monitored.

### Module Findings
- [open] ID:DR-001 Severity:low Module:RewardClaimable & dSTAKE Rewards Owner:subagent-dr Summary:DLend reward manager leaves adapter allowance uncleared after compounding Notes:contracts/vaults/dstake/rewards/DStakeRewardManagerDLend.sol:197 approves the adapter with `forceApprove` but never zeroes it, leaving residual allowance contrary to the documented hygiene pattern and giving a compromised/misconfigured adapter a standing right to sweep any dStable that later lands on the manager.
- [open] ID:DR-002 Severity:info Module:RewardClaimable & dSTAKE Rewards Owner:subagent-dr Summary:DLend compounding path fully trusts the registered adapter to mint strategy shares to the collateral vault Notes:contracts/vaults/dstake/rewards/DStakeRewardManagerDLend.sol:200-212 only checks the adapter-reported share address and does not verify the vault’s balance delta (unlike the MetaMorpho manager), so loss of trust in the router/adapter registry directly exposes user deposits.

## ERC20VestingNFT Program (`contracts/vaults/vesting/Design.md`)

### Scope Snapshot
- 6-month vesting locker issuing NFTs that become soul-bound after maturity (contracts/vaults/vesting/Design.md:5, contracts/vaults/vesting/Design.md:11).
- Supports early redemption via burn and matured withdrawal that toggles non-transferable state (contracts/vaults/vesting/Design.md:17, contracts/vaults/vesting/Design.md:18).
- Owner controls max supply, deposit enablement, and minimum deposit thresholds (contracts/vaults/vesting/Design.md:22, contracts/vaults/vesting/Design.md:28, contracts/vaults/vesting/Design.md:33).

### Key Interfaces & Dependencies
- Uses `nonReentrant` modifiers around token transfers (contracts/vaults/vesting/Design.md:48).
- `matured` mapping with `_beforeTokenTransfer` hook prevents transfers post-vesting (contracts/vaults/vesting/Design.md:53, contracts/vaults/vesting/Design.md:55).
- Relies on OZ counter for sequential token IDs and stores vesting metadata per NFT (contracts/vaults/vesting/Design.md:65, contracts/vaults/vesting/Design.md:40).

### Attack Surfaces & Prompts
- Validate deposit disablement and max supply updates cannot lock user funds or break accounting.
- Review maturity checks for off-by-one timing, rounding, or timestamp manipulation.
- Ensure lack of emergency withdrawal aligns with operational playbooks and user expectations.
- Confirm metadata persistence and soul-bound enforcement survive upgrade scenarios (if upgradeable).

### Checklist
- [ ] Examine deposit, redeemEarly, and withdrawMatured for reentrancy, allowance, and state sync issues.
- [ ] Check admin-only setters for emit coverage and safeguarded ranges (min deposit, max supply).
- [ ] Validate tokenURI and metadata storage strategy if implemented later.
- [ ] Assess impact of disabling deposits on pending maturations and event logs.

### Module Findings
- [none] ID:VN-000 Severity:info Module:ERC20VestingNFT Program Owner:subagent-vn Summary:No material findings Notes:n/a
