# Ethereum sdUSD paused replacement deployment — 2026-09-07

Source: `1a81befd612c001eddfb6b602c11603d2e009eba` (merged #54).
Chain: Ethereum mainnet (1).
Deployer: `0x31337fa76c6d4b485568b1Ac4A3498ba7dD81168`.
Reviewed deployment SHA-256: `d58f668d69bf5574acb20bfd0b9f844a753032d6b370fa5eee669d6c13342f3d`.

This is deployment evidence, NOT evidence that migration or reopening executed.
No live Safe/Timelock operation was submitted, signed, or executed by this rollout.

| Component | Address | Runtime bytes | CREATE transaction |
| --- | --- | ---: | --- |
| DStakeRouterV2Incident | `0x6D4A26fe926E88fEE41A9fDdEdA3b50bf98F1DDb` | 24036 | `0xd2008739965c817fc24f7dea6daedb125c9fef0c51051fd3e2a3105528c117dd` |
| DStakeRouterV2GovernanceModule | `0x2fd26c2CBfE0674776a1fF00Daa8CfFeFCc0C88c` | 13368 | `0x14a39bda104c46f7cc2cd4e725e044e580c8c45cbd3cfdf9a923bb4a1d229ad7` |
| DStakeRouterV2RebalanceModule | `0xD15CCBE652c0c29B1D544a26F902f21dfC5B4F05` | 7467 | `0x490b275a8110b48cc54349a4cacca3a19082a3ee2313beb8a6132569ecf66c45` |
| DStakeRouterMigrationGuard | `0x677A158660AA63166EBb9Ed3778E985b0663A2B5` | 14008 | `0x3955e503f2cface4d1c8b05ff0aade443c88243f1c74f6800e9e47818b2e06e9` |

## Deployment and verification

- `deployment.json`: complete live journal, all 25 CREATE/bootstrap receipts, runtime code hashes and compiler-input digests. `complete: true`, `localFork: false`.
- `live-verification.json`: independent receipt/calldata/from/to/nonce/value/chain/fee checks and block-pinned code/role/pointer reads at block 25927742.
- All six privileged router roles belong to Timelock `0x18CB0EB73D953eD20F2157ce6bDE2A85E30e681B`; deployer holds none.
- Replacement router is paused. sdUSD still points to old router `0xdD26C236ec95d03DDf3cB67b7f54864719E9Be5a`.
- Max fee 2 gwei; priority 0.05 gwei. Actual total receipt gas cost: 0.001650026940532334 ETH.

## Mandatory pre-CREATE rehearsal

`fork-pin.json` records Ethereum block 25927641, hash `0x51b634c714e80c0359d7d9481bad5de1cb8bb9d3f1ca5534ec974de5b42b8743`.
`fork-simulation.json` is explicitly LOCAL evidence from `ops.mjs simulate --local-fork --execute`, not a mainnet receipt.
The loopback Hardhat chain was 31337; the rehearsal warped 86401 seconds for the real 86400-second Timelock delay. Guard and contained-state postconditions passed. Idle received legacy router cash via 100% Idle `setVaultConfigs` plus `reinvestFees`; migration contains no `setReserveFreeze` call.

The original Hardhat/ethers combination omitted impersonated addresses from `eth_accounts`; a local-only JsonRpcSigner compatibility preload was used. Contract sources, planner payloads, and storage were not modified to bypass migration checks. All Solidity artifacts were freshly compiled from the merged source.

Additional verification: 57 incident policy tests passed. The four unsigned schedule/execute payloads were also rehearsed against a post-deployment mainnet fork at block 25927742: schedule both, warp 86401 seconds, migrate, verify containment, reopen. Premature reopen was blocked by its predecessor. No fork Safe JSON files are included here.

## Governance remains separate

Tx1 is the live `ops.mjs plan` Idle-cash migration, ending with dUSD paused, dLEND dUSD frozen and the replacement router paused.
Tx2 contains exactly dUSD unpause, PoolConfigurator dUSD unfreeze, and replacement-router unpause; it uses a different salt and Tx1's operation ID as predecessor. Both schedule operations may start their timers now, but Tx1 MUST execute and be verified before Tx2 execution. Readiness is each mined schedule timestamp plus 86400 seconds.

IMPORTANT: the requested unpause-only Tx2 does not activate strategies. Both replacement strategy configurations remain Suspended and the default deposit strategy remains zero. Do not describe it as complete deposit/strategy activation. No Idle delist, rebalance, old-router unpause, or reward activation is added to Tx2.
