#!/usr/bin/env node
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import {
  IncidentError,
  check,
  fail,
  canonical,
  digest,
  sameAddress,
  lower,
  ZERO,
  ZERO_HASH,
  PRIVILEGED_ROLES,
  validateInventory,
  migrationCalls,
  assertMigrationPlan,
  isLocalUrl,
} from "./policy.mjs";
import { retirementAdapters, validateRetirement } from "./policy.mjs";

const HERE = path.dirname(fileURLToPath(import.meta.url));
const ROOT = path.resolve(HERE, "../..");
const ARTIFACTS = {
  router: ["incident/DStakeRouterV2Incident.sol", "DStakeRouterV2Incident"],
  governance: ["DStakeRouterV2GovernanceModule.sol", "DStakeRouterV2GovernanceModule"],
  rebalance: ["DStakeRouterV2RebalanceModule.sol", "DStakeRouterV2RebalanceModule"],
  guard: ["incident/DStakeRouterMigrationGuard.sol", "DStakeRouterMigrationGuard"],
};
const ABI = {
  access: ["function hasRole(bytes32,address) view returns(bool)", "function revokeRole(bytes32,address)"],
  asset: [
    "function balanceOf(address) view returns(uint256)",
    "function allowance(address,address) view returns(uint256)",
    "function paused() view returns(bool)",
    "function pause()",
  ],
  token: [
    "function router() view returns(address)",
    "function collateralVault() view returns(address)",
    "function asset() view returns(address)",
    "function totalAssets() view returns(uint256)",
    "function totalSupply() view returns(uint256)",
    "function migrateCore(address,address)",
  ],
  collateral: [
    "function dStakeToken() view returns(address)",
    "function dStable() view returns(address)",
    "function router() view returns(address)",
    "function getSupportedStrategyShares() view returns(address[])",
    "function setRouter(address)",
  ],
  strategy: [
    "function asset() view returns(address)",
    "function balanceOf(address) view returns(uint256)",
    "function totalSupply() view returns(uint256)",
    "function totalAssets() view returns(uint256)",
    "function previewRedeem(uint256) view returns(uint256)",
  ],
  adapter: [
    "function strategyShare() view returns(address)",
    "function collateralVault() view returns(address)",
    "function strategyShareValueInDStable(address,uint256) view returns(uint256)",
    "function setAuthorizedCaller(address,bool)",
  ],
  router: [
    "function paused() view returns(bool)",
    "function pause()",
    "function dStakeToken() view returns(address)",
    "function collateralVault() view returns(address)",
    "function totalManagedAssets() view returns(uint256)",
    "function currentShortfall() view returns(uint256)",
    "function depositCap() view returns(uint256)",
    "function withdrawalFeeBps() view returns(uint256)",
    "function reinvestIncentiveBps() view returns(uint256)",
    "function dustTolerance() view returns(uint256)",
    "function maxVaultCount() view returns(uint256)",
    "function defaultDepositStrategyShare() view returns(address)",
    "function getVaultCount() view returns(uint256)",
    "function getVaultConfigByIndex(uint256) view returns(tuple(address strategyVault,address adapter,uint256 targetBps,uint8 status))",
    "function strategyShareToAdapter(address) view returns(address)",
    "function governanceModule() view returns(address)",
    "function rebalanceModule() view returns(address)",
    "function BACKING_GUARD_VERSION() view returns(uint256)",
    "function operationRoundingLoss() view returns(uint256)",
    "function strategyRoundingLoss(address) view returns(uint256)",
  ],
  emission: [
    "function setClaimer(address,address)",
    "function owner() view returns(address)",
    "function getRewardsController() view returns(address)",
  ],
  rewardsController: ["function getClaimer(address) view returns(address)"],
  module: ["function moduleMetadata() view returns(bytes32,address,address)"],
  guard: [
    "function retirementConfigHash() view returns(bytes32)",
    "function begin()",
    "function finish()",
    "function phase() view returns(uint8)",
    "function oldRouter() view returns(address)",
    "function newRouter() view returns(address)",
    "function token() view returns(address)",
    "function collateral() view returns(address)",
    "function timelock() view returns(address)",
    "function retiredDeployer() view returns(address)",
  ],
  timelock: [
    "function getMinDelay() view returns(uint256)",
    "function scheduleBatch(address[],uint256[],bytes[],bytes32,bytes32,uint256)",
    "function executeBatch(address[],uint256[],bytes[],bytes32,bytes32) payable",
    "function hashOperationBatch(address[],uint256[],bytes[],bytes32,bytes32) pure returns(bytes32)",
    "function isOperationDone(bytes32) view returns(bool)",
    "function getTimestamp(bytes32) view returns(uint256)",
  ],
};
let E;
const HELP = `Ethereum sdUSD incident operations — no live writes by default.

node scripts/incident-2026-09-05/ops.mjs <command> [options]

Commands:
  inventory    Block-pinned identities, balances, roles, implementation/code hashes.
  containment  Unsigned emergency dUSD-pause and timelock router-pause Safe files.
  deploy       Review plan for a paused router, fresh modules and migration guard.
  plan         Unsigned ATOMIC timelock migration schedule/execute Safe files.
  simulate     Execute a saved migration on a LOCAL Hardhat fork, then revert it.
  verify       Recheck replacement code, wiring, permissions and paused state.

Options:
  --rpc-env NAME          Environment variable containing RPC URL (default ETHEREUM_RPC_URL).
  --config FILE          Anchor config (default adjacent ethereum.json).
  --out DIR              Output directory (default /tmp/dstake-incident-2026-09-05).
  --deployer ADDRESS     Required for deploy; never infer it from a private key.
  --deployment FILE      deployment.json returned by an executed deployment.
  --plan FILE            migration-plan.json for simulate.
  --review-sha256 HASH   Must equal the printed deployment-plan digest before writes.
  --broadcast            Explicit LIVE deployment of new, paused components ONLY.
  --local-fork           Require localhost URL, chain 31337, hardhat_metadata.
  --execute              Explicit local-fork deployment or simulation (never live governance).
  --dry-run              Explicit read-only mode, incompatible with write flags.
  --max-fee-gwei N       EIP-1559 maxFeePerGas cap. Required for --broadcast. Aborts if the network is more expensive (wait).
  --priority-gwei N      EIP-1559 maxPriorityFeePerGas (default 0.05). Must be <= max fee.

No command signs, submits, or executes a LIVE Safe/timelock governance operation.
DEPLOYER_PK is read only by an explicitly approved LIVE deployment.
`;

function parse(argv) {
  const command = argv.shift() || "help";
  const allowed = new Set([
    "rpc-env",
    "config",
    "out",
    "deployer",
    "deployment",
    "plan",
    "review-sha256",
    "broadcast",
    "execute",
    "dry-run",
    "local-fork",
    "max-fee-gwei",
    "priority-gwei",
  ]);
  const flags = new Set(["broadcast", "execute", "dry-run", "local-fork"]);
  const options = {};
  while (argv.length) {
    const key = argv.shift();
    check(key.startsWith("--") && allowed.has(key.slice(2)), "Unknown command-line option.");
    const name = key.slice(2);
    check(!(name in options), "Duplicate command-line option.");
    if (flags.has(name)) options[name] = true;
    else {
      check(argv.length > 0 && !argv[0].startsWith("--"), "Missing option value.");
      options[name] = argv.shift();
    }
  }
  check(!(options["dry-run"] && (options.broadcast || options.execute)), "Dry-run and write flags are mutually exclusive.");
  check(!(options.broadcast && options.execute), "Choose live broadcast OR local execute, not both.");
  check(!options.broadcast || command === "deploy", "Live writes are supported only for deploying replacement components.");
  check(!options.execute || ["deploy", "simulate"].includes(command), "Execute is supported only for local-fork rehearsal.");
  check(!options.execute || options["local-fork"], "Execute requires --local-fork.");
  check(!(options.broadcast && options["local-fork"]), "Use --execute for a local fork, not --broadcast.");
  check(
    !options.broadcast || options["max-fee-gwei"],
    "Live broadcast requires --max-fee-gwei so the deployer waits instead of overpaying.",
  );
  return { command, options };
}

function parseGwei(raw, label) {
  check(typeof raw === "string" && /^[0-9]+(\.[0-9]{1,9})?$/.test(raw), `Invalid ${label}.`);
  const wei = E.parseUnits(raw, "gwei");
  check(wei > 0n, `${label} must be positive.`);
  return wei;
}

async function liveFeeOverrides(provider, options) {
  const maxFee = parseGwei(options["max-fee-gwei"], "--max-fee-gwei");
  const priority = parseGwei(options["priority-gwei"] || "0.05", "--priority-gwei");
  check(priority <= maxFee, "--priority-gwei must not exceed --max-fee-gwei.");
  const fees = await provider.getFeeData();
  const networkMax = fees.maxFeePerGas ?? fees.gasPrice;
  check(networkMax, "Provider did not return fee data.");
  if (networkMax > maxFee) {
    fail(
      `Network max fee ${E.formatUnits(networkMax, "gwei")} gwei exceeds --max-fee-gwei ${E.formatUnits(maxFee, "gwei")}. Wait for cheaper gas; refusing to overpay.`,
    );
  }
  console.log(
    `Using EIP-1559 fees: maxFeePerGas=${E.formatUnits(maxFee, "gwei")} gwei, priority=${E.formatUnits(priority, "gwei")} gwei (network ~${E.formatUnits(networkMax, "gwei")} gwei).`,
  );
  return { maxFeePerGas: maxFee, maxPriorityFeePerGas: priority, type: 2 };
}
function readJson(file) {
  try {
    return JSON.parse(fs.readFileSync(file, "utf8"));
  } catch {
    fail("A required JSON/artifact file could not be read or parsed.");
  }
}
function write(file, value) {
  fs.mkdirSync(path.dirname(file), { recursive: true, mode: 0o700 });
  const tmp = `${file}.tmp`;
  fs.writeFileSync(tmp, `${JSON.stringify(value, (_, v) => (typeof v === "bigint" ? v.toString() : v), 2)}\n`, { mode: 0o600 });
  fs.renameSync(tmp, file);
}
const role = (name) => (name === "DEFAULT_ADMIN_ROLE" ? ZERO_HASH : E.id(name));
const contract = (address, kind, provider) => new E.Contract(address, [...ABI[kind], ...ABI.access], provider);
const safe = (c, title, transactions, signer = c.governanceSafe) => ({
  version: "1.0",
  chainId: String(c.chainId),
  createdAt: Date.now(),
  meta: {
    name: title,
    description: "Unsigned incident proposal. Independently review and simulate. No reopening is included.",
    txBuilderVersion: "1.18.0",
    createdFromSafeAddress: signer,
  },
  transactions: transactions.map((x) => ({ to: x.to, value: "0", data: x.data, contractMethod: null, contractInputsValues: null })),
});

async function connect(c, options) {
  const envName = options["rpc-env"] || "ETHEREUM_RPC_URL";
  check(/^[A-Z][A-Z0-9_]*$/.test(envName), "Invalid RPC environment-variable name.");
  const raw = process.env[envName];
  check(raw, "RPC environment variable is not set.");
  if (options["local-fork"]) check(isLocalUrl(raw), "Fork execution requires a loopback RPC URL.");
  const provider = new E.JsonRpcProvider(raw);
  const chainId = Number((await provider.getNetwork()).chainId);
  if (options["local-fork"]) {
    check(chainId === 31337, "Local fork must use chain ID 31337, never mainnet chain ID 1.");
    const metadata = await provider.send("hardhat_metadata", []);
    check(
      metadata && metadata.forkedNetwork && Number(metadata.forkedNetwork.chainId) === Number(c.chainId),
      "Not a Hardhat fork of the configured target chain.",
    );
  } else check(chainId === Number(c.chainId), "RPC chain does not match anchor configuration.");
  return provider;
}

async function fingerprint(provider, address, block) {
  const code = await provider.getCode(address, block);
  check(code !== "0x", "An anchor/strategy/adapter address has no deployed code.");
  const slot = E.toBeHex(BigInt(E.id("eip1967.proxy.implementation")) - 1n, 32);
  const raw = await provider.getStorage(address, slot, block);
  const implementation = `0x${raw.slice(-40)}`;
  let implementationHash = null;
  if (!sameAddress(implementation, ZERO)) {
    const implCode = await provider.getCode(implementation, block);
    check(implCode !== "0x", "Implementation slot points at an address without code.");
    implementationHash = E.keccak256(implCode);
  }
  return { address, codeHash: E.keccak256(code), implementation, implementationHash };
}

async function inventory(c, provider) {
  const block = await provider.getBlock("latest");
  check(block && block.hash, "Cannot pin a canonical block.");
  const tag = { blockTag: block.number };
  const r = contract(c.oldRouter, "router", provider);
  const t = contract(c.token, "token", provider);
  const cv = contract(c.collateral, "collateral", provider);
  const a = contract(c.asset, "asset", provider);
  const tl = contract(c.timelock, "timelock", provider);
  const s = {
    chainId: c.chainId,
    blockNumber: block.number,
    blockHash: block.hash,
    timestamp: block.timestamp,
    tokenRouter: await t.router(tag),
    vaultRouter: await cv.router(tag),
    tokenCollateral: await t.collateralVault(tag),
    tokenAsset: await t.asset(tag),
    routerToken: await r.dStakeToken(tag),
    routerCollateral: await r.collateralVault(tag),
    vaultToken: await cv.dStakeToken(tag),
    vaultAsset: await cv.dStable(tag),
    paused: await r.paused(tag),
    assetPaused: await a.paused(tag),
    supply: String(await t.totalSupply(tag)),
    assets: String(await t.totalAssets(tag)),
    managed: String(await r.totalManagedAssets(tag)),
    shortfall: String(await r.currentShortfall(tag)),
    cap: String(await r.depositCap(tag)),
    fee: String(await r.withdrawalFeeBps(tag)),
    incentive: String(await r.reinvestIncentiveBps(tag)),
    dust: String(await r.dustTolerance(tag)),
    maxVaults: String(await r.maxVaultCount(tag)),
    defaultVault: await r.defaultDepositStrategyShare(tag),
    routerCash: String(await a.balanceOf(c.oldRouter, tag)),
    tokenAllowance: String(await a.allowance(c.token, c.oldRouter, tag)),
    delay: String(await tl.getMinDelay(tag)),
    supported: [...(await cv.getSupportedStrategyShares(tag))],
    configs: [],
    code: {},
    authority: {
      tokenAdmin: await t.hasRole(ZERO_HASH, c.timelock, tag),
      vaultAdmin: await cv.hasRole(ZERO_HASH, c.timelock, tag),
      routerPauser: await r.hasRole(role("PAUSER_ROLE"), c.timelock, tag),
      proposer: await tl.hasRole(role("PROPOSER_ROLE"), c.governanceSafe, tag),
      executor: (await tl.hasRole(role("EXECUTOR_ROLE"), c.governanceSafe, tag)) || (await tl.hasRole(role("EXECUTOR_ROLE"), ZERO, tag)),
      emergencyAssetPauser: await a.hasRole(role("PAUSER_ROLE"), c.emergencySafe, tag),
    },
  };
  const count = Number(await r.getVaultCount(tag));
  check(count <= 100, "Unexpectedly large strategy inventory; review manually.");
  for (let i = 0; i < count; i++) {
    const v = await r.getVaultConfigByIndex(i, tag);
    const strategy = contract(v.strategyVault, "strategy", provider);
    const adapter = contract(v.adapter, "adapter", provider);
    const balance = await strategy.balanceOf(c.collateral, tag);
    s.configs.push({
      vault: v.strategyVault,
      adapter: v.adapter,
      targetBps: String(v.targetBps),
      status: Number(v.status),
      asset: await strategy.asset(tag),
      adapterShare: await adapter.strategyShare(tag),
      adapterCollateral: await adapter.collateralVault(tag),
      mappedAdapter: await r.strategyShareToAdapter(v.strategyVault, tag),
      balance: String(balance),
      strategySupply: String(await strategy.totalSupply(tag)),
      strategyAssets: String(await strategy.totalAssets(tag)),
      redeemable: String(balance ? await strategy.previewRedeem(balance, tag) : 0n),
      reported: String(balance ? await adapter.strategyShareValueInDStable(v.strategyVault, balance, tag) : 0n),
      adapterAdmin: await adapter.hasRole(ZERO_HASH, c.timelock, tag),
      legacyAuthorized: await adapter.hasRole(role("AUTHORIZED_CALLER_ROLE"), c.oldRouter, tag),
    });
  }
  const addresses = new Set(
    [
      c.token,
      c.asset,
      c.collateral,
      c.oldRouter,
      c.timelock,
      await r.governanceModule(tag),
      await r.rebalanceModule(tag),
      ...s.configs.flatMap((v) => [v.vault, v.adapter]),
    ].map(lower),
  );
  for (const address of addresses) s.code[address] = await fingerprint(provider, address, block.number);
  check((await provider.getBlock(block.number)).hash === block.hash, "Snapshot block was reorganized; retry.");
  return s;
}

function artifact(key) {
  const [source, name] = ARTIFACTS[key];
  const file = path.join(ROOT, "artifacts/contracts/vaults/dstake", source, `${name}.json`);
  const a = readJson(file);
  check(a.bytecode && a.bytecode !== "0x" && a.deployedBytecode, "Missing compiler bytecode; compile first.");
  check(Object.keys(a.linkReferences || {}).length === 0, "Unexpected linked library; refuse unreviewed deployment.");
  check((a.deployedBytecode.length - 2) / 2 <= 24_576, "Runtime exceeds EIP-170 size limit.");
  const dbg = readJson(file.replace(/\.json$/, ".dbg.json"));
  const build = readJson(path.resolve(path.dirname(file), dbg.buildInfo));
  check(build.solcVersion === "0.8.20" && build.input.settings.viaIR === true, "Unexpected compiler/pipeline for incident contracts.");
  check(build.input.settings.optimizer?.enabled && build.input.settings.optimizer?.runs === 200, "Unexpected optimizer settings.");
  for (const [sourceName, input] of Object.entries(build.input.sources)) {
    if (!sourceName.startsWith("contracts/")) continue;
    check(fs.existsSync(path.join(ROOT, sourceName)), "Compiler input refers to a missing repository source.");
    check(
      fs.readFileSync(path.join(ROOT, sourceName), "utf8") === input.content,
      "Stale artifact: source differs from compiler input. Clean and recompile.",
    );
  }
  const compiled = build.output.contracts[a.sourceName][name];
  check(`0x${compiled.evm.deployedBytecode.object}` === a.deployedBytecode, "Artifact/build-info bytecode mismatch.");
  return { ...a, immutableReferences: compiled.evm.deployedBytecode.immutableReferences || {}, buildDigest: digest(build.input) };
}

async function assertRuntime(provider, address, key) {
  const a = artifact(key);
  const actual = await provider.getCode(address);
  check(actual.length === a.deployedBytecode.length, "Deployed replacement runtime length differs from reviewed artifact.");
  let normalized = actual.slice(2).split("");
  const expected = a.deployedBytecode.slice(2);
  for (const refs of Object.values(a.immutableReferences)) {
    for (const { start, length } of refs) {
      for (let i = start * 2; i < (start + length) * 2; i++) normalized[i] = expected[i];
    }
  }
  check(normalized.join("") === expected, "Replacement runtime differs outside compiler-declared immutable slots.");
  return E.keccak256(actual);
}

async function deploymentPlan(c, s, provider, deployer) {
  check(E.isAddress(deployer), "A valid --deployer address is required.");
  check(
    ![c.token, c.collateral, c.timelock, c.oldRouter].some((x) => sameAddress(x, deployer)),
    "Deployer must be a separate account, not a protocol anchor.",
  );
  const nonce = await provider.getTransactionCount(deployer, "pending");
  const names = ["router", "governance", "rebalance", "guard"];
  const addresses = Object.fromEntries(names.map((n, i) => [n, E.getCreateAddress({ from: deployer, nonce: nonce + i })]));
  const txs = [];
  const builds = {};
  for (const key of names) {
    const a = artifact(key);
    builds[key] = a.buildDigest;
    const args =
      key === "guard"
        ? [
            c.timelock,
            c.token,
            c.collateral,
            c.oldRouter,
            addresses.router,
            deployer,
            c.retirement.callers,
            retirementAdapters(c, s),
            c.retirement.claimers.map((q) => [q.controller, q.user]),
          ]
        : [c.token, c.collateral];
    const factory = new E.ContractFactory(a.abi, a.bytecode);
    const tx = await factory.getDeployTransaction(...args);
    check((tx.data.length - 2) / 2 <= 49_152, "Initcode exceeds EIP-3860 size limit.");
    txs.push({ label: `Deploy ${key}`, data: tx.data, value: "0", expectedAddress: addresses[key] });
  }
  const iface = new E.Interface(artifact("router").abi);
  const add = (method, args) => txs.push({ label: method, to: addresses.router, value: "0", data: iface.encodeFunctionData(method, args) });
  add("setGovernanceModule", [addresses.governance]);
  add("setRebalanceModule", [addresses.rebalance]);
  add("setMaxVaultCount", [s.maxVaults]);
  add("setVaultConfigs", [s.configs.map((v) => [v.vault, v.adapter, v.targetBps, 1])]); // Suspended, INCLUDING Idle
  add("setOperationRoundingLoss", [c.rounding.operationLoss]);
  for (const v of c.rounding.strategies) add("setStrategyRoundingLoss", [v.vault, v.loss]);
  add("setWithdrawalFee", [s.fee]);
  add("setReinvestIncentive", [s.incentive]);
  add("setDustTolerance", [s.dust]);
  add("setDepositCap", [s.cap]);
  for (const name of PRIVILEGED_ROLES) add("grantRole", [role(name), c.timelock]);
  for (const name of [...PRIVILEGED_ROLES].reverse()) add("revokeRole", [role(name), deployer]); // admin last
  return { format: 1, targetChainId: c.chainId, deployer, startNonce: nonce, addresses, builds, transactions: txs };
}

async function deploy(c, s, provider, options, out) {
  validateInventory(c, s);
  await verifyRetirementInputs(c, s, provider);
  const plan = await deploymentPlan(c, s, provider, options.deployer);
  const review = digest(plan);
  write(path.join(out, "deployment-plan.json"), { ...plan, reviewSha256: review });
  console.log(`Deployment review SHA-256: ${review}`);
  console.log(
    `Prepared ${plan.transactions.length} transactions. No existing protocol authority or pointer is changed by this deployment.`,
  );
  if (options["max-fee-gwei"] && E) {
    const cap = parseGwei(options["max-fee-gwei"], "--max-fee-gwei");
    const guess = 13_500_000n;
    console.log(
      `At --max-fee-gwei ${options["max-fee-gwei"]}, ~13.5M gas would cost at most ${E.formatEther(guess * cap)} ETH (upper bound, not an estimate).`,
    );
  }
  if (!options.broadcast && !options.execute) return;
  check(options["review-sha256"] === review, "Review digest mismatch; inspect the new dry-run plan before signing.");
  let signer;
  if (options.execute) {
    await provider.send("hardhat_impersonateAccount", [options.deployer]);
    await provider.send("hardhat_setBalance", [options.deployer, "0x56bc75e2d63100000"]);
    signer = await provider.getSigner(options.deployer);
  } else {
    check(process.env.DEPLOYER_PK, "DEPLOYER_PK is required only for explicitly approved live deployment.");
    signer = new E.Wallet(process.env.DEPLOYER_PK, provider);
    check(sameAddress(await signer.getAddress(), options.deployer), "Signing account differs from reviewed deployer.");
  }
  const fee = options.broadcast ? await liveFeeOverrides(provider, options) : {};
  const journal = {
    ...plan.addresses,
    deployer: options.deployer,
    targetChainId: c.chainId,
    localFork: Boolean(options.execute),
    reviewSha256: review,
    builds: plan.builds,
    receipts: [],
    complete: false,
  };
  write(path.join(out, "deployment.json"), journal);
  try {
    for (let i = 0; i < plan.transactions.length; i++) {
      const tx = plan.transactions[i];
      const response = await signer.sendTransaction({
        to: tx.to,
        data: tx.data,
        value: 0n,
        nonce: plan.startNonce + i,
        ...fee,
      });
      const receipt = await response.wait(1);
      check(
        receipt && receipt.status === 1,
        "A deployment/bootstrap transaction failed. Stop; inspect the journal. Never wire a partial deployment.",
      );
      if (tx.expectedAddress) check(sameAddress(receipt.contractAddress, tx.expectedAddress), "Unexpected CREATE address.");
      journal.receipts.push({ label: tx.label, hash: receipt.hash, blockNumber: receipt.blockNumber, gasUsed: String(receipt.gasUsed) });
      write(path.join(out, "deployment.json"), journal);
      console.log(`Mined replacement-only step ${i + 1}/${plan.transactions.length}: ${receipt.hash}`);
    }
    journal.codeHashes = {};
    for (const key of Object.keys(ARTIFACTS)) journal.codeHashes[key] = await assertRuntime(provider, journal[key], key);
    await verifyReplacement(c, journal, provider, false);
    journal.complete = true;
    write(path.join(out, "deployment.json"), journal);
  } finally {
    if (options.execute) await provider.send("hardhat_stopImpersonatingAccount", [options.deployer]);
  }
}

async function operation(c, provider, calls, label) {
  const tl = contract(c.timelock, "timelock", provider);
  const targets = calls.map((x) => x.to);
  const values = calls.map(() => "0");
  const datas = calls.map((x) => x.data);
  const predecessor = ZERO_HASH;
  const salt = E.id(`dstake-2026-09-05:${label}:${digest({ targets, values, datas })}`);
  const delay = String(await tl.getMinDelay());
  const id = await tl.hashOperationBatch(targets, values, datas, predecessor, salt);
  const iface = new E.Interface(ABI.timelock);
  return {
    targets,
    values,
    datas,
    predecessor,
    salt,
    delay,
    id,
    scheduledTimestamp: String(await tl.getTimestamp(id)),
    schedule: { to: c.timelock, data: iface.encodeFunctionData("scheduleBatch", [targets, values, datas, predecessor, salt, delay]) },
    execute: { to: c.timelock, data: iface.encodeFunctionData("executeBatch", [targets, values, datas, predecessor, salt]) },
  };
}

async function containment(c, s, provider, out) {
  check(
    s.authority.proposer && s.authority.executor && s.authority.routerPauser,
    "Current authority does not support the proposed router pause.",
  );
  if (!s.paused) {
    const calls = [{ to: c.oldRouter, data: new E.Interface(ABI.router).encodeFunctionData("pause") }];
    const op = await operation(c, provider, calls, "containment");
    write(path.join(out, "containment-operation.json"), op);
    write(path.join(out, "containment-schedule.safe.json"), safe(c, "Schedule legacy sdUSD router pause", [op.schedule]));
    write(
      path.join(out, "containment-execute.safe.json"),
      safe(c, "Execute legacy sdUSD router pause AFTER timelock maturity", [op.execute]),
    );
  }
  if (!s.assetPaused) {
    check(s.authority.emergencyAssetPauser, "Emergency Safe currently lacks the dUSD pauser role.");
    const call = { to: c.asset, data: new E.Interface(ABI.asset).encodeFunctionData("pause") };
    write(
      path.join(out, "emergency-dUSD-pause.safe.json"),
      safe(c, "dUSD emergency pause — preserve/reuse existing Safe nonce and signatures", [call], c.emergencySafe),
    );
  }
  console.log(
    "Unsigned containment files prepared. Do not supersede a pending emergency-Safe transaction or assume signatures are interchangeable.",
  );
}

async function verifyReplacement(c, d, provider, migrated) {
  check(Number(d.targetChainId) === Number(c.chainId), "Deployment chain mismatch.");
  for (const key of Object.keys(ARTIFACTS)) {
    const hash = await assertRuntime(provider, d[key], key);
    if (d.codeHashes) check(hash === d.codeHashes[key], "Replacement runtime hash changed since deployment.");
  }
  const r = contract(d.router, "router", provider);
  check(await r.paused(), "Replacement router is not paused.");
  check((await r.BACKING_GUARD_VERSION()) === 3n, "Unexpected guard version.");
  check(
    sameAddress(await r.dStakeToken(), c.token) && sameAddress(await r.collateralVault(), c.collateral),
    "Replacement immutable anchors mismatch.",
  );
  check(
    sameAddress(await r.governanceModule(), d.governance) && sameAddress(await r.rebalanceModule(), d.rebalance),
    "Replacement module pointers mismatch.",
  );
  const expectedFingerprint = E.id("dtrinity.dstake.router.v2.storage:3:bounded-rounding-and-compounding");
  for (const module of [d.governance, d.rebalance]) {
    const [fp, token, vault] = await contract(module, "module", provider).moduleMetadata();
    check(fp === expectedFingerprint && sameAddress(token, c.token) && sameAddress(vault, c.collateral), "Module metadata mismatch.");
  }
  for (const name of PRIVILEGED_ROLES) {
    check(await r.hasRole(role(name), c.timelock), "Replacement is missing a timelock role.");
    check(!(await r.hasRole(role(name), d.deployer)), "Deployer still has replacement authority.");
  }
  check(await r.hasRole(role("DSTAKE_TOKEN_ROLE"), c.token), "Token router role is missing.");
  check(!(await r.hasRole(role("DSTAKE_TOKEN_ROLE"), d.deployer)), "Deployer must not hold the token callback role.");
  check(
    String(await r.operationRoundingLoss()) === c.rounding.operationLoss,
    "Operation rounding policy differs from reviewed configuration.",
  );
  for (const v of c.rounding.strategies)
    check(String(await r.strategyRoundingLoss(v.vault)) === v.loss, "Strategy rounding policy mismatch.");
  const guard = contract(d.guard, "guard", provider);
  for (const [getter, expected] of Object.entries({
    oldRouter: c.oldRouter,
    newRouter: d.router,
    token: c.token,
    collateral: c.collateral,
    timelock: c.timelock,
    retiredDeployer: d.deployer,
  })) {
    check(sameAddress(await guard[getter](), expected), "Migration guard immutable anchors mismatch.");
  }
  check((await r.currentShortfall()) === 0n, "Unexpected replacement shortfall.");
  check(sameAddress(await r.defaultDepositStrategyShare(), ZERO), "Replacement default must remain clear during incident isolation.");
  const count = Number(await r.getVaultCount());
  check(count > 0 && count <= 100, "Unexpected replacement strategy count.");
  for (let i = 0; i < count; i++) {
    const v = await r.getVaultConfigByIndex(i);
    check(Number(v.status) === 1, "A replacement strategy is not suspended.");
    const expectedLoss = c.rounding.strategies.find((x) => sameAddress(x.vault, v.strategyVault))?.loss ?? "1";
    check(String(await r.strategyRoundingLoss(v.strategyVault)) === expectedLoss, "Unexpected unreviewed per-strategy rounding policy.");
    if (migrated) {
      const adapter = contract(v.adapter, "adapter", provider);
      check(await adapter.hasRole(role("AUTHORIZED_CALLER_ROLE"), d.router), "New adapter caller role missing.");
      check(!(await adapter.hasRole(role("AUTHORIZED_CALLER_ROLE"), c.oldRouter)), "Legacy adapter authorization remains.");
    }
  }
  if (migrated) {
    check((await guard.phase()) === 2n, "Migration guard has not verified a completed batch.");
    check(sameAddress(await contract(c.token, "token", provider).router(), d.router), "Token was not migrated.");
    const cv = contract(c.collateral, "collateral", provider);
    check(sameAddress(await cv.router(), d.router), "Collateral vault was not migrated.");
    check(
      !(await cv.hasRole(role("ROUTER_ROLE"), c.oldRouter)) && (await cv.hasRole(role("ROUTER_ROLE"), d.router)),
      "Custody roles not migrated.",
    );
    check(await contract(c.oldRouter, "router", provider).paused(), "Legacy router no longer paused.");
    const adapters = new Set(c.retirement.extraAdapters.map(lower));
    for (let i = 0; i < count; i++) adapters.add(lower((await r.getVaultConfigByIndex(i)).adapter));
    for (const caller of c.retirement.callers) {
      for (const address of adapters)
        for (const name of ["DEFAULT_ADMIN_ROLE", "AUTHORIZED_CALLER_ROLE"]) {
          check(
            !(await contract(address, "adapter", provider).hasRole(role(name), caller)),
            "Retired independent adapter capability has reappeared.",
          );
        }
      for (const name of ["DEFAULT_ADMIN_ROLE", "ROUTER_ROLE"])
        check(!(await cv.hasRole(role(name), caller)), "Retired custody capability has reappeared.");
    }
    for (const q of c.retirement.claimers)
      check(
        sameAddress(await contract(q.controller, "rewardsController", provider).getClaimer(q.user), ZERO),
        "Legacy claimer is not zero. Run this isolation check BEFORE later reward activation.",
      );
  }
}

async function verifyRetirementInputs(c, s, provider) {
  validateRetirement(c);
  const tag = { blockTag: s.blockNumber };
  for (const caller of c.retirement.callers) {
    check((await provider.getCode(caller, s.blockNumber)) !== "0x", "Retired caller has no code; reconcile the inventory.");
    // Recognize the concrete historical dLEND manager when its getters exist.
    // Both wrong-layer wrapper and correct holder mappings must be reconciled.
    const legacy = new E.Contract(
      caller,
      [
        "function targetStaticATokenWrapper() view returns(address)",
        "function dLendRewardsController() view returns(address)",
        "function dStakeCollateralVault() view returns(address)",
      ],
      provider,
    );
    let wrapper;
    try {
      wrapper = await legacy.targetStaticATokenWrapper(tag);
    } catch (error) {
      if (error?.code !== "CALL_EXCEPTION") throw error; // do not hide RPC failures
    }
    if (wrapper && !sameAddress(wrapper, ZERO)) {
      const controller = await legacy.dLendRewardsController(tag);
      check(
        sameAddress(await legacy.dStakeCollateralVault(tag), c.collateral),
        "Legacy reward manager belongs to another collateral vault.",
      );
      for (const user of [wrapper, c.collateral]) {
        check(
          c.retirement.claimers.some((q) => sameAddress(q.controller, controller) && sameAddress(q.user, user)),
          "Legacy dLEND wrapper AND collateral-holder claimer entries are required.",
        );
      }
    }
  }
  const adapters = retirementAdapters(c, s);
  check(adapters.length <= 100, "Combined historical/current adapter inventory exceeds guard bounds.");
  for (const address of adapters) {
    const a = contract(address, "adapter", provider);
    check(await a.hasRole(role("DEFAULT_ADMIN_ROLE"), c.timelock, tag), "Timelock cannot retire every adapter capability.");
    check(sameAddress(await a.collateralVault(tag), c.collateral), "Retirement adapter points to another collateral vault.");
  }
  for (const q of c.retirement.claimers) {
    const e = contract(q.emissionManager, "emission", provider);
    check(sameAddress(await e.getRewardsController(tag), q.controller), "EmissionManager/controller mismatch.");
    const actual = await contract(q.controller, "rewardsController", provider).getClaimer(q.user, tag);
    if (q.preconditionOnly) {
      check(sameAddress(actual, ZERO), "Separately governed claimer revocation has not been executed.");
    } else {
      check(
        sameAddress(await e.owner(tag), c.timelock),
        "EmissionManager not owned by timelock: execute the reviewed revocation separately and mark preconditionOnly.",
      );
      check(
        sameAddress(actual, ZERO) || c.retirement.callers.some((x) => sameAddress(x, actual)),
        "Unrecognized existing claimer: do not overwrite another manager.",
      );
    }
  }
}

async function migration(c, s, d, provider, out) {
  validateInventory(c, s, true);
  await verifyRetirementInputs(c, s, provider);
  const encodedRetirement = E.AbiCoder.defaultAbiCoder().encode(
    ["address[]", "address[]", "tuple(address controller,address user)[]"],
    [c.retirement.callers, retirementAdapters(c, s), c.retirement.claimers.map((q) => [q.controller, q.user])],
  );
  check(
    (await contract(d.guard, "guard", provider).retirementConfigHash()) === E.keccak256(encodedRetirement),
    "Retirement inventory differs from immutable guard configuration.",
  );
  check(d.complete, "Replacement deployment/bootstrap did not complete.");
  await verifyReplacement(c, d, provider, false);
  const newRouter = contract(d.router, "router", provider);
  check(Number(await newRouter.getVaultCount()) === s.configs.length, "Replacement inventory count differs.");
  for (let i = 0; i < s.configs.length; i++) {
    const v = await newRouter.getVaultConfigByIndex(i);
    const old = s.configs[i];
    check(
      sameAddress(v.strategyVault, old.vault) && sameAddress(v.adapter, old.adapter) && String(v.targetBps) === old.targetBps,
      "Replacement configuration differs from fresh legacy snapshot.",
    );
  }
  for (const [getter, expected] of Object.entries({
    withdrawalFeeBps: s.fee,
    depositCap: s.cap,
    reinvestIncentiveBps: s.incentive,
    dustTolerance: s.dust,
    maxVaultCount: s.maxVaults,
  })) {
    check(String(await newRouter[getter]()) === expected, "Replacement economic settings differ from the fresh legacy snapshot.");
  }
  check(
    (await contract(c.asset, "asset", provider).balanceOf(d.router)) === 0n,
    "Replacement router has unexpected cash; reconcile before migration.",
  );
  check((await contract(d.guard, "guard", provider).phase()) === 0n, "Migration guard has already been used.");
  const semantic = migrationCalls(c, d, s);
  assertMigrationPlan(semantic, c, d, s);
  const calls = semantic.map((x) => ({
    to: x.to,
    data: new E.Interface(ABI[x.contract]).encodeFunctionData(
      x.method,
      x.args.map((a) => (a === "ROUTER_ROLE" ? role("ROUTER_ROLE") : a)),
    ),
  }));
  const op = await operation(c, provider, calls, "migration");
  const plan = { format: 1, config: c, deployment: d, inventory: s, semantic, operation: op, requiresLegacyPause: true, noReopening: true };
  plan.reviewSha256 = digest(plan);
  write(path.join(out, "migration-plan.json"), plan);
  write(path.join(out, "migration-schedule.safe.json"), safe(c, "Schedule ATOMIC paused sdUSD router replacement", [op.schedule]));
  write(
    path.join(out, "migration-execute.safe.json"),
    safe(c, "Execute ATOMIC paused replacement ONLY AFTER legacy pause and timelock maturity", [op.execute]),
  );
  console.log(`Migration review SHA-256: ${plan.reviewSha256}`);
  console.log(
    "Legacy router MUST be paused before execution. All replacement strategies stay suspended; no unpause/unfreeze or LP restoration is included.",
  );
}

async function simulate(plan, provider, options, out) {
  const { reviewSha256, ...body } = plan;
  check(digest(body) === reviewSha256, "Saved migration plan checksum mismatch.");
  assertMigrationPlan(plan.semantic, plan.config, plan.deployment, plan.inventory);
  const encoded = plan.semantic.map((x) =>
    new E.Interface(ABI[x.contract]).encodeFunctionData(
      x.method,
      x.args.map((a) => (a === "ROUTER_ROLE" ? role("ROUTER_ROLE") : a)),
    ),
  );
  check(canonical(encoded) === canonical(plan.operation.datas), "Encoded calls differ from semantic plan.");
  check(canonical(plan.semantic.map((x) => x.to)) === canonical(plan.operation.targets), "Encoded targets differ from semantic plan.");
  check(
    plan.operation.values.every((x) => BigInt(x) === 0n),
    "Unexpected ETH value in migration.",
  );
  const tlInterface = new E.Interface(ABI.timelock);
  const op = plan.operation;
  const schedule = tlInterface.encodeFunctionData("scheduleBatch", [op.targets, op.values, op.datas, op.predecessor, op.salt, op.delay]);
  const execute = tlInterface.encodeFunctionData("executeBatch", [op.targets, op.values, op.datas, op.predecessor, op.salt]);
  check(schedule === op.schedule.data && execute === op.execute.data, "Timelock envelope mismatch.");
  check(sameAddress(op.schedule.to, plan.config.timelock) && sameAddress(op.execute.to, plan.config.timelock), "Wrong timelock target.");
  if (!options.execute) {
    console.log("Simulation dry-run: add --local-fork --execute to exercise and revert the local batch.");
    return;
  }
  const snapshot = await provider.send("evm_snapshot", []);
  const gov = plan.config.governanceSafe;
  try {
    await provider.send("hardhat_impersonateAccount", [gov]);
    await provider.send("hardhat_setBalance", [gov, "0x56bc75e2d63100000"]);
    const signer = await provider.getSigner(gov);
    const send = async (tx) => {
      const r = await (await signer.sendTransaction({ to: tx.to, data: tx.data, value: 0n })).wait();
      check(r && r.status === 1, "Local-fork governance transaction failed.");
      return r;
    };
    // Rehearse containment through the REAL timelock, not by impersonating it.
    const old = contract(plan.config.oldRouter, "router", provider);
    if (!(await old.paused())) {
      const stop = await operation(
        plan.config,
        provider,
        [{ to: plan.config.oldRouter, data: new E.Interface(ABI.router).encodeFunctionData("pause") }],
        `fork-containment-${snapshot}`,
      );
      await send(stop.schedule);
      await provider.send("evm_increaseTime", [Number(stop.delay) + 1]);
      await provider.send("evm_mine", []);
      await send(stop.execute);
    }
    const before = {
      assets: String(await contract(plan.config.token, "token", provider).totalAssets()),
      supply: String(await contract(plan.config.token, "token", provider).totalSupply()),
    };
    const timestamp = await contract(plan.config.timelock, "timelock", provider).getTimestamp(op.id);
    check(timestamp !== 1n, "Migration operation is already executed; use verify instead of replaying it.");
    if (timestamp === 0n) await send(op.schedule);
    await provider.send("evm_increaseTime", [Number(op.delay) + 1]);
    await provider.send("evm_mine", []);
    const receipt = await send(op.execute); // ONE atomic executeBatch, guard begin/finish inside
    await verifyReplacement(plan.config, plan.deployment, provider, true);
    const after = {
      assets: String(await contract(plan.config.token, "token", provider).totalAssets()),
      supply: String(await contract(plan.config.token, "token", provider).totalSupply()),
    };
    write(path.join(out, "fork-simulation.json"), {
      reviewSha256,
      passed: true,
      executionHash: receipt.hash,
      beforeScheduling: before,
      afterExecution: after,
      note: "Assets may accrue during timelock delay. The on-chain guard checked EXACT equality across the migration transaction itself. Fork is reverted after this check; this is not a reopening approval.",
    });
    console.log(
      "Local atomic migration passed postconditions. Reverting the fork snapshot; this does not certify exploit non-profitability or reopening safety.",
    );
  } finally {
    await provider.send("hardhat_stopImpersonatingAccount", [gov]);
    check(await provider.send("evm_revert", [snapshot]), "Could not restore local fork snapshot.");
  }
}

async function main() {
  const { command, options } = parse(process.argv.slice(2));
  if (command === "help" || command === "--help") {
    console.log(HELP);
    return;
  }
  check(["inventory", "containment", "deploy", "plan", "simulate", "verify"].includes(command), "Unknown command.");
  E = await import("ethers");
  const c = readJson(options.config || path.join(HERE, "ethereum.json"));
  for (const key of ["token", "asset", "collateral", "oldRouter", "idleVault", "timelock", "governanceSafe", "emergencySafe"]) {
    check(/^0x[0-9a-fA-F]{40}$/.test(c[key]), "Invalid anchor address.");
    c[key] = E.getAddress(lower(c[key]));
  }
  check(Number(c.chainId) === 1, "This incident tool is scoped to Ethereum mainnet only.");
  const provider = await connect(c, options);
  const out = path.resolve(options.out || "/tmp/dstake-incident-2026-09-05");
  try {
    if (command === "simulate") {
      check(options.plan, "--plan is required.");
      const plan = readJson(options.plan);
      check(digest(plan.config) === digest(c), "Plan anchors differ from the selected configuration.");
      await simulate(plan, provider, options, out);
      return;
    }
    if (command === "verify") {
      check(options.deployment, "--deployment is required.");
      const d = readJson(options.deployment);
      check(d.complete, "Deployment journal is incomplete.");
      check(Boolean(d.localFork) === Boolean(options["local-fork"]), "Rehearsal and live deployment records must not be interchanged.");
      await verifyReplacement(c, d, provider, true);
      write(path.join(out, "post-migration-verification.json"), {
        verifiedAt: new Date().toISOString(),
        deployment: d.router,
        pausedAndIsolated: true,
        reopeningApproved: false,
      });
      return;
    }
    const s = await inventory(c, provider);
    write(path.join(out, "inventory.json"), s);
    if (command === "inventory") {
      console.log(`Recorded block-pinned inventory at block ${s.blockNumber}. This is not a source/runtime certification.`);
      return;
    }
    if (command === "containment") {
      await containment(c, s, provider, out);
      return;
    }
    if (command === "deploy") {
      await deploy(c, s, provider, options, out);
      return;
    }
    check(options.deployment, "--deployment is required.");
    const d = readJson(options.deployment);
    check(
      Boolean(d.localFork) === Boolean(options["local-fork"]),
      "A local rehearsal deployment cannot be presented as a live deployment.",
    );
    await migration(c, s, d, provider, out);
  } finally {
    provider.destroy();
  }
}
main().catch((error) => {
  // Never echo ethers request objects, RPC URLs, wallet errors or environment values.
  console.error(
    error instanceof IncidentError
      ? error.message
      : "Operation failed. Raw provider/wallet diagnostics were suppressed to avoid leaking credentials. Check local dependencies, compilation, RPC access and on-chain preconditions.",
  );
  process.exitCode = 1;
});
