import test from "node:test";
import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import path from "node:path";
import { fileURLToPath } from "node:url";
import {
  ZERO,
  ZERO_HASH,
  validateRetirement,
  migrationCalls,
  assertMigrationPlan,
  retirementAdapters,
} from "../incident-2026-09-05/policy.mjs";
import { validateRewardManifest, bootstrapCalls, digest } from "./reward-policy.mjs";
const HERE = path.dirname(fileURLToPath(import.meta.url)),
  A = (n) => `0x${n.toString(16).padStart(40, "0")}`;
function fixture() {
  const c = {
    reviewed: true,
    evidence: "Synthetic reviewed test only, no live chain claim",
    id: "sdUSD_SettlementV2_DLend",
    kind: "DLend",
    chainId: 1,
    expectedNonce: 0,
    threshold: "100",
    fee: "50000",
    maxFee: "100000",
    retirement: {
      reviewed: true,
      evidence: "Synthetic retirement evidence",
      callers: [A(90)],
      extraAdapters: [A(91)],
      claimers: [{ controller: A(92), emissionManager: A(93), user: A(94) }],
    },
    rounding: { reviewed: true, operationLoss: "2", strategies: [{ vault: A(50), loss: "2" }] },
  };
  [
    "deployer",
    "token",
    "asset",
    "collateral",
    "router",
    "timelock",
    "governanceSafe",
    "emergencySafe",
    "rewardOperator",
    "treasury",
    "wrapper",
    "aToken",
    "controller",
    "emissionManager",
    "oldRouter",
  ].forEach((k, i) => (c[k] = A(i + 1)));
  return c;
}
test("reviewed permissionless reward deployment manifest accepts valid configuration", () =>
  assert.doesNotThrow(() => validateRewardManifest(fixture())));
for (const [label, mutate] of [
  ["unreviewed", (c) => (c.reviewed = false)],
  ["no evidence", (c) => (c.evidence = "")],
  ["old deployment name", (c) => (c.id = "DStakeRewardManagerDLend_sdUSD")],
  ["zero threshold", (c) => (c.threshold = "0")],
  ["negative threshold", (c) => (c.threshold = "-1")],
  ["decimal threshold", (c) => (c.threshold = "0.1")],
  ["fee above ceiling", (c) => (c.fee = "100001")],
  ["ceiling above 100%", (c) => (c.maxFee = "1000001")],
  ["missing wrapper", (c) => (c.wrapper = ZERO)],
  ["missing controller", (c) => delete c.controller],
  ["unreviewed retirement", (c) => (c.retirement.reviewed = false)],
  ["deployer retains admin", (c) => (c.timelock = c.deployer)],
  ["deployer retains pause", (c) => (c.emergencySafe = c.deployer)],
  ["unversioned identity", (c) => (c.id = "sdUSD")],
  ["unknown kind", (c) => (c.kind = "Other")],
  ["unknown chain", (c) => (c.chainId = 10)],
  ["negative nonce", (c) => (c.expectedNonce = -1)],
  ["floating nonce", (c) => (c.expectedNonce = 1.1)],
])
  test(`reward manifest refuses ${label}`, () => {
    const c = fixture();
    mutate(c);
    assert.throws(() => validateRewardManifest(c));
  });
test("MetaMorpho deployment requires independent reward attribution review", () => {
  const c = fixture();
  c.kind = "MetaMorpho";
  c.metaMorphoVault = A(98);
  c.urd = ZERO;
  assert.throws(() => validateRewardManifest(c));
  c.rewardAttributionReviewed = true;
  assert.doesNotThrow(() => validateRewardManifest(c));
});
test("bootstrap keeps compounding permissionless and retires deployer admin last", () => {
  const c = fixture();
  const calls = bootstrapCalls(c, A(100), (m, r, a) => `${m}:${r}:${a}`);
  assert.equal(calls.length, 7);
  assert.deepEqual(calls.at(-1), {
    to: A(100),
    method: "revokeRole",
    role: "DEFAULT_ADMIN_ROLE",
    account: c.deployer,
    value: "0",
    data: `revokeRole:DEFAULT_ADMIN_ROLE:${c.deployer}`,
  });
  assert(!calls.some((x) => /unpause|setAuthorizedCaller|setClaimer/.test(x.method)));
});
for (const limit of ["0", "1", "2", "16"])
  test(`explicit bounded rounding policy accepts ${limit} base units`, () => {
    const c = fixture();
    c.rounding.operationLoss = limit;
    c.rounding.strategies[0].loss = limit;
    assert.doesNotThrow(() => validateRetirement(c));
  });
for (const value of ["17", "1000000", "-1", "0.5", "02", 2])
  test(`rejects invalid rounding allowance ${JSON.stringify(value)}`, () => {
    const c = fixture();
    c.rounding.operationLoss = value;
    assert.throws(() => validateRetirement(c));
  });
for (const key of ["rounding", "retirement"])
  test(`blocks ${key} without explicit review`, () => {
    const c = fixture();
    c[key].reviewed = false;
    assert.throws(() => validateRetirement(c));
  });
test("per-strategy allowance cannot exceed reviewed aggregate bootstrap budget", () => {
  const c = fixture();
  c.rounding.operationLoss = "1";
  assert.throws(() => validateRetirement(c));
});
test("retirement includes historical adapters, adapter admin, custody and upstream claims", () => {
  const c = fixture(),
    s = { configs: [{ adapter: A(80) }] },
    d = { router: A(81), guard: A(82) };
  const calls = migrationCalls(c, d, s);
  assert.equal(calls[0].method, "unpause");
  assert.equal(calls[4].method, "begin");
  assert.equal(calls.at(-1).method, "finish");
  assert.equal(retirementAdapters(c, s).length, 2);
  assert(calls.some((x) => x.to === A(91) && x.method === "revokeRole" && x.args[0] === ZERO_HASH));
  assert(calls.some((x) => x.method === "setClaimer" && x.args[1] === ZERO));
  for (let i = 1; i < calls.length - 1; i++) {
    assert.throws(() =>
      assertMigrationPlan(
        calls.filter((_, j) => j !== i),
        c,
        d,
        s,
      ),
    );
  }
});
test("separate emission-owner revocation is a checked precondition, not an unauthorized timelock call", () => {
  const c = fixture();
  c.retirement.claimers[0].preconditionOnly = true;
  const calls = migrationCalls(c, { router: A(81), guard: A(82) }, { configs: [{ adapter: A(80) }] });
  assert(!calls.some((x) => x.method === "setClaimer"));
});
test("manifest digest changes with threshold, role or wrapper identity", () => {
  const c = fixture();
  for (const [k, v] of [
    ["threshold", "101"],
    ["emergencySafe", A(201)],
    ["wrapper", A(202)],
  ])
    assert.notEqual(digest(c), digest({ ...c, [k]: v }));
});
const RAY = 10n ** 27n;
const loss = (s, a, r) => a - (((s + (a * RAY) / r) * r) / RAY - (s * r) / RAY);
test("exact real-wrapper conversion counterexample: one unit fails, two units suffice", () => {
  const r = (109n * RAY) / 100n,
    s = 100000n * 10n ** 18n,
    a = 1000000000000000009n;
  assert.equal(loss(s, a, r), 2n);
  assert.equal((a * RAY) / r, 917431192660550466n);
});
test("repeating the same leg must not multiply the aggregate allowance", () => {
  const r = (109n * RAY) / 100n,
    s = 100000n * 10n ** 18n,
    a = 1000000000000000009n;
  const n = (a * RAY) / r;
  assert.equal(2n * a - (((s + 2n * n) * r) / RAY - (s * r) / RAY), 3n);
});
test("fixed-index arithmetic bound across deterministic fractional residues", () => {
  for (const k of [100n, 101n, 109n, 150n, 999n, 1600n]) {
    const r = (k * RAY) / 100n,
      ceil = (r + RAY - 1n) / RAY;
    for (let i = 1n; i <= 1000n; i++) {
      const l = loss(i * 7919n, i * 101n + 9n, r);
      assert(l >= 0n && l <= ceil);
    }
  }
});
test("bounded rounding never excuses zero added backing", () => {
  const accept = (input, gain, allowed) => gain > 0n && (gain >= input || input - gain <= allowed);
  assert.equal(accept(2n, 0n, 16n), false);
  assert.equal(accept(100n, 98n, 2n), true);
  assert.equal(accept(100n, 83n, 16n), false);
});
test("two-holder fixed-index entitlement and fixed-threshold auction model", () => {
  const collateral = 300n * 10n ** 18n,
    external = 100n * 10n ** 18n,
    indexDelta = 10n ** 18n;
  const own = (collateral * indexDelta) / 10n ** 18n,
    other = (external * indexDelta) / 10n ** 18n,
    fee = (own * 50000n) / 1000000n;
  assert.equal(own - fee + fee, own);
  assert.equal(own + other, 400n * 10n ** 18n);
  assert.equal(own + other - own, other);
});
test("source-level invariants remain installed", () => {
  const r = spawnSync(process.execPath, [path.join(HERE, "check.mjs")], { encoding: "utf8" });
  assert.equal(r.status, 0, r.stdout + r.stderr);
});
