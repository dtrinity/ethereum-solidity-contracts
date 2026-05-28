## Role Automation

### `.env` for grants, transfers, and revokes

Copy `.env.example` to `.env` (or use the repo’s `.env` template) and set **one** of:

- `MNEMONIC_MAINNET_DEPLOYER`, or
- `PK_MAINNET_DEPLOYER` (0x-prefixed hex; no `0x` duplication if your wallet exports with prefix)

The signer must match `deployer` in the manifest (`0x0f5e3D9AEe7Ab5fDa909Af1ef147D98a7f4B3022` on mainnet). Do not set both mnemonic and private key to the same wallet — Hardhat rejects duplicate keys.

Optional but **recommended for mainnet writes**: `ALCHEMY_API_KEY` or `ETHEREUM_MAINNET_RPC_URL`. The default public RPC is fine for read-only scans but often returns truncated JSON during `eth_getTransactionByHash` (Hardhat `HH110`) right after broadcast.

If `roles.grant` crashes with `HH110` after you confirm, check on-chain state before resubmitting — the grant may already be mined. Re-run with `--dry-run` first.

Verify locally:

```bash
yarn ts-node -e "require('dotenv/config');const {getEnvPrivateKeys}=require('./typescript/hardhat/named-accounts');const {ethers}=require('ethers');const pks=getEnvPrivateKeys('ethereum_mainnet');if(!pks.length)throw new Error('No mainnet key');console.log('Signer:',new ethers.Wallet(pks[0]).address);"
```

### Commands

- `make roles.scan`, `make roles.transfer ROLES_TRANSFER_ARGS="--dry-run-only"`, and `make roles.revoke` use the shared runners from `.shared`. By default they target the Sepolia manifest (`manifests/ethereum-testnet-roles.json`) so you can exercise the workflow without touching mainnet.
- When you are ready to operate on Ethereum mainnet, override the defaults inline (for example, `make roles.scan ROLES_NETWORK=ethereum_mainnet ROLES_MANIFEST=manifests/ethereum-mainnet-roles.json`). Populate the mainnet manifest with the production governance Safe details before attempting any transfers or revocations.

Mainnet hardening sequence (always dry-run first):

```bash
# 1) Grant DEFAULT_ADMIN_ROLE to governance where deployer still holds it
make roles.grant ROLES_NETWORK=ethereum_mainnet ROLES_MANIFEST=manifests/ethereum-mainnet-roles.json ROLES_GRANT_ARGS="--dry-run"

# 2) Transfer any Ownable contracts still owned by deployer (scan showed none on last run)
make roles.transfer ROLES_NETWORK=ethereum_mainnet ROLES_MANIFEST=manifests/ethereum-mainnet-roles.json ROLES_TRANSFER_ARGS="--dry-run"

# 3) Build Safe batch to revokeRole(deployer) for every remaining deployer-held role
make roles.revoke ROLES_NETWORK=ethereum_mainnet ROLES_MANIFEST=manifests/ethereum-mainnet-roles.json ROLES_REVOKE_ARGS="--dry-run"
```

Drop `--dry-run` and add `yes=1` on grant/transfer when ready to execute. `roles.revoke` prepares a Safe transaction bundle; governors still sign and execute in the Safe UI.
- The testnet manifest omits a Safe block on purpose—`make roles.revoke` will stop early until a Safe is provisioned. Pass explicit Safe metadata once the team elects to use a multisig on Sepolia.
- Shared reports are written to `reports/roles/` (ignored via `.gitignore`). Copy or rename the JSON outputs if you need to diff multiple runs.
