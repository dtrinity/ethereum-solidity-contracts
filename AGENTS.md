# Repository Guidelines

## Project Structure & Module Organization
- `contracts/` contains Solidity sources. Platform-specific modules live under `vaults/`, with shared utilities in `common/`.
- `scripts/`, `config/`, and `typescript/` hold Hardhat deploy scripts, network configs, and TS helpers.
- `.shared/` is a Git subtree pointing to `shared-hardhat-tools`; treat it as read-only here and sync via `yarn workspace @dtrinity/shared-hardhat-tools shared:update` in the root repo.
- `test/` mirrors contract layout for unit/e2e specs; `contracts/testing/` exposes on-chain harnesses used by the tests.

## Build, Test, and Development Commands
- `yarn install` resolves dependencies for Hardhat and TS tooling.
- `yarn hardhat compile` compiles Solidity sources and refreshes typechain bindings.
- `yarn gas-estimate -n <network>` aggregates deployment gas usage from `deployments/<network>/`.
- Many CI helpers live in `.shared`; run them via `yarn workspace @dtrinity/shared-hardhat-tools <script>` if needed.

## Coding Style & Naming Conventions
- Solidity targets `pragma ^0.8.20`; prefer explicit imports and OZ patterns (e.g., `SafeERC20`).
- Use CamelCase for contracts/libraries, CapitalizedWords for events, and snake_case for storage slots when required.
- TypeScript follows strict mode; keep files under `typescript/` and `config/` in ES2020 style.
- Format Solidity with Prettier (`yarn prettier --write "contracts/**/*.sol"`) and align with existing lint rules.

## Testing Guidelines
- Hardhat/TypeScript tests sit under `test/`; name suites after the contract (`DStakeRouterV2.test.ts`).
- On-chain harnesses live in `contracts/testing/` to exercise edge cases; reuse existing fixtures before adding new ones.
- Run focused specs via `yarn hardhat test test/<path>`; ensure deploy smoke tests run against forked networks when modifying deploy scripts.

## Commit & Pull Request Guidelines
- Commit messages follow `<type>: <summary>` (e.g., `feat: migrate dstake to router/token v2`).
- Bundle related contract + script changes; update docs/design notes (`Design.md`) when behavior changes.
- PRs should describe scope, list testing commands executed, and reference tracking tickets/issues.
- Attach screenshots or call out deployment impacts when touching UI-facing scripts or gas tooling.
