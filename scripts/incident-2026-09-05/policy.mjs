import { createHash } from "node:crypto";

export class IncidentError extends Error {}
export const fail = (message) => { throw new IncidentError(message); };
export const check = (condition, message) => { if (!condition) fail(message); };
export const lower = (value) => String(value).toLowerCase();
export const sameAddress = (a, b) => lower(a) === lower(b);
export const ZERO = "0x0000000000000000000000000000000000000000";
export const ZERO_HASH = `0x${"00".repeat(32)}`;
export const PRIVILEGED_ROLES = [
  "DEFAULT_ADMIN_ROLE", "ADAPTER_MANAGER_ROLE", "CONFIG_MANAGER_ROLE",
  "VAULT_MANAGER_ROLE", "PAUSER_ROLE", "STRATEGY_REBALANCER_ROLE",
];

export function canonical(value) {
  if (typeof value === "bigint") return JSON.stringify(value.toString());
  if (Array.isArray(value)) return `[${value.map(canonical).join(",")}]`;
  if (value && typeof value === "object") {
    return `{${Object.keys(value).sort().map((key) => `${JSON.stringify(key)}:${canonical(value[key])}`).join(",")}}`;
  }
  return JSON.stringify(value);
}
export const digest = (value) => createHash("sha256").update(canonical(value)).digest("hex");

export function validateInventory(c, s, migration = false) {
  check(Number(s.chainId) === Number(c.chainId), "Wrong target chain.");
  check(sameAddress(s.tokenRouter, c.oldRouter), "Token is not connected to the expected legacy router.");
  check(sameAddress(s.vaultRouter, c.oldRouter), "Collateral vault is not connected to the expected legacy router.");
  check(sameAddress(s.tokenCollateral, c.collateral), "Token collateral pointer differs from the configured anchor.");
  check(sameAddress(s.tokenAsset, c.asset), "Wrong token underlying asset.");
  check(sameAddress(s.vaultToken, c.token) && sameAddress(s.vaultAsset, c.asset), "Collateral vault immutable token/underlying mismatch.");
  check(sameAddress(s.routerToken, c.token) && sameAddress(s.routerCollateral, c.collateral), "Legacy immutable anchors differ.");
  check(s.authority.tokenAdmin && s.authority.vaultAdmin && s.authority.routerPauser, "Timelock lacks a required migration/pause authority.");
  check(s.authority.proposer && s.authority.executor, "Governance Safe cannot both propose and execute the timelock operation.");
  check(s.configs.length > 0 && s.configs.length <= 100, "Unexpected strategy count; review manually.");
  const supported = s.supported.map(lower).sort();
  const configured = s.configs.map((x) => lower(x.vault)).sort();
  check(new Set(configured).size === configured.length, "Duplicate strategy configuration.");
  check(canonical(supported) === canonical(configured), "Supported holdings and router configurations do not match exactly.");
  check(s.configs.reduce((n, x) => n + BigInt(x.targetBps), 0n) === 1_000_000n, "Targets do not sum to the protocol's 1,000,000-unit allocation scale.");
  for (const v of s.configs) {
    check(v.adapterAdmin, "Timelock is not admin of every strategy adapter.");
    check(sameAddress(v.asset, c.asset), "A strategy does not report the expected underlying asset.");
    check(sameAddress(v.adapterShare, v.vault), "Adapter strategy-share identity mismatch.");
    check(sameAddress(v.mappedAdapter, v.adapter), "Adapter mapping/configuration mismatch.");
    check(sameAddress(v.adapterCollateral, c.collateral), "Adapter deposits into a different collateral vault.");
  }
  check(BigInt(s.shortfall) === 0n, "Outstanding shortfall: do not erase it to bypass migrateCore. A separately reviewed migration is required.");
  check(BigInt(s.cap) === 0n || BigInt(s.cap) >= BigInt(s.managed), "Existing cap is below current NAV; setDepositCap cannot clone it. Review an explicit governance adjustment.");
  if (migration) {
    check(BigInt(s.routerCash) === 0n, "Legacy router has cash. This zero-movement migration must not strand it. Reconcile and separately review its disposition.");
    check(BigInt(s.tokenAllowance) === 0n, "Token still has a nonzero allowance to the legacy router.");
  }
}

// Semantic plan first; ABI encoding is separate and cannot silently change order.
export function migrationCalls(c, replacement, inventory) {
  const adapters = [...new Set(inventory.configs.map((v) => lower(v.adapter)))];
  return [
    { to: replacement.guard, contract: "guard", method: "begin", args: [] },
    ...adapters.map((to) => ({ to, contract: "adapter", method: "setAuthorizedCaller", args: [replacement.router, true] })),
    { to: c.collateral, contract: "collateral", method: "setRouter", args: [replacement.router] },
    { to: c.token, contract: "token", method: "migrateCore", args: [replacement.router, c.collateral] },
    ...adapters.map((to) => ({ to, contract: "adapter", method: "setAuthorizedCaller", args: [c.oldRouter, false] })),
    { to: replacement.guard, contract: "guard", method: "finish", args: [] },
  ];
}

export function assertMigrationPlan(calls, c, replacement, inventory) {
  check(canonical(calls) === canonical(migrationCalls(c, replacement, inventory)), "Migration call sequence was modified or is incomplete.");
  check(!calls.some((x) => /unpause|unfreeze|upgrade|removeAdapter|clearShortfall|transferStrategyShares/i.test(x.method)), "Unsafe reopening/upgrade/asset-removal call in migration batch.");
}

export function isLocalUrl(raw) {
  try {
    const u = new URL(raw);
    return ["http:", "https:"].includes(u.protocol) && ["localhost", "127.0.0.1", "[::1]"].includes(u.hostname);
  } catch { return false; }
}
