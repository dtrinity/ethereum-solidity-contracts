# Foundry Harness

This directory holds the Forge-based fuzzing and invariant suites for the protocol. It complements the Hardhat
TypeScript tests by providing high-iteration scenarios that benefit from Foundry's native cheatcodes and faster
execution.

## Layout

- `test/` – Solidity test contracts (`.t.sol`) grouped by domain (e.g. `dstable/`, `dstake/`).
- `script/` – Reserved for Forge scripts or invariant sandboxes.
- `lib/` – Third-party Forge dependencies installed via `forge install`.

Generated artifacts live under `foundry/out` and cache data under `foundry/cache`, both ignored from version control.

## Usage

Install dependencies (once per checkout):

```sh
forge install foundry-rs/forge-std --no-commit --root foundry
```

Run all Forge tests and invariants:

```sh
forge test --root foundry
```

Individual suites can be targeted with `--match-path`. For example:

```sh
forge test --root foundry --match-path foundry/test/dstable/IssuerRedeemerInvariant.t.sol
```

See `foundry.toml` for configuration details such as remappings and optimizer settings.
