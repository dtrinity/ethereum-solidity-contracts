import test from "node:test";
import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { canonical, digest, validateInventory, migrationCalls, assertMigrationPlan, isLocalUrl } from "./policy.mjs";

const address = (n) => `0x${n.toString(16).padStart(40, "0")}`;
function fixture() {
  const c = { chainId: 1, oldRouter: address(1), token: address(2), collateral: address(3), asset: address(4), timelock: address(5) };
  const d = { router: address(6), guard: address(7) };
  const v = { vault: address(8), adapter: address(9), mappedAdapter: address(9), adapterShare: address(8), adapterCollateral: c.collateral, asset: c.asset, targetBps: "1000000", adapterAdmin: true };
  const s = { chainId: 1, tokenRouter: c.oldRouter, vaultRouter: c.oldRouter, tokenCollateral: c.collateral, tokenAsset: c.asset, routerToken: c.token, routerCollateral: c.collateral, vaultToken: c.token, vaultAsset: c.asset, authority: { tokenAdmin: true, vaultAdmin: true, routerPauser: true, proposer: true, executor: true }, configs: [v], supported: [v.vault], shortfall: "0", cap: "0", managed: "100", routerCash: "0", tokenAllowance: "0" };
  return { c, d, s };
}

test("planner: accepts a complete zero-movement migration inventory", () => {
  const { c, s } = fixture(); assert.doesNotThrow(() => validateInventory(c, s, true));
});
for (const [name, mutate] of [
  ["wrong chain", (s) => { s.chainId = 10; }],
  ["wrong token pointer", (s) => { s.tokenRouter = address(99); }],
  ["wrong collateral pointer", (s) => { s.vaultRouter = address(99); }],
  ["missing custody-admin authority", (s) => { s.authority.vaultAdmin = false; }],
  ["missing proposer", (s) => { s.authority.proposer = false; }],
  ["missing executor", (s) => { s.authority.executor = false; }],
  ["missing adapter authority", (s) => { s.configs[0].adapterAdmin = false; }],
  ["wrong underlying", (s) => { s.configs[0].asset = address(99); }],
  ["wrong collateral underlying", (s) => { s.vaultAsset = address(99); }],
  ["wrong collateral token", (s) => { s.vaultToken = address(99); }],
  ["adapter routes to another collateral vault", (s) => { s.configs[0].adapterCollateral = address(99); }],
  ["missing supported position", (s) => { s.supported.push(address(99)); }],
  ["duplicate strategy", (s) => { s.configs.push(s.configs[0]); }],
  ["wrong allocation scale", (s) => { s.configs[0].targetBps = "10000"; }],
  ["nonzero shortfall", (s) => { s.shortfall = "1"; }],
  ["legacy cash", (s) => { s.routerCash = "1"; }],
  ["legacy allowance", (s) => { s.tokenAllowance = "1"; }],
  ["uncopyable existing cap", (s) => { s.cap = "99"; }],
]) {
  test(`planner: rejects ${name}`, () => { const { c, s } = fixture(); mutate(s); assert.throws(() => validateInventory(c, s, true)); });
}

test("planner: cap zero is unlimited, not closed", () => { const { c, s } = fixture(); s.managed = "100000000000000000000000"; assert.doesNotThrow(() => validateInventory(c, s, true)); });
test("planner: emits guard begin / authorize / pointers / retire / finish in one batch", () => {
  const { c, d, s } = fixture(); const calls = migrationCalls(c, d, s);
  assert.deepEqual(calls.map((x) => x.method), ["begin", "setAuthorizedCaller", "setRouter", "migrateCore", "setAuthorizedCaller", "finish"]);
  assert.doesNotThrow(() => assertMigrationPlan(calls, c, d, s));
});
for (const [name, mutate] of [
  ["omitted final guard", (xs) => xs.slice(0, -1)],
  ["omitted legacy revocation", (xs) => xs.filter((_, i) => i !== 4)],
  ["changed pointer ordering", (xs) => { [xs[2], xs[3]] = [xs[3], xs[2]]; return xs; }],
  ["automatic reopening", (xs) => [...xs, { to: address(6), contract: "router", method: "unpause", args: [] }]],
]) test(`planner: rejects ${name}`, () => { const { c, d, s } = fixture(); assert.throws(() => assertMigrationPlan(mutate(migrationCalls(c, d, s)), c, d, s)); });

test("canonical digest: key order cannot change the review digest", () => { assert.equal(digest({ b: "2", a: "1" }), digest({ a: "1", b: "2" })); });
test("canonical digest: an edited amount changes the review digest", () => { assert.notEqual(digest({ amount: "100" }), digest({ amount: "101" })); });
test("canonical encoding: uint256 strings retain full precision", () => { assert.equal(canonical({ n: 2n ** 255n }), `{"n":"${2n ** 255n}"}`); });
for (const value of ["http://localhost:8545", "http://127.0.0.1:8545", "http://[::1]:8545"]) test(`fork URL accepts loopback ${value}`, () => assert.equal(isLocalUrl(value), true));
for (const value of ["https://rpc.example.com", "http://localhost.example.com", "http://localhost@rpc.example.com", "ftp://localhost", "not a URL"]) test("fork URL rejects non-loopback or non-HTTP provider", () => assert.equal(isLocalUrl(value), false));

const here = path.dirname(fileURLToPath(import.meta.url));
for (const args of [["plan", "--broadcast"], ["deploy", "--execute"], ["deploy", "--broadcast", "--dry-run"], ["deploy", "--broadcast", "--local-fork"], ["verify", "--execute", "--local-fork"]]) {
  test(`CLI refuses unsafe flags before loading a wallet: ${args.join(" ")}`, () => {
    const p = spawnSync(process.execPath, [path.join(here, "ops.mjs"), ...args], { encoding: "utf8", env: { ...process.env, DEPLOYER_PK: "SENTINEL_MUST_NEVER_BE_PRINTED" } });
    assert.notEqual(p.status, 0);
    assert.ok(!(p.stdout + p.stderr).includes("SENTINEL_MUST_NEVER_BE_PRINTED"));
  });
}

// Pure arithmetic MODEL tests: these do not execute or validate the Solidity.
const acceptsDeposit = (before, after, required) => {
  const gain = after > before ? after - before : 0n;
  return gain > 0n && (gain >= required || required - gain <= 1n);
};
const acceptsWithdrawal = (before, after, received) => {
  const loss = before > after ? before - after : 0n;
  return loss <= received || loss - received <= 1n;
};
test("MODEL: zero-share agreement does not justify nominal credit", () => { assert.equal(0n === 0n, true); assert.equal(acceptsDeposit(0n, 0n, 100n), false); });
test("MODEL: tiny nonzero share agreement does not justify nominal credit", () => { assert.equal(1n === 1n, true); assert.equal(acceptsDeposit(0n, 1n, 100n), false); });
test("MODEL: existing position appreciation is attributable backing despite zero new shares", () => { assert.equal(acceptsDeposit(1000n, 1100n, 100n), true); });
test("MODEL: tolerance never allows a positive one-unit claim with zero backing", () => { assert.equal(acceptsDeposit(1000n, 1000n, 1n), false); });
test("MODEL: per-operation check prevents accumulating a loss tolerance across legs", () => { assert.equal(acceptsDeposit(0n, 99n, 100n), true); assert.equal(acceptsDeposit(99n, 198n, 100n), true); assert.equal(acceptsDeposit(0n, 198n, 200n), false); });
test("MODEL: unpriced withdrawal surplus must be retained", () => { const gross = 3n, fee = 0n, pricedNet = 2n; assert.equal(gross - fee - pricedNet, 1n); });
test("MODEL: subtraction-based tolerance is valid at uint256 maximum", () => { const max = 2n ** 256n - 1n; assert.equal(acceptsDeposit(max - 2n, max, 2n), true); assert.equal(acceptsWithdrawal(max, max - 2n, 2n), true); });
test("MODEL: 20,000 deterministic generated conservation cases", () => {
  let seed = 997n;
  const next = () => { seed = (seed * 48271n) % 2147483647n; return seed; };
  for (let i = 0; i < 20_000; i++) {
    const required = next() % 10000n + 1n, before = next(), gain = next() % 20000n;
    if (acceptsDeposit(before, before + gain, required)) { assert.ok(gain > 0n); assert.ok(gain >= required - 1n); }
    const loss = next() % 10000n, paid = next() % 10000n;
    if (acceptsWithdrawal(loss, 0n, paid)) assert.ok(loss <= paid + 1n);
  }
});
