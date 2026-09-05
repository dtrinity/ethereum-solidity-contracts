#!/usr/bin/env node
// Read-only archive-RPC role discovery. No assumption that AccessControl is enumerable.
import fs from "node:fs";
import { check, digest } from "../incident-2026-09-05/policy.mjs";
async function main() {
  const [input, output] = process.argv.slice(2);
  check(input && output && process.argv.length === 4, "Usage: role-inventory.mjs INPUT.json OUTPUT.json (ETHEREUM_RPC_URL required)");
  const c = JSON.parse(fs.readFileSync(input, "utf8"));
  check(
    Number.isSafeInteger(c.chainId) && Array.isArray(c.contracts) && c.contracts.length > 0,
    "Specify chainId and contracts [{address,fromBlock,label}].",
  );
  const E = await import("ethers");
  check(process.env.ETHEREUM_RPC_URL, "ETHEREUM_RPC_URL required.");
  const p = new E.JsonRpcProvider(process.env.ETHEREUM_RPC_URL);
  try {
    check(Number((await p.getNetwork()).chainId) === c.chainId, "Wrong chain.");
    const b = await p.getBlock(c.blockNumber ?? "latest");
    check(b?.hash, "Cannot pin block.");
    const abi = [
      "event RoleGranted(bytes32 indexed role,address indexed account,address indexed sender)",
      "event RoleRevoked(bytes32 indexed role,address indexed account,address indexed sender)",
      "function hasRole(bytes32,address) view returns(bool)",
    ];
    const iface = new E.Interface(abi),
      topics = [E.id("RoleGranted(bytes32,address,address)"), E.id("RoleRevoked(bytes32,address,address)")];
    const entries = [];
    for (const item of c.contracts) {
      check(
        E.isAddress(item.address) && Number.isSafeInteger(item.fromBlock) && item.fromBlock >= 0 && item.fromBlock <= b.number,
        "Invalid contract/start block.",
      );
      check((await p.getCode(item.address, b.number)) !== "0x", "No code at inventory block.");
      if (item.fromBlock > 0)
        check(
          (await p.getCode(item.address, item.fromBlock - 1)) === "0x",
          "Start block is after contract deployment: refuse incomplete role history.",
        );
      const candidates = new Map();
      let logCount = 0;
      for (let from = item.fromBlock; from <= b.number; from += 2000) {
        // Fail on EVERY missing/failed range. Never silently skip RPC log errors.
        const logs = await p.getLogs({
          address: item.address,
          fromBlock: from,
          toBlock: Math.min(from + 1999, b.number),
          topics: [topics],
        });
        for (const log of logs) {
          const parsed = iface.parseLog(log);
          check(parsed, "Unparseable role event.");
          candidates.set(`${parsed.args.role}:${parsed.args.account.toLowerCase()}`, {
            role: parsed.args.role,
            account: parsed.args.account,
          });
          logCount++;
        }
      }
      const ac = new E.Contract(item.address, abi, p),
        roles = [];
      for (const candidate of candidates.values())
        roles.push({ ...candidate, active: await ac.hasRole(candidate.role, candidate.account, { blockTag: b.number }) });
      entries.push({ ...item, codeHash: E.keccak256(await p.getCode(item.address, b.number)), eventCount: logCount, roles });
    }
    check((await p.getBlock(b.number)).hash === b.hash, "Block reorg; retry.");
    const report = {
      chainId: c.chainId,
      blockNumber: b.number,
      blockHash: b.hash,
      inputHash: digest(c),
      entries,
      limitations: [
        "Only listed contracts are scanned. Include current AND historical adapters, collateral vaults and managers.",
        "AccessControl must emit role events. Nonstandard grant mechanisms require independent storage/source review.",
        "This does not enumerate rewards-controller claimer users; inspect wrapper and collateral user explicitly with incident ops.",
      ],
    };
    fs.writeFileSync(output, JSON.stringify(report, null, 2) + "\n", { mode: 0o600 });
    console.log("Block-pinned role inventory written. No transaction submitted.");
  } finally {
    await p.destroy();
  }
}
main().catch((e) => {
  console.error(
    e?.constructor?.name === "IncidentError"
      ? e.message
      : "Role inventory failed. Inspect RPC/archive configuration locally; no partial report is authoritative.",
  );
  process.exitCode = 1;
});
