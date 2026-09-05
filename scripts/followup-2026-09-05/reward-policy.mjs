import { check, digest, ZERO, sameAddress } from "../incident-2026-09-05/policy.mjs";
export { digest };
export const ROLE_NAMES = ["DEFAULT_ADMIN_ROLE", "REWARDS_MANAGER_ROLE", "COMPOUND_PAUSER_ROLE"];
export function validateRewardManifest(c) {
  check(
    c.reviewed === true && typeof c.evidence === "string" && c.evidence.trim().length >= 16,
    "A reviewed, block-pinned reward migration inventory is required.",
  );
  check([1, 31337].includes(c.chainId), "Only Ethereum or its local fork is supported.");
  check(["DLend", "MetaMorpho"].includes(c.kind), "Unknown manager kind.");
  check(
    typeof c.id === "string" && /^[A-Za-z0-9_-]+_SettlementV2_[A-Za-z0-9_-]+$/.test(c.id),
    "Use a fresh, versioned SettlementV2 identity.",
  );
  const addr = (x) => typeof x === "string" && /^0x[0-9a-fA-F]{40}$/.test(x) && !sameAddress(x, ZERO);
  for (const k of [
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
  ])
    check(addr(c[k]), `Invalid ${k}.`);
  check(
    ![c.timelock, c.emergencySafe, c.rewardOperator, c.governanceSafe].some((x) => sameAddress(x, c.deployer)),
    "Use a separate temporary deployer.",
  );
  check(Number.isSafeInteger(c.expectedNonce) && c.expectedNonce >= 0, "Set the explicitly reviewed deployer nonce.");
  const uint = (x) => typeof x === "string" && /^(0|[1-9][0-9]*)$/.test(x);
  for (const k of ["threshold", "fee", "maxFee"]) check(uint(c[k]), `Invalid ${k}; use integer base units.`);
  check(
    BigInt(c.threshold) > 0n && BigInt(c.fee) <= BigInt(c.maxFee) && BigInt(c.maxFee) <= 1_000_000n,
    "Invalid threshold or fee; 100%=1,000,000.",
  );
  check(
    c.retirement && c.retirement.reviewed === true && Array.isArray(c.retirement.callers) && Array.isArray(c.retirement.extraAdapters),
    "Reviewed retirement inventory required.",
  );
  for (const x of [...c.retirement.callers, ...c.retirement.extraAdapters]) check(addr(x), "Invalid retirement address.");
  if (c.kind === "DLend") for (const k of ["wrapper", "aToken", "controller", "emissionManager"]) check(addr(c[k]), `Invalid ${k}.`);
  if (c.kind === "MetaMorpho") {
    check(addr(c.metaMorphoVault), "Invalid MetaMorpho vault.");
    check(c.urd === ZERO || addr(c.urd), "Invalid URD.");
    check(c.rewardAttributionReviewed === true, "Review URD account/claim attribution before moving a MetaMorpho manager.");
  }
}

export function bootstrapCalls(c, manager, encode) {
  // This is a deployer transaction sequence, NOT a Safe batch from the wrong caller.
  const grants = [
    ["DEFAULT_ADMIN_ROLE", c.timelock],
    ["REWARDS_MANAGER_ROLE", c.rewardOperator],
    ["COMPOUND_PAUSER_ROLE", c.emergencySafe],
    ["COMPOUND_PAUSER_ROLE", c.timelock],
  ];
  return [
    ...grants.map(([role, account]) => ({ to: manager, method: "grantRole", role, account })),
    ...["REWARDS_MANAGER_ROLE", "COMPOUND_PAUSER_ROLE", "DEFAULT_ADMIN_ROLE"].map((role) => ({
      to: manager,
      method: "revokeRole",
      role,
      account: c.deployer,
    })),
  ].map((x) => ({ ...x, value: "0", data: encode(x.method, x.role, x.account) }));
}
