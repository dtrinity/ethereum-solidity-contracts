# dTRINITY Ethereum Contracts

This repository contains the code and tooling for dTRINITY on Ethereum.

Website: https://dtrinity.org/

Documentation: https://docs.dtrinity.org/

## Deployment Safety

- Never use `npx hardhat deploy --reset` on persistent/shared networks (especially `ethereum_mainnet`).
- `--reset` clears `deployments/<network>/` state and can break Safe rollout sequencing.
- Re-run specific rollout steps by clearing only the targeted key in `deployments/<network>/.migrations.json`, then re-running that tag without `--reset`.

## Shared role automation

The repository now uses the shared Hardhat tooling that powers `make roles.*`:

- `make roles.scan` – report current AccessControl and ownership status (defaults to Sepolia until mainnet manifests are finalized)
- `make roles.transfer ROLES_TRANSFER_ARGS="--dry-run-only"` – rehearse role hand-offs safely
- `make roles.revoke` – queues Safe revocations once the governance Safe metadata is provided

Manifests live in `manifests/`. Update `manifests/ethereum-mainnet-roles.json` with the production Safe address before running against mainnet. Testnet runs rely on the deployer EOA and omit Safe metadata by design.
