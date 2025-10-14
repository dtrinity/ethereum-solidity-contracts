## Role Automation

- `make roles.scan`, `make roles.transfer ROLES_TRANSFER_ARGS="--dry-run-only"`, and `make roles.revoke` use the shared runners from `.shared`. By default they target the Sepolia manifest (`manifests/ethereum-testnet-roles.json`) so you can exercise the workflow without touching mainnet.
- When you are ready to operate on Ethereum mainnet, override the defaults inline (for example, `make roles.scan ROLES_NETWORK=ethereum_mainnet ROLES_MANIFEST=manifests/ethereum-mainnet-roles.json`). Populate the mainnet manifest with the production governance Safe details before attempting any transfers or revocations.
- The testnet manifest omits a Safe block on purpose—`make roles.revoke` will stop early until a Safe is provisioned. Pass explicit Safe metadata once the team elects to use a multisig on Sepolia.
- Shared reports are written to `reports/roles/` (ignored via `.gitignore`). Copy or rename the JSON outputs if you need to diff multiple runs.
