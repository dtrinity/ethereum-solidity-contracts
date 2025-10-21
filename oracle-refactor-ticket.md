# Ticket: Replace Legacy Oracle Stack with V1.1 Implementation

## Context
We now have a new safety-focused oracle stack (`OracleAggregatorV1_1`, `OracleBaseV1_1`, and the V1.1 wrapper hierarchy). The repository still contains the legacy oracle aggregator (`OracleAggregator.sol` and associated Redstone wrappers, chainlink composite helpers, etc.), along with deployment scripts, tests, config entries, and artifacts that reference the old contracts. We need to perform a full cleanup and migration so the codebase only maintains the V1.1 stack.

## Goals
- Remove all legacy oracle aggregator contracts, wrappers, utilities, mocks, and tests that reference the old stack.
- Update configs, deployments, scripts, and documentation so they reference only the V1.1 contracts.
- Ensure the new hardening features (guardian control, deviation gating, heartbeat overrides, etc.) are fully wired through deployments and integration points.

## Tasks
1. **Identify legacy assets**
   - Catalog contracts under `contracts/oracle_aggregator/` and `contracts/testing/oracle/` that belong to the old Redstone/Chainlink wrappers, hard peg, and aggregator.
   - Locate additional legacy helper contracts (`ChainlinkCompositeAggregator`, `ChainlinkDecimalConverter`, threshold utilities) and note their dependencies.

2. **Prune legacy contracts**
   - Delete the legacy contracts and interfaces from `contracts/oracle_aggregator` and adjust SPDX headers/imports accordingly.
   - Remove unused mocks in `contracts/testing/oracle` that targeted the old stack.

3. **Update TypeScript configs and scripts**
   - Rewrite `config/networks/*.ts` oracle configuration objects to reference the new V1.1 wrapper deployment IDs.
   - Update deployment scripts under `deploy/` that currently deploy Redstone wrappers; replace with scripts that deploy/configure `ChainlinkFeedWrapperV1_1`, `API3WrapperV1_1`, `ChainlinkRateCompositeWrapperV1_1`, `HardPegOracleWrapperV1_1`, and `OracleAggregatorV1_1`.
   - Remove or rewrite scripts that rely on thresholding utilities tied to the legacy design (e.g., `03_setup_*_redstone_oracle_wrappers.ts`).

4. **Adjust tests**
   - Remove legacy tests (e.g., `test/oracle_aggregator/RedstoneChainlink*.ts`, fixtures that point to legacy deployments).
   - Ensure the new test suite (`OracleAggregatorV1_1.test.ts`) covers required scenarios; migrate any useful assertions from the old tests.

5. **Deployment artifacts**
   - Remove legacy JSON artifacts in `deployments/` (local/testnet/mainnet) that reference the old contracts.
   - Generate fresh deployment scripts or documentation for using the new wrappers (or note if this will be handled separately).

6. **Docs & README**
   - Update relevant docs (top-level or subdirectory README) once the legacy stack is removed, ensuring references point at the V1.1 contracts only.

7. **Validation**
   - Run `yarn hardhat test` (or the appropriate suite) to confirm contract compilation and tests succeed after the cleanup.
   - Spot-check TypeChain generation if applicable.

## Deliverables
- Repository free of legacy oracle aggregator contracts and references.
- Deployment/config/test infrastructure exclusively targeting `OracleAggregatorV1_1` and the new wrapper hierarchy.
- Test suite passing with only V1.1 oracle components.
- Documentation reflecting the new architecture.

Please claim this ticket and work through the above tasks. Reach out if you discover unexpected dependencies that were not covered in the outline.
