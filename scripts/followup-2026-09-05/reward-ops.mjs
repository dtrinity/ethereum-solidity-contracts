#!/usr/bin/env node
// READ-ONLY provider, unsigned output only. No Wallet, signer or broadcasting API.
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { check, ZERO, ZERO_HASH, sameAddress } from "../incident-2026-09-05/policy.mjs";
import { validateRewardManifest, bootstrapCalls, digest, ROLE_NAMES } from "./reward-policy.mjs";
const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "../..");
const HELP = `Usage: node scripts/followup-2026-09-05/reward-ops.mjs <plan|activate|verify> MANIFEST.json OUTPUT_DIR
Reads ETHEREUM_RPC_URL. No signing or broadcasting is implemented.
plan: unsigned CREATE + deployer role handoff, after router migration.
activate: verify deployed PAUSED manager, then produce holder-claimer proposal.
verify: verify deployed paused manager, granted holder claimer and retired capabilities.
All outputs omit unpause, adapter authorization, rewards sweeps, and asset movement.`;
const ABI = {
  router: [
    "function BACKING_GUARD_VERSION() view returns(uint256)",
    "function dStakeToken() view returns(address)",
    "function collateralVault() view returns(address)",
    "function paused() view returns(bool)",
    "function getVaultCount() view returns(uint256)",
    "function getVaultConfigByIndex(uint256) view returns(tuple(address strategyVault,address adapter,uint256 targetBps,uint8 status))",
  ],
  token: [
    "function router() view returns(address)",
    "function collateralVault() view returns(address)",
    "function asset() view returns(address)",
  ],
  collateral: [
    "function router() view returns(address)",
    "function dStakeToken() view returns(address)",
    "function dStable() view returns(address)",
  ],
  access: [
    "function hasRole(bytes32,address) view returns(bool)",
    "function grantRole(bytes32,address)",
    "function revokeRole(bytes32,address)",
  ],
  wrapper: [
    "function REWARDS_CONTROLLER() view returns(address)",
    "function aToken() view returns(address)",
    "function asset() view returns(address)",
  ],
  controller: ["function getClaimer(address) view returns(address)"],
  emission: [
    "function owner() view returns(address)",
    "function getRewardsController() view returns(address)",
    "function setClaimer(address,address)",
  ],
  timelock: [
    "function getMinDelay() view returns(uint256)",
    "function scheduleBatch(address[],uint256[],bytes[],bytes32,bytes32,uint256)",
    "function executeBatch(address[],uint256[],bytes[],bytes32,bytes32) payable",
  ],
};
function read(p) {
  return JSON.parse(fs.readFileSync(p, "utf8"));
}
function write(p, x) {
  fs.mkdirSync(path.dirname(p), { recursive: true, mode: 0o700 });
  fs.writeFileSync(p, JSON.stringify(x, (_, v) => (typeof v === "bigint" ? v.toString() : v), 2) + "\n", { mode: 0o600 });
}
function artifact(kind) {
  const name = `DStakeRewardManager${kind}`;
  const file = path.join(ROOT, `artifacts/contracts/vaults/dstake/rewards/${name}.sol/${name}.json`);
  const a = read(file),
    dbg = read(file.replace(/\.json$/, ".dbg.json"));
  const build = read(path.resolve(path.dirname(file), dbg.buildInfo));
  check(
    build.solcVersion === "0.8.20" &&
      build.input.settings.viaIR === true &&
      build.input.settings.optimizer?.enabled &&
      build.input.settings.optimizer.runs === 200,
    "Unexpected compiler settings; use the pinned repository build.",
  );
  for (const [source, value] of Object.entries(build.input.sources)) {
    if (source.startsWith("contracts/"))
      check(fs.readFileSync(path.join(ROOT, source), "utf8") === value.content, "Stale artifact/source mismatch. Clean and compile.");
  }
  const compiled = build.output.contracts[a.sourceName][name];
  check(a.bytecode !== "0x" && Object.keys(a.linkReferences ?? {}).length === 0, "Missing bytecode or unreviewed library linking.");
  check(a.deployedBytecode === `0x${compiled.evm.deployedBytecode.object}`, "Artifact/build-info mismatch.");
  check((a.deployedBytecode.length - 2) / 2 <= 24576, "Manager runtime exceeds EIP-170.");
  return { ...a, immutableReferences: compiled.evm.deployedBytecode.immutableReferences, buildHash: digest(build.input) };
}

async function main() {
  const [mode, manifest, output] = process.argv.slice(2);
  if (!mode || mode === "--help") {
    console.log(HELP);
    return;
  }
  check(["plan", "activate", "verify"].includes(mode) && manifest && output && process.argv.length === 5, HELP);
  const c = read(manifest);
  validateRewardManifest(c);
  const E = await import("ethers");
  check(process.env.ETHEREUM_RPC_URL, "ETHEREUM_RPC_URL is required.");
  const provider = new E.JsonRpcProvider(process.env.ETHEREUM_RPC_URL);
  try {
    check(Number((await provider.getNetwork()).chainId) === c.chainId, "RPC chain mismatch.");
    if (c.chainId === 31337) {
      const meta = await provider.send("hardhat_metadata", []);
      check(Number(meta.forkedNetwork?.chainId) === 1, "Expected local Ethereum fork.");
    }
    const b = await provider.getBlock("latest");
    check(b?.hash, "Cannot pin block.");
    const tag = { blockTag: b.number };
    const role = (n) => (n === "DEFAULT_ADMIN_ROLE" ? ZERO_HASH : E.id(n));
    const contract = (address, kind) => new E.Contract(address, [...ABI[kind], ...ABI.access], provider);
    const codeHashes = {};
    for (const addr of [
      c.router,
      c.collateral,
      c.token,
      c.asset,
      c.timelock,
      c.governanceSafe,
      c.emergencySafe,
      ...(c.kind === "DLend"
        ? [c.wrapper, c.controller, c.emissionManager, c.aToken]
        : [c.metaMorphoVault, ...(c.urd === ZERO ? [] : [c.urd])]),
    ]) {
      const code = await provider.getCode(addr, b.number);
      check(code !== "0x", "Required contract/Safe has no code.");
      codeHashes[addr] = E.keccak256(code);
    }
    const r = contract(c.router, "router"),
      cv = contract(c.collateral, "collateral"),
      t = contract(c.token, "token");
    check((await r.BACKING_GUARD_VERSION(tag)) === 3n && (await r.paused(tag)), "Use the verified generation-3 router while paused.");
    for (const [actual, expected] of [
      [await r.dStakeToken(tag), c.token],
      [await r.collateralVault(tag), c.collateral],
      [await t.router(tag), c.router],
      [await t.collateralVault(tag), c.collateral],
      [await t.asset(tag), c.asset],
      [await cv.router(tag), c.router],
      [await cv.dStakeToken(tag), c.token],
      [await cv.dStable(tag), c.asset],
    ])
      check(sameAddress(actual, expected), "Core bindings mismatch: complete router migration first.");
    const count = Number(await r.getVaultCount(tag));
    check(count > 0 && count <= 100, "Invalid strategy inventory.");
    const adapters = new Set(c.retirement.extraAdapters.map((x) => x.toLowerCase()));
    for (let i = 0; i < count; i++) adapters.add((await r.getVaultConfigByIndex(i, tag)).adapter.toLowerCase());
    for (const caller of c.retirement.callers) {
      for (const adapter of adapters)
        for (const name of ["DEFAULT_ADMIN_ROLE", "AUTHORIZED_CALLER_ROLE"])
          check(
            !(await contract(adapter, "access").hasRole(role(name), caller, tag)),
            "Legacy adapter capability remains; retire before replacement activation.",
          );
      for (const name of ["DEFAULT_ADMIN_ROLE", "ROUTER_ROLE"])
        check(!(await cv.hasRole(role(name), caller, tag)), "Legacy custody capability remains.");
    }
    const manager = E.getCreateAddress({ from: c.deployer, nonce: c.expectedNonce });
    if (c.kind === "DLend") {
      const w = contract(c.wrapper, "wrapper"),
        rc = contract(c.controller, "controller"),
        em = contract(c.emissionManager, "emission");
      check(
        sameAddress(await w.REWARDS_CONTROLLER(tag), c.controller) &&
          sameAddress(await w.aToken(tag), c.aToken) &&
          sameAddress(await w.asset(tag), c.asset),
        "Wrapper/controller/asset mismatch.",
      );
      check(sameAddress(await em.getRewardsController(tag), c.controller), "Emission manager/controller mismatch.");
      check(sameAddress(await rc.getClaimer(c.wrapper, tag), ZERO), "Aggregate-wrapper claimer must stay revoked.");
      const claimer = await rc.getClaimer(c.collateral, tag);
      check(
        sameAddress(claimer, mode === "verify" ? manager : ZERO),
        "Holder claimer conflicts with another manager, or activation state differs. A controller has only ONE claimer per holder.",
      );
    }
    const a = artifact(c.kind);
    const out = path.resolve(output);
    const common = {
      format: 1,
      id: c.id,
      kind: c.kind,
      chainId: c.chainId,
      blockNumber: b.number,
      blockHash: b.hash,
      manager,
      manifestHash: digest(c),
      buildHash: a.buildHash,
      codeHashes,
      noReopening: true,
    };
    if (mode === "plan") {
      check((await provider.getCode(manager, b.number)) === "0x", "Expected CREATE address already has code.");
      const latest = await provider.getTransactionCount(c.deployer, b.number);
      const pending = await provider.getTransactionCount(c.deployer, "pending");
      check(
        latest === c.expectedNonce && pending === latest,
        "Deployer nonce differs or has pending transactions. Regenerate/review, do not silently adjust.",
      );
      const args =
        c.kind === "DLend"
          ? [c.collateral, c.router, c.controller, c.wrapper, c.aToken, c.treasury, c.maxFee, c.fee, c.threshold]
          : [c.collateral, c.router, c.metaMorphoVault, c.urd, c.treasury, c.maxFee, c.fee, c.threshold];
      const deploy = await new E.ContractFactory(a.abi, a.bytecode).getDeployTransaction(...args);
      check((deploy.data.length - 2) / 2 <= 49152, "Initcode exceeds EIP-3860.");
      const iface = new E.Interface(a.abi);
      const boot = bootstrapCalls(c, manager, (m, n, addr) => iface.encodeFunctionData(m, [role(n), addr]));
      const plan = {
        ...common,
        constructorArguments: args,
        deployment: { from: c.deployer, nonce: c.expectedNonce, chainId: c.chainId, value: "0", data: deploy.data },
        bootstrap: boot.map((x, i) => ({ ...x, from: c.deployer, nonce: c.expectedNonce + 1 + i, chainId: c.chainId })),
        instructions:
          "Review/simulate CREATE and every sequential deployer transaction. Manager is paused throughout. Validate handoff before activation; no live executor is supplied.",
      };
      plan.reviewSha256 = digest(plan);
      write(path.join(out, "reward-deployment-plan.json"), plan);
      console.log(`Unsigned deployment review SHA-256: ${plan.reviewSha256}`);
    } else {
      const actual = await provider.getCode(manager, b.number);
      check(actual.length === a.deployedBytecode.length, "Manager runtime length mismatch.");
      const normalized = actual.slice(2).split(""),
        expected = a.deployedBytecode.slice(2);
      for (const refs of Object.values(a.immutableReferences ?? {}))
        for (const { start, length } of refs) for (let i = start * 2; i < (start + length) * 2; i++) normalized[i] = expected[i];
      check(normalized.join("") === expected, "Manager runtime differs from reviewed artifact.");
      const m = new E.Contract(manager, a.abi, provider);
      check((await m.paused(tag)) && (await m.SETTLEMENT_VERSION(tag)) === 2n, "New manager must remain paused.");
      for (const [getter, want] of Object.entries({
        dStakeRouter: c.router,
        dStakeCollateralVault: c.collateral,
        exchangeAsset: c.asset,
        treasury: c.treasury,
        ...(c.kind === "DLend"
          ? { targetStaticATokenWrapper: c.wrapper, dLendAssetToClaimFor: c.aToken, dLendRewardsController: c.controller }
          : { metaMorphoVault: c.metaMorphoVault, urd: c.urd }),
      }))
        check(sameAddress(await m[getter](tag), want), "Manager immutable/configuration mismatch.");
      for (const [getter, want] of Object.entries({ exchangeThreshold: c.threshold, treasuryFeeBps: c.fee, maxTreasuryFeeBps: c.maxFee }))
        check(String(await m[getter](tag)) === want, "Reward economic settings mismatch.");
      for (const n of ROLE_NAMES) check(!(await m.hasRole(role(n), c.deployer, tag)), "Deployer authority not retired.");
      for (const [n, addr] of [
        ["DEFAULT_ADMIN_ROLE", c.timelock],
        ["REWARDS_MANAGER_ROLE", c.rewardOperator],
        ["COMPOUND_PAUSER_ROLE", c.emergencySafe],
        ["COMPOUND_PAUSER_ROLE", c.timelock],
      ])
        check(await m.hasRole(role(n), addr, tag), "Required manager authority missing.");
      for (const adapter of adapters)
        for (const n of ["DEFAULT_ADMIN_ROLE", "AUTHORIZED_CALLER_ROLE"])
          check(!(await contract(adapter, "access").hasRole(role(n), manager, tag)), "New manager must NOT have direct adapter authority.");
      for (const n of ["DEFAULT_ADMIN_ROLE", "ROUTER_ROLE"])
        check(!(await cv.hasRole(role(n), manager, tag)), "New manager must NOT have custody authority.");
      if (mode === "activate" && c.kind === "DLend") {
        const em = contract(c.emissionManager, "emission"),
          owner = await em.owner(tag);
        const call = { to: c.emissionManager, value: "0", data: em.interface.encodeFunctionData("setClaimer", [c.collateral, manager]) };
        check(
          sameAddress(owner, c.timelock) || sameAddress(owner, c.governanceSafe),
          "Different emission owner: obtain its explicit separately reviewed proposal; do not impersonate it.",
        );
        const proposal = { ...common, authority: owner, holder: c.collateral, manager, calls: [call] };
        write(path.join(out, "reward-claimer-proposal.json"), proposal);
        const safe = (title, tx) => ({
          version: "1.0",
          chainId: String(c.chainId),
          createdAt: Date.now(),
          meta: {
            name: title,
            description: "Holder-level claimer only. No reopen or asset movement.",
            createdFromSafeAddress: c.governanceSafe,
          },
          transactions: [{ ...tx, contractMethod: null, contractInputsValues: null }],
        });
        if (sameAddress(owner, c.timelock)) {
          const tl = contract(c.timelock, "timelock"),
            delay = await tl.getMinDelay(tag);
          check(await tl.hasRole(role("PROPOSER_ROLE"), c.governanceSafe, tag), "Safe cannot propose timelock operation.");
          check(
            (await tl.hasRole(role("EXECUTOR_ROLE"), c.governanceSafe, tag)) || (await tl.hasRole(role("EXECUTOR_ROLE"), ZERO, tag)),
            "No configured timelock execution authority.",
          );
          const args = [[call.to], [0], [call.data], ZERO_HASH, E.id(digest(proposal))];
          write(
            path.join(out, "reward-claimer-schedule.safe.json"),
            safe("Schedule holder reward claimer", {
              to: c.timelock,
              value: "0",
              data: tl.interface.encodeFunctionData("scheduleBatch", [...args, delay]),
            }),
          );
          write(
            path.join(out, "reward-claimer-execute.safe.json"),
            safe("Execute holder reward claimer after maturity", {
              to: c.timelock,
              value: "0",
              data: tl.interface.encodeFunctionData("executeBatch", args),
            }),
          );
        } else write(path.join(out, "reward-claimer.safe.json"), safe("Set collateral-holder reward claimer", call));
      }
      write(path.join(out, `reward-${mode}-verification.json`), {
        ...common,
        managerCodeHash: E.keccak256(actual),
        passed: true,
        limitations:
          "Paused-state/source verification only. Requires complete role inventory and independent pinned-fork settlement tests; not reopening approval.",
      });
      console.log("Paused manager verified; no transaction was submitted.");
    }
    check((await provider.getBlock(b.number)).hash === b.hash, "Snapshot reorg: discard outputs and rerun.");
  } finally {
    await provider.destroy();
  }
}
main().catch((e) => {
  console.error(
    e?.constructor?.name === "IncidentError"
      ? e.message
      : "Reward validation failed. Check local manifest, artifacts, dependencies and RPC; no transaction was submitted.",
  );
  process.exitCode = 1;
});
