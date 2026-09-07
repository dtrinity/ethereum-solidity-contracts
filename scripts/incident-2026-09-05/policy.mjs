import { createHash } from "node:crypto";

export class IncidentError extends Error {}
export const fail = (message) => {
  throw new IncidentError(message);
};
export const check = (condition, message) => {
  if (!condition) fail(message);
};
export const lower = (value) => String(value).toLowerCase();
export const sameAddress = (a, b) => lower(a) === lower(b);
export const ZERO = "0x0000000000000000000000000000000000000000";
export const ZERO_HASH = `0x${"00".repeat(32)}`;
export const PRIVILEGED_ROLES = [
  "DEFAULT_ADMIN_ROLE",
  "ADAPTER_MANAGER_ROLE",
  "CONFIG_MANAGER_ROLE",
  "VAULT_MANAGER_ROLE",
  "PAUSER_ROLE",
  "STRATEGY_REBALANCER_ROLE",
];

export function canonical(value) {
  if (typeof value === "bigint") return JSON.stringify(value.toString());
  if (Array.isArray(value)) return `[${value.map(canonical).join(",")}]`;
  if (value && typeof value === "object") {
    return `{${Object.keys(value)
      .sort()
      .map((key) => `${JSON.stringify(key)}:${canonical(value[key])}`)
      .join(",")}}`;
  }
  return JSON.stringify(value);
}
export const digest = (value) => createHash("sha256").update(canonical(value)).digest("hex");

export function retirementAdapters(c, inventory) {
  return [...new Set([...inventory.configs.map((v) => lower(v.adapter)), ...(c.retirement?.extraAdapters ?? []).map(lower)])];
}

export function validateRetirement(c) {
  const r = c.retirement;
  check(r && r.reviewed === true, "A reviewed legacy reward/caller inventory is required; see follow-up instructions.");
  check(
    typeof r.evidence === "string" && r.evidence.trim().length >= 16,
    "Record the block-pinned role/claimer evidence used for retirement.",
  );
  for (const key of ["callers", "extraAdapters", "claimers"]) check(Array.isArray(r[key]), `Missing retirement.${key}`);
  check(
    r.callers.length <= 32 && r.claimers.length <= 64 && r.extraAdapters.length <= 100,
    "Retirement inventory exceeds on-chain bounds.",
  );
  const addr = (x) => typeof x === "string" && /^0x[0-9a-fA-F]{40}$/.test(x) && !sameAddress(x, ZERO);
  for (const x of [...r.callers, ...r.extraAdapters]) check(addr(x), "Invalid retirement address.");
  check(new Set(r.callers.map(lower)).size === r.callers.length, "Duplicate retired caller.");
  check(
    !r.callers.some((x) => [c.oldRouter, c.token, c.collateral, c.timelock].some((a) => sameAddress(a, x))),
    "Core authority cannot be listed as a retired reward caller.",
  );
  const keys = new Set();
  for (const q of r.claimers) {
    check(addr(q.controller) && addr(q.emissionManager) && addr(q.user), "Incomplete claimer revocation.");
    const key = `${lower(q.controller)}:${lower(q.user)}`;
    check(!keys.has(key), "Duplicate claimer revocation.");
    keys.add(key);
    check(q.preconditionOnly === undefined || typeof q.preconditionOnly === "boolean", "Invalid preconditionOnly flag.");
  }
  const p = c.rounding;
  check(p && p.reviewed === true && Array.isArray(p.strategies), "A reviewed per-strategy rounding policy is required.");
  const loss = (x) => typeof x === "string" && /^(0|[1-9][0-9]*)$/.test(x) && BigInt(x) <= 16n;
  check(loss(p.operationLoss), "Operation rounding must be 0..16 underlying base units.");
  const vaults = new Set();
  for (const v of p.strategies) {
    check(addr(v.vault) && loss(v.loss), "Invalid strategy rounding policy.");
    check(!vaults.has(lower(v.vault)), "Duplicate rounding strategy.");
    vaults.add(lower(v.vault));
    check(BigInt(v.loss) <= BigInt(p.operationLoss), "Strategy allowance exceeds the operation budget.");
  }
}

export function validateInventory(c, s, migration = false) {
  validateRetirement(c);
  for (const v of c.rounding.strategies)
    check(
      s.configs.some((x) => sameAddress(x.vault, v.vault)),
      "Rounding configured for an unknown strategy.",
    );
  check(Number(s.chainId) === Number(c.chainId), "Wrong target chain.");
  check(sameAddress(s.tokenRouter, c.oldRouter), "Token is not connected to the expected legacy router.");
  check(sameAddress(s.vaultRouter, c.oldRouter), "Collateral vault is not connected to the expected legacy router.");
  check(sameAddress(s.tokenCollateral, c.collateral), "Token collateral pointer differs from the configured anchor.");
  check(sameAddress(s.tokenAsset, c.asset), "Wrong token underlying asset.");
  check(sameAddress(s.vaultToken, c.token) && sameAddress(s.vaultAsset, c.asset), "Collateral vault immutable token/underlying mismatch.");
  check(sameAddress(s.routerToken, c.token) && sameAddress(s.routerCollateral, c.collateral), "Legacy immutable anchors differ.");
  check(
    s.authority.tokenAdmin && s.authority.vaultAdmin && s.authority.routerPauser,
    "Timelock lacks a required migration/pause authority.",
  );
  check(s.authority.proposer && s.authority.executor, "Governance Safe cannot both propose and execute the timelock operation.");
  check(s.configs.length > 0 && s.configs.length <= 100, "Unexpected strategy count; review manually.");
  const supported = s.supported.map(lower).sort();
  const configured = s.configs.map((x) => lower(x.vault)).sort();
  check(new Set(configured).size === configured.length, "Duplicate strategy configuration.");
  check(canonical(supported) === canonical(configured), "Supported holdings and router configurations do not match exactly.");
  check(
    s.configs.reduce((n, x) => n + BigInt(x.targetBps), 0n) === 1_000_000n,
    "Targets do not sum to the protocol's 1,000,000-unit allocation scale.",
  );
  for (const v of s.configs) {
    check(v.adapterAdmin, "Timelock is not admin of every strategy adapter.");
    check(sameAddress(v.asset, c.asset), "A strategy does not report the expected underlying asset.");
    check(sameAddress(v.adapterShare, v.vault), "Adapter strategy-share identity mismatch.");
    check(sameAddress(v.mappedAdapter, v.adapter), "Adapter mapping/configuration mismatch.");
    check(sameAddress(v.adapterCollateral, c.collateral), "Adapter deposits into a different collateral vault.");
  }
  check(
    BigInt(s.shortfall) === 0n,
    "Outstanding shortfall: do not erase it to bypass migrateCore. A separately reviewed migration is required.",
  );
  check(
    BigInt(s.cap) === 0n || BigInt(s.cap) >= BigInt(s.managed),
    "Existing cap is below current NAV; setDepositCap cannot clone it. Review an explicit governance adjustment.",
  );
  if (migration) {
    check(BigInt(s.tokenAllowance) === 0n, "Token still has a nonzero allowance to the legacy router.");
  }
}

// Semantic plan first; ABI encoding is separate and cannot silently change order.
export function migrationCalls(c, replacement, inventory) {
  const adapters = [...new Set(inventory.configs.map((v) => lower(v.adapter)))];
  return [
    { to: replacement.router, contract: "router", method: "rescuePausedCash", args: [] },
    { to: replacement.guard, contract: "guard", method: "begin", args: [] },
    { to: c.oldRouter, contract: "router", method: "unpause", args: [] },
    { to: c.oldRouter, contract: "router", method: "reinvestFees", args: [] },
    { to: c.oldRouter, contract: "router", method: "pause", args: [] },
    { to: replacement.guard, contract: "guard", method: "verifyLegacyCashHandled", args: [] },
    ...c.retirement.callers.flatMap((caller) => [
      ...retirementAdapters(c, inventory).flatMap((to) => [
        { to, contract: "adapter", method: "setAuthorizedCaller", args: [caller, false] },
        { to, contract: "access", method: "revokeRole", args: [ZERO_HASH, caller] },
      ]),
      { to: c.collateral, contract: "access", method: "revokeRole", args: [ZERO_HASH, caller] },
      // The fixed role hash is ABI-encoded by ops.mjs after this semantic plan.
      { to: c.collateral, contract: "access", method: "revokeRole", args: ["ROUTER_ROLE", caller] },
    ]),
    ...c.retirement.claimers
      .filter((q) => !q.preconditionOnly)
      .map((q) => ({
        to: q.emissionManager,
        contract: "emission",
        method: "setClaimer",
        args: [q.user, ZERO],
      })),
    ...adapters.map((to) => ({ to, contract: "adapter", method: "setAuthorizedCaller", args: [replacement.router, true] })),
    { to: c.collateral, contract: "collateral", method: "setRouter", args: [replacement.router] },
    { to: c.token, contract: "token", method: "migrateCore", args: [replacement.router, c.collateral] },
    ...adapters.map((to) => ({ to, contract: "adapter", method: "setAuthorizedCaller", args: [c.oldRouter, false] })),
    { to: replacement.guard, contract: "guard", method: "finish", args: [] },
  ];
}

export function assertMigrationPlan(calls, c, replacement, inventory) {
  check(
    canonical(calls) === canonical(migrationCalls(c, replacement, inventory)),
    "Migration call sequence was modified or is incomplete.",
  );
  check(calls[0]?.method === "rescuePausedCash", "Replacement cash rescue must occur before migration begin.");
  check(calls[1]?.method === "begin", "Migration guard must snapshot backing before legacy cash handling.");
  const cashVerified = calls.findIndex((x) => x.method === "verifyLegacyCashHandled");
  check(cashVerified >= 2, "Legacy cash handling must be verified before migration.");
  check(
    !calls
      .slice(cashVerified + 1)
      .some((x) => /unpause|unfreeze|upgrade|removeAdapter|clearShortfall|transferStrategyShares/i.test(x.method)),
    "Unsafe reopening/upgrade/asset-removal call in migration batch.",
  );
}

export function isLocalUrl(raw) {
  try {
    const u = new URL(raw);
    return ["http:", "https:"].includes(u.protocol) && ["localhost", "127.0.0.1", "[::1]"].includes(u.hostname);
  } catch {
    return false;
  }
}
