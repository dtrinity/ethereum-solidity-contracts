#!/usr/bin/env node
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { check } from "./policy.mjs";

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "../..");
const read = (file) => fs.readFileSync(path.join(ROOT, file), "utf8");
const clean = (text) => text.replace(/\/\*[\s\S]*?\*\//g, "").replace(/\/\/[^\n]*/g, "");
const core = "contracts/vaults/dstake/";
const router = clean(read(`${core}DStakeRouterV2.sol`));
const governance = clean(read(`${core}DStakeRouterV2GovernanceModule.sol`));
const rebalance = clean(read(`${core}DStakeRouterV2RebalanceModule.sol`));
const library = clean(read(`${core}libraries/StrategyBackingGuard.sol`));
function body(source, name) {
  const start = source.indexOf(`function ${name}(`);
  check(start >= 0, `Missing function ${name}`);
  const open = source.indexOf("{", start);
  let depth = 1,
    i = open + 1;
  for (; i < source.length && depth; i++) {
    if (source[i] === "{") depth++;
    if (source[i] === "}") depth--;
  }
  check(depth === 0, `Unbalanced function ${name}`);
  return { declaration: source.slice(start, open), body: source.slice(open + 1, i - 1) };
}
const contains = (text, needle, label) => check(text.includes(needle), `Missing guard: ${label}`);
for (const [label, source] of [
  ["router", router],
  ["governance", governance],
  ["rebalance", rebalance],
]) {
  check(
    !/\.depositIntoStrategy\s*\(/.test(source) && !/\.withdrawFromStrategy\s*\(/.test(source),
    `Unchecked adapter state-changing call in ${label}`,
  );
}
for (const name of ["handleDeposit", "solverDepositAssets", "solverDepositShares"]) {
  const f = body(router, name).body;
  contains(f, "StrategyBackingGuard.pull", `${name} actual input`);
  contains(f, "StrategyBackingGuard.assertIncrease", `${name} operation-wide backing`);
  if (name !== "handleDeposit")
    check(f.indexOf("StrategyBackingGuard.assertIncrease") < f.indexOf("mintForRouter"), `${name} must check BEFORE outer mint`);
}
contains(body(router, "_depositToVaultAtomically").body, "StrategyBackingGuard.deposit", "shared deposit primitive");
for (const name of ["_withdrawFromVaultAtomically", "_withdrawSharesFromVaultAtomically"])
  contains(body(router, name).body, "StrategyBackingGuard.withdraw", name);
for (const name of ["solverWithdrawAssets", "solverWithdrawShares"])
  contains(body(router, name).body, "StrategyBackingGuard.assertWithdrawal", `${name} aggregate loss bound`);
for (const name of ["rebalanceStrategiesByShares", "rebalanceStrategiesBySharesViaExternalLiquidity", "rebalanceStrategiesByValue"]) {
  const f = body(router, name);
  contains(f.declaration, "whenNotPaused", `${name} pause`);
  contains(f.body, "StrategyBackingGuard.assertWithdrawal", `${name} aggregate loss`);
}
contains(body(router, "sweepSurplus").declaration, "whenNotPaused", "privileged sweep pause");
contains(body(governance, "sweepSurplus").body, "StrategyBackingGuard.deposit", "governance sweep accounting");
contains(body(rebalance, "_rebalanceStrategiesByShares").body, "StrategyBackingGuard.withdraw", "rebalance debit");
contains(body(rebalance, "_rebalanceStrategiesByShares").body, "StrategyBackingGuard.deposit", "rebalance credit");
contains(body(router, "handleWithdraw").body, "netAssets = expectedNetAssets", "standard withdrawal payout cap");
contains(library, "MAX_ROUNDING_LOSS = 1", "default smallest-unit tolerance");
check(!library.includes("dustTolerance"), "Configurable dust must not relax public-flow conservation.");
contains(library, "previewRedeem(p.shares)", "whole existing + new strategy position");
contains(library, "strategyShareValueInDStable(vault, p.shares)", "adapter-accounting check");
contains(library, "increase == 0", "positive credit cannot have zero gain");
contains(library, "received != reported", "actual withdrawal cash delta");
contains(read(`${core}DStakeRouterV2Storage.sol`), "storage:3:bounded-rounding-and-compounding", "new module compatibility generation");
contains(read(`${core}incident/DStakeRouterV2Incident.sol`), "_pause();", "constructor pause");
console.log("PASS: source-level incident guardrails (not Solidity compilation or EVM execution).");

if (process.argv.includes("--compiled")) {
  for (const [file, name] of [
    ["incident/DStakeRouterV2Incident.sol", "DStakeRouterV2Incident"],
    ["DStakeRouterV2GovernanceModule.sol", "DStakeRouterV2GovernanceModule"],
    ["DStakeRouterV2RebalanceModule.sol", "DStakeRouterV2RebalanceModule"],
    ["incident/DStakeRouterMigrationGuard.sol", "DStakeRouterMigrationGuard"],
  ]) {
    const a = JSON.parse(read(`artifacts/${core}${file}/${name}.json`));
    const bytes = (a.deployedBytecode.length - 2) / 2;
    check(bytes > 0 && bytes <= 24576, `${name}: absent or oversized deployed runtime`);
    console.log(`PASS: ${name} runtime ${bytes}/24576 bytes`);
  }
}
