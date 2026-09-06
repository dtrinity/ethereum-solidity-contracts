#!/usr/bin/env node
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { check } from "../incident-2026-09-05/policy.mjs";
const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "../..");
const text = (p) => fs.readFileSync(path.join(ROOT, p), "utf8");
const clean = (s) => s.replace(/\/\*[\s\S]*?\*\//g, "").replace(/\/\/[^\n]*/g, "");
function fn(s, n) {
  const a = s.indexOf(`function ${n}(`);
  check(a >= 0, `Missing ${n}`);
  const b = s.indexOf("{", a);
  let depth = 1,
    i = b + 1;
  for (; depth && i < s.length; i++) {
    if (s[i] === "{") depth++;
    if (s[i] === "}") depth--;
  }
  check(!depth, `Unbalanced ${n}`);
  return { declaration: s.slice(a, b), body: s.slice(b + 1, i - 1) };
}
const core = "contracts/vaults/dstake/";
const router = clean(text(core + "DStakeRouterV2.sol")),
  gov = clean(text(core + "DStakeRouterV2GovernanceModule.sol"));
const base = clean(text(core + "rewards/DStakeRewardManagerBase.sol"));
const auction = fn(base, "compoundRewards");
check(
  !auction.declaration.includes("onlyRole") && !auction.declaration.includes("virtual"),
  "dSTAKE auction must be final and permissionless.",
);
check(
  auction.declaration.includes("nonReentrant") && auction.declaration.includes("whenNotPaused"),
  "Auction needs pause and reentrancy guards.",
);
check(auction.body.indexOf("_processExchangeAssetDeposit") < auction.body.indexOf("_claimRewards"), "Establish backing before rewards.");
check(auction.body.includes("DuplicateRewardToken") && auction.body.includes("ExchangeAmountTooLow"), "Missing auction inputs/threshold.");
check(fn(base, "_processExchangeAssetDeposit").body.includes("dStakeRouter.compoundDeposit"), "No direct adapter reward path.");
check(fn(base, "_requireCurrentRouter").body.includes("StaleCompoundingRouter"), "Reject immutable stale manager binding.");
check(base.includes("_pause();"), "Reward managers must start paused.");
for (const name of ["DLend", "MetaMorpho"]) {
  const s = clean(text(core + `rewards/DStakeRewardManager${name}.sol`));
  check(
    !/function compoundRewards\s*\(|function _processExchangeAssetDeposit\s*\(|\.depositIntoStrategy\s*\(/.test(s),
    "Derived manager restored a bypass.",
  );
}
const dl = clean(text(core + "rewards/DStakeRewardManagerDLend.sol"));
check(
  dl.includes("claimRewardsOnBehalf(dStakeCollateralVault") && !dl.includes("claimAllRewardsOnBehalf"),
  "Claim holder entitlement through the wrapper.",
);
const generic = fn(clean(text("contracts/vaults/rewards_claimable/RewardClaimable.sol")), "compoundRewards");
check(generic.declaration.includes("onlyRole(REWARDS_MANAGER_ROLE)"), "Do not change unrelated generic reward-vault authorization.");
const contribution = fn(router, "compoundDeposit");
check(
  contribution.declaration.includes("whenNotPaused") &&
    contribution.body.includes("_enforceDepositCap") &&
    contribution.body.includes("StrategyBackingGuard.assertIncrease"),
  "Contribution bypasses router risk gates.",
);
check(!contribution.body.includes("mintForRouter"), "Keeper must not receive outer shares.");
for (const n of ["setOperationRoundingLoss", "setStrategyRoundingLoss"])
  check(
    fn(router, n).declaration.includes("whenPaused") && fn(router, n).declaration.includes("onlyRole(CONFIG_MANAGER_ROLE)"),
    "Rounding is privileged and paused-only.",
  );
check(fn(gov, "_removeAdapter").body.includes("heldShares != 0"), "Funded delisting bypass on legacy collateral deployments.");
check(
  fn(gov, "disposeRetiredStrategyDust").body.includes("reported > 1 || redeemable > 1"),
  "Dust exit must not become a configurable material write-off.",
);
const lib = clean(text(core + "libraries/StrategyBackingGuard.sol"));
check(lib.includes("HARD_ROUNDING_LOSS_LIMIT = 16") && !lib.includes("dustTolerance"), "Unsafe loss budget.");
for (const [file, n, arg] of [
  ["CurveLiquiditySwapAdapter", "swapLiquidity", "liquiditySwapParams"],
  ["CurveRepayAdapter", "repayWithCollateral", "repayParams"],
  ["CurveWithdrawSwapAdapter", "withdrawAndSwap", "withdrawSwapParams"],
]) {
  const f = fn(clean(text(`contracts/dlend/periphery/adapters/curve/${file}.sol`)), n);
  check(f.body.trim().startsWith(`_requireUser(${arg}.user);`), "User consent must precede ALL external operations.");
}
const amo = clean(text("contracts/dstable/AmoManagerV2.sol"));
for (const n of ["repayFrom", "repayWithPermit"]) {
  const f = fn(amo, n);
  check(f.declaration.includes("nonReentrant") && f.declaration.includes("onlyRole"), "Do not remove AMO entry protection.");
  check(f.body.includes("_repayFrom(") && !/\brepayFrom\(/.test(f.body), "Nested AMO nonReentrant entry restored.");
}
const oracle = clean(text("contracts/oracle_aggregator/chainlink/ChainlinkCompositeAggregator.sol"));
check(oracle.includes("updatedAt1 < updatedAt2 ? updatedAt1 : updatedAt2"), "Composite freshness must use oldest dependency.");
check(oracle.includes("timestamp == 0 || timestamp > block.timestamp"), "Invalid timestamp checks missing.");
const migration = clean(text(core + "incident/DStakeRouterMigrationGuard.sol"));
for (const marker of ["retirementConfigHash", "retired-adapter-admin", "retired-reward-caller", "legacy-reward-claimer"])
  check(migration.includes(marker), "Independent capability retirement missing.");
const ops = clean(text("scripts/followup-2026-09-05/reward-ops.mjs"));
check(!/new E.Wallet|getSigner\(|sendTransaction\(|eth_send|eth_sign/.test(ops), "Reward planner must stay unsigned/read-only.");
console.log("PASS: follow-up source policy checks. These are tripwires, NOT a Solidity parser or security proof.");
if (process.argv.includes("--compiled")) {
  const items = [
    ["vaults/dstake/rewards/DStakeRewardManagerDLend.sol", "DStakeRewardManagerDLend"],
    ["vaults/dstake/rewards/DStakeRewardManagerMetaMorpho.sol", "DStakeRewardManagerMetaMorpho"],
    ["dstable/AmoManagerV2.sol", "AmoManagerV2"],
    ["oracle_aggregator/chainlink/ChainlinkCompositeAggregator.sol", "ChainlinkCompositeAggregator"],
    ...["CurveLiquiditySwapAdapter", "CurveRepayAdapter", "CurveWithdrawSwapAdapter"].map((n) => [
      `dlend/periphery/adapters/curve/${n}.sol`,
      n,
    ]),
  ];
  for (const [p, n] of items) {
    const a = JSON.parse(text(`artifacts/contracts/${p}/${n}.json`));
    const bytes = (a.deployedBytecode.length - 2) / 2;
    check(bytes > 0 && bytes <= 24576, `${n}: absent or oversized runtime`);
    console.log(`${n}: ${bytes}/24576 runtime bytes`);
  }
}
