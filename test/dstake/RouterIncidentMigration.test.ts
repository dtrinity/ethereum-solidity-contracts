import { expect } from "chai";
import { ethers, network } from "hardhat";
import { backingFixture } from "../incident-2026-09-05/fixture";
import path from "node:path";
import { pathToFileURL } from "node:url";
import anchors from "../../scripts/incident-2026-09-05/ethereum.json";

// Preserve native ESM import under this repository's CommonJS ts-node configuration.
const importOps = (file: string) => new Function("url", "return import(url)")(pathToFileURL(path.resolve(file)).href);

const roleNames = [
  "DEFAULT_ADMIN_ROLE",
  "ADAPTER_MANAGER_ROLE",
  "CONFIG_MANAGER_ROLE",
  "VAULT_MANAGER_ROLE",
  "PAUSER_ROLE",
  "STRATEGY_REBALANCER_ROLE",
];
const role = (name: string) => (name === "DEFAULT_ADMIN_ROLE" ? ethers.ZeroHash : ethers.id(name));

async function migrationFixture(withRetirement = false) {
  const f = await backingFixture();
  await f.deposit(1_000n);
  await f.router.pause();
  const tl: any = await (
    await ethers.getContractFactory("TimelockController")
  ).deploy(60, [f.admin.address], [f.admin.address], f.admin.address);
  const replacement: any = await (await ethers.getContractFactory("DStakeRouterV2Incident")).deploy(f.token.target, f.collateral.target);
  const gov = await (await ethers.getContractFactory("DStakeRouterV2GovernanceModule")).deploy(f.token.target, f.collateral.target);
  const reb = await (await ethers.getContractFactory("DStakeRouterV2RebalanceModule")).deploy(f.token.target, f.collateral.target);
  await replacement.setGovernanceModule(gov.target);
  await replacement.setRebalanceModule(reb.target);
  await replacement.setVaultConfigs([[f.vault.target, f.adapter.target, 1_000_000, 1]]);
  for (const name of roleNames) await replacement.grantRole(role(name), tl.target);
  for (const name of [...roleNames].reverse()) await replacement.revokeRole(role(name), f.admin.address);
  for (const component of [f.token, f.collateral, f.adapter]) await component.grantRole(ethers.ZeroHash, tl.target);
  const oldCaller = await (await ethers.getContractFactory("FollowupCurvePoolSentinel")).deploy();
  const rewards: any = await (await ethers.getContractFactory("FollowupRewardsController")).deploy(f.asset.target);
  if (withRetirement) {
    await f.adapter.setAuthorizedCaller(oldCaller.target, true);
    await f.adapter.grantRole(ethers.ZeroHash, oldCaller.target);
    await f.collateral.grantRole(ethers.ZeroHash, oldCaller.target);
    await f.collateral.grantRole(ethers.id("ROUTER_ROLE"), oldCaller.target);
    await rewards.setClaimer(f.vault.target, oldCaller.target);
  }
  const guard: any = await (
    await ethers.getContractFactory("DStakeRouterMigrationGuard")
  ).deploy(
    tl.target,
    f.token.target,
    f.collateral.target,
    f.router.target,
    replacement.target,
    f.admin.address,
    withRetirement ? [oldCaller.target] : [],
    [f.adapter.target],
    withRetirement ? [[rewards.target, f.vault.target]] : [],
  );
  const call = (c: any, method: string, args: any[] = []) => ({ target: c.target, data: c.interface.encodeFunctionData(method, args) });
  const calls = [
    call(guard, "begin"),
    call(guard, "verifyLegacyCashHandled"),
    ...(withRetirement
      ? [
          call(f.adapter, "setAuthorizedCaller", [oldCaller.target, false]),
          call(f.adapter, "revokeRole", [ethers.ZeroHash, oldCaller.target]),
          call(f.collateral, "revokeRole", [ethers.ZeroHash, oldCaller.target]),
          call(f.collateral, "revokeRole", [ethers.id("ROUTER_ROLE"), oldCaller.target]),
        ]
      : []),
    call(f.adapter, "setAuthorizedCaller", [replacement.target, true]),
    call(f.collateral, "setRouter", [replacement.target]),
    call(f.token, "migrateCore", [replacement.target, f.collateral.target]),
    call(f.adapter, "setAuthorizedCaller", [f.router.target, false]),
    call(guard, "finish"),
  ];
  async function schedule(batch = calls) {
    const args = [
      batch.map((x) => x.target),
      batch.map(() => 0),
      batch.map((x) => x.data),
      ethers.ZeroHash,
      ethers.id("local incident migration test"),
    ];
    await tl.scheduleBatch(...args, 60);
    await network.provider.send("evm_increaseTime", [61]);
    await network.provider.send("evm_mine");
    return () => tl.executeBatch(...args);
  }
  return { ...f, tl, replacement, guard, oldCaller, rewards, calls, schedule };
}

describe("Incident router replacement — atomic governance migration", function () {
  it("encodes every containment variant using the CLI ABI", async function () {
    const { ABI } = await importOps("scripts/incident-2026-09-05/ops.mjs");
    const { migrationCalls } = await importOps("scripts/incident-2026-09-05/policy.mjs");
    const f = await migrationFixture();
    for (const paused of [false, true])
      for (const assetPaused of [false, true]) {
        const calls = migrationCalls(
          {
            oldRouter: f.router.target,
            token: f.token.target,
            collateral: f.collateral.target,
            asset: f.asset.target,
            idleVault: f.vault.target,
            retirement: { callers: [], claimers: [] },
          },
          { router: f.replacement.target, guard: f.guard.target },
          {
            paused,
            assetPaused,
            authority: { assetPauser: true },
            configs: [{ vault: f.vault.target, adapter: f.adapter.target }],
          },
        );
        for (const x of calls) expect(new ethers.Interface(ABI[x.contract]).encodeFunctionData(x.method, x.args)).to.match(/^0x[0-9a-f]+$/);
      }
  });

  it("creates the replacement already paused", async function () {
    const f = await backingFixture();
    const router: any = await (await ethers.getContractFactory("DStakeRouterV2Incident")).deploy(f.token.target, f.collateral.target);
    expect(await router.paused()).to.equal(true);
    expect(await router.BACKING_GUARD_VERSION()).to.equal(3);
  });

  it("rejects paused-cash rescue after the router becomes active", async function () {
    const f = await backingFixture();
    await f.router.pause();
    await f.asset.transfer(f.router.target, 1n);

    await expect(f.router.rescuePausedCash()).to.be.revertedWithCustomError(f.router, "ActiveRouterCashRescue");
    expect(await f.asset.balanceOf(f.router.target)).to.equal(1n);
  });

  it("allows paused-cash rescue only before router activation", async function () {
    const f = await backingFixture();
    const replacement: any = await (await ethers.getContractFactory("DStakeRouterV2Incident")).deploy(f.token.target, f.collateral.target);
    await f.asset.transfer(replacement.target, 1n);

    await replacement.rescuePausedCash();
    expect(await f.asset.balanceOf(replacement.target)).to.equal(0n);
  });

  it("fails closed when an inactive replacement cannot synchronize a new accounting asset", async function () {
    const f = await backingFixture();
    const replacement: any = await (await ethers.getContractFactory("DStakeRouterV2Incident")).deploy(f.token.target, f.collateral.target);
    const governance = await (
      await ethers.getContractFactory("DStakeRouterV2GovernanceModule")
    ).deploy(f.token.target, f.collateral.target);
    await replacement.setGovernanceModule(governance.target);
    const vault: any = await (await ethers.getContractFactory("IncidentAccountingVault")).deploy(f.asset.target);
    const adapter: any = await (
      await ethers.getContractFactory("GenericERC4626ConversionAdapter")
    ).deploy(f.asset.target, vault.target, f.collateral.target);

    await expect(
      replacement["addVaultConfig(address,address,uint256,uint8)"](vault.target, adapter.target, 1_000_000, 1),
    ).to.be.revertedWithCustomError(replacement, "StrategyShareAccountingNotSynchronized");
  });

  it("rejects old-generation delegatecall module metadata", async function () {
    const f = await backingFixture();
    const legacy = await (await ethers.getContractFactory("IncidentLegacyModuleMetadata")).deploy(f.token.target, f.collateral.target);
    await expect(f.router.setGovernanceModule(legacy.target)).to.be.revertedWithCustomError(f.router, "ModuleStorageMismatch");
  });

  it("migrates without moving holdings or changing backing/supply and leaves everything isolated", async function () {
    const f = await migrationFixture();
    const before = {
      assets: await f.token.totalAssets(),
      supply: await f.token.totalSupply(),
      shares: await f.vault.balanceOf(f.collateral.target),
    };
    const execute = await f.schedule();
    await execute();
    expect(await f.guard.phase()).to.equal(2);
    expect(await f.token.router()).to.equal(f.replacement.target);
    expect(await f.collateral.router()).to.equal(f.replacement.target);
    expect(await f.token.totalAssets()).to.equal(before.assets);
    expect(await f.token.totalSupply()).to.equal(before.supply);
    expect(await f.vault.balanceOf(f.collateral.target)).to.equal(before.shares);
    expect(await f.replacement.paused()).to.equal(true);
    expect(await f.router.paused()).to.equal(true);
    expect((await f.replacement.getVaultConfig(f.vault.target)).status).to.equal(1);
    expect(await f.adapter.hasRole(ethers.id("AUTHORIZED_CALLER_ROLE"), f.router.target)).to.equal(false);
  });

  it("rolls back the ENTIRE batch if legacy adapter authorization is not retired", async function () {
    const f = await migrationFixture();
    const legacyRevocation = f.adapter.interface.encodeFunctionData("setAuthorizedCaller", [f.router.target, false]);
    const execute = await f.schedule(f.calls.filter((call) => call.target !== f.adapter.target || call.data !== legacyRevocation));
    await expect(execute()).to.be.reverted;
    expect(await f.guard.phase()).to.equal(0);
    expect(await f.token.router()).to.equal(f.router.target);
    expect(await f.collateral.router()).to.equal(f.router.target);
    expect(await f.adapter.hasRole(ethers.id("AUTHORIZED_CALLER_ROLE"), f.replacement.target)).to.equal(false);
  });

  it("guards legacy cash reinvestment inside the migration backing snapshot", async function () {
    const f = await migrationFixture();
    await f.router.grantRole(ethers.ZeroHash, f.tl.target);
    await f.router.grantRole(role("PAUSER_ROLE"), f.tl.target);
    await f.asset.transfer(f.router.target, 100n);
    await f.asset.transfer(f.replacement.target, 1);
    const call = (c: any, method: string, args: any[] = []) => ({
      target: c.target,
      data: c.interface.encodeFunctionData(method, args),
    });
    const execute = await f.schedule([
      call(f.replacement, "rescuePausedCash"),
      call(f.guard, "begin"),
      call(f.router, "unpause"),
      call(f.router, "reinvestFees"),
      call(f.router, "pause"),
      call(f.guard, "verifyLegacyCashHandled"),
      ...f.calls.slice(2),
    ]);
    const beforeAssets = await f.token.totalAssets();
    const beforeShares = await f.vault.balanceOf(f.collateral.target);
    await execute();
    expect(await f.guard.phase()).to.equal(2);
    expect(await f.token.totalAssets()).to.equal(beforeAssets);
    expect(await f.asset.balanceOf(f.router.target)).to.equal(0n);
    expect(await f.asset.balanceOf(f.replacement.target)).to.equal(0n);
    expect(await f.asset.balanceOf(f.tl.target)).to.equal(1n);
    expect(await f.vault.balanceOf(f.collateral.target)).to.be.gt(beforeShares);
    expect(await f.token.router()).to.equal(f.replacement.target);
    expect(await f.replacement.paused()).to.equal(true);
    expect(await f.router.paused()).to.equal(true);
  });

  it("rolls back legacy cash handling when reinvestment loses backing", async function () {
    const f = await migrationFixture();
    await f.router.grantRole(ethers.ZeroHash, f.tl.target);
    await f.router.grantRole(role("PAUSER_ROLE"), f.tl.target);
    await f.asset.transfer(f.router.target, 100n);
    await f.vault.configure(2, 99, 0, 0);
    const call = (c: any, method: string, args: any[] = []) => ({
      target: c.target,
      data: c.interface.encodeFunctionData(method, args),
    });
    const execute = await f.schedule([
      call(f.guard, "begin"),
      call(f.router, "unpause"),
      call(f.router, "reinvestFees"),
      call(f.router, "pause"),
      call(f.guard, "verifyLegacyCashHandled"),
      ...f.calls.slice(2),
    ]);

    await expect(execute()).to.be.reverted;
    expect(await f.guard.phase()).to.equal(0);
    expect(await f.asset.balanceOf(f.router.target)).to.equal(100n);
    expect(await f.token.router()).to.equal(f.router.target);
  });

  it("does not silently forgive outstanding settlement shortfall", async function () {
    const f = await migrationFixture();
    await f.router.recordShortfall(1);
    const execute = await f.schedule();
    await expect(execute()).to.be.reverted;
    expect(await f.router.currentShortfall()).to.equal(1);
  });

  it("migrates an unpaused legacy router when containment is first, but rejects the old prefix", async function () {
    const f = await migrationFixture();
    await f.router.unpause();
    await f.router.grantRole(role("PAUSER_ROLE"), f.tl.target);
    const execute = await f.schedule();
    await expect(execute()).to.be.reverted;
    expect(await f.guard.phase()).to.equal(0);
    const compressed = await f.schedule([{ target: f.router.target, data: f.router.interface.encodeFunctionData("pause") }, ...f.calls]);
    await compressed();
    expect(await f.guard.phase()).to.equal(2);
    expect(await f.router.paused()).to.equal(true);
    expect(await f.replacement.paused()).to.equal(true);
    expect(await f.token.router()).to.equal(f.replacement.target);
  });

  it("rolls back new-router unpause after cash verification", async function () {
    const f = await migrationFixture();
    const execute = await f.schedule([
      ...f.calls.slice(0, -1),
      { target: f.replacement.target, data: f.replacement.interface.encodeFunctionData("unpause") },
      f.calls.at(-1)!,
    ]);
    await expect(execute()).to.be.reverted;
    expect(await f.guard.phase()).to.equal(0);
    expect(await f.replacement.paused()).to.equal(true);
    expect(await f.token.router()).to.equal(f.router.target);
  });

  it("requires legacy independent claimer retirement, not just adapter revocation", async function () {
    const f = await migrationFixture(true);
    const execute = await f.schedule();
    await expect(execute()).to.be.reverted;
    expect(await f.guard.phase()).to.equal(0);
    expect(await f.token.router()).to.equal(f.router.target);
    expect(await f.adapter.hasRole(ethers.id("AUTHORIZED_CALLER_ROLE"), f.oldCaller.target)).to.equal(true);
  });

  it("verifies independent retirement after the separately governed claimer precondition", async function () {
    const f = await migrationFixture(true);
    await f.rewards.setClaimer(f.vault.target, ethers.ZeroAddress);
    const execute = await f.schedule();
    await execute();
    expect(await f.guard.phase()).to.equal(2);
    expect(await f.adapter.hasRole(ethers.ZeroHash, f.oldCaller.target)).to.equal(false);
    expect(await f.collateral.hasRole(ethers.id("ROUTER_ROLE"), f.oldCaller.target)).to.equal(false);
  });

  it("rolls back if a legacy adapter admin remains able to reauthorize itself", async function () {
    const f = await migrationFixture(true);
    await f.rewards.setClaimer(f.vault.target, ethers.ZeroAddress);
    const revoke = f.adapter.interface.encodeFunctionData("revokeRole", [ethers.ZeroHash, f.oldCaller.target]);
    const execute = await f.schedule(f.calls.filter((x) => x.data !== revoke));
    await expect(execute()).to.be.reverted;
    expect(await f.guard.phase()).to.equal(0);
    expect(await f.token.router()).to.equal(f.router.target);
  });

  it("cannot be started by an unprivileged sender", async function () {
    const f = await migrationFixture();
    await expect(f.guard.connect(f.user).begin()).to.be.revertedWithCustomError(f.guard, "TimelockOnly");
  });
});

// Optional real integration regression. Only the in-process Hardhat chain is mutated.
// No wallet key, live CREATE, reviewed-manifest override, or production signoff.
(process.env.MIGRATION_FORK_RPC_URL ? describe : describe.skip)("Compressed migration — pinned Ethereum integration", function () {
  this.timeout(600_000);

  it("parks leftover cash in Idle without unfreezing dLEND, then restores containment in one batch", async function () {
    expect(network.name).to.equal("hardhat");
    try {
      await network.provider.send("hardhat_reset", [
        {
          forking: { jsonRpcUrl: process.env.MIGRATION_FORK_RPC_URL, blockNumber: 25923361 },
        },
      ]);
    } catch {
      throw new Error("Cannot initialize pinned Ethereum fork; RPC details suppressed.");
    }
    try {
      expect((await ethers.provider.getNetwork()).chainId).to.equal(31337n);
      // Local gas bookkeeping only; avoid stale fee estimates across hardhat_reset.
      await network.provider.send("hardhat_setNextBlockBaseFeePerGas", ["0x0"]);
      const { ABI, inventory } = await importOps("scripts/incident-2026-09-05/ops.mjs");
      const { migrationCalls, assertMigrationPlan } = await importOps("scripts/incident-2026-09-05/policy.mjs");
      const s = await inventory(anchors, ethers.provider);
      expect(s.blockHash).to.equal("0xd4079757543ee2522d030c769f24887c24055adee2f73812928956bb2f65be1e");
      expect(s.paused).to.equal(false);
      expect(s.assetPaused).to.equal(true);
      expect(s.dlend.frozen).to.equal(true);
      expect(s.dlend.poolAdmin).to.equal(true);
      expect(s.authority.assetPauser && s.authority.routerPauser).to.equal(true);
      expect(s.configs.some((v: any) => v.vault.toLowerCase() === anchors.idleVault.toLowerCase())).to.equal(true);
      const [admin] = await ethers.getSigners();
      const replacement: any = await (await ethers.getContractFactory("DStakeRouterV2Incident")).deploy(anchors.token, anchors.collateral);
      for (const [name, setter] of [
        ["DStakeRouterV2GovernanceModule", "setGovernanceModule"],
        ["DStakeRouterV2RebalanceModule", "setRebalanceModule"],
      ]) {
        const module = await (await ethers.getContractFactory(name)).deploy(anchors.token, anchors.collateral);
        await replacement[setter](module.target);
      }
      await replacement.setMaxVaultCount(s.maxVaults);
      await replacement.setVaultConfigs(s.configs.map((v: any) => [v.vault, v.adapter, v.targetBps, 1]));
      for (const [setter, value] of [
        ["setWithdrawalFee", s.fee],
        ["setReinvestIncentive", s.incentive],
        ["setDustTolerance", s.dust],
        ["setDepositCap", s.cap],
      ])
        await replacement[setter](value);
      for (const name of roleNames) await replacement.grantRole(role(name), anchors.timelock);
      for (const name of [...roleNames].reverse()) await replacement.revokeRole(role(name), admin.address);
      // Scope: live cash/core integration, not a certification of production retirement completeness.
      // Retirement is exercised independently in the local tests above; live reviewed flags stay false.
      const guard: any = await (
        await ethers.getContractFactory("DStakeRouterMigrationGuard")
      ).deploy(
        anchors.timelock,
        anchors.token,
        anchors.collateral,
        anchors.oldRouter,
        replacement.target,
        admin.address,
        [],
        s.configs.map((v: any) => v.adapter),
        [],
      );
      const d = { router: replacement.target, guard: guard.target };
      const semantic = migrationCalls(anchors, d, s);
      assertMigrationPlan(semantic, anchors, d, s);
      const get = (address: string, kind: string) => new ethers.Contract(address, [...ABI[kind], ...ABI.access], ethers.provider);
      const asset = get(anchors.asset, "asset"),
        old = get(anchors.oldRouter, "router");
      const token = get(anchors.token, "token"),
        pool = get(s.dlend.pool, "pool");
      await network.provider.send("hardhat_impersonateAccount", [anchors.governanceSafe]);
      await network.provider.send("hardhat_setBalance", [anchors.governanceSafe, "0x56bc75e2d63100000"]);
      const gov = await ethers.getSigner(anchors.governanceSafe);
      const tl: any = get(anchors.timelock, "timelock").connect(gov);
      const execute = async (calls: any[], secondsAfterDelay = 1) => {
        const args = [
          calls.map((x) => x.to),
          calls.map(() => 0),
          calls.map((x) => new ethers.Interface(ABI[x.contract]).encodeFunctionData(x.method, x.args)),
          ethers.ZeroHash,
          ethers.id("compressed migration fork regression"),
        ];
        const delay = await tl.getMinDelay();
        expect(delay).to.equal(86400n);
        await network.provider.send("evm_setNextBlockTimestamp", [s.timestamp + 600]);
        await tl.scheduleBatch(...args, delay);
        await network.provider.send("evm_setNextBlockTimestamp", [s.timestamp + 600 + Number(delay) + secondsAfterDelay]);
        return () => tl.executeBatch(...args);
      };
      // Dedicated sabotage: without each required prefix leg, the actual live path reverts.
      for (const omit of [
        (x: any, i: number) => i === 1, // old frozen plan lacked the initial router pause
        (x: any) => x.contract === "asset" && x.method === "unpause",
        (x: any) => x.method === "setVaultConfigs",
      ]) {
        const snapshot = await network.provider.send("evm_snapshot");
        const run = await execute(semantic.filter((x: any, i: number) => !omit(x, i)));
        await expect(run()).to.be.reverted;
        expect(await guard.phase()).to.equal(0);
        expect(await token.router()).to.equal(anchors.oldRouter);
        expect(await asset.paused()).to.equal(true);
        await network.provider.send("evm_revert", [snapshot]);
      }
      const cash = await asset.balanceOf(anchors.oldRouter);
      expect(cash).to.be.gt(0n);
      const safeCash = await asset.balanceOf(anchors.governanceSafe);
      const timelockCash = await asset.balanceOf(anchors.timelock);
      const supply = await token.totalSupply();
      const idle = s.configs.find((v: any) => v.vault.toLowerCase() === anchors.idleVault.toLowerCase());
      const idleSharesBefore = await get(anchors.idleVault, "strategy").balanceOf(anchors.collateral);
      // Idle has no floating dLEND index; delay+2 must still conserve backing. Never widen the guard.
      const snapshot = await network.provider.send("evm_snapshot");
      const later = await execute(semantic, 2);
      await later();
      expect(await guard.phase()).to.equal(2);
      expect(await token.totalSupply()).to.equal(supply);
      expect(await asset.balanceOf(anchors.oldRouter)).to.equal(0n);
      expect(Boolean((await pool.getConfiguration(anchors.asset)).data & (1n << 57n))).to.equal(true);
      await network.provider.send("evm_revert", [snapshot]);
      const run = await execute(semantic);
      await run();
      expect(await guard.phase()).to.equal(2); // exact intra-transaction backing/supply continuity
      expect(await guard.startingLegacyCash()).to.equal(cash);
      expect(await asset.balanceOf(anchors.oldRouter)).to.equal(0n);
      expect(await asset.balanceOf(anchors.governanceSafe)).to.equal(safeCash);
      expect(await asset.balanceOf(anchors.timelock)).to.equal(timelockCash);
      expect(await token.totalSupply()).to.equal(supply);
      expect(await token.router()).to.equal(replacement.target);
      expect(await get(anchors.collateral, "collateral").router()).to.equal(replacement.target);
      expect(await old.paused()).to.equal(true);
      expect(await asset.paused()).to.equal(true);
      expect(Boolean((await pool.getConfiguration(anchors.asset)).data & (1n << 57n))).to.equal(true);
      expect(await replacement.paused()).to.equal(true);
      expect(idle).to.not.equal(undefined);
      expect(await get(anchors.idleVault, "strategy").balanceOf(anchors.collateral)).to.be.gt(idleSharesBefore);
      for (const v of s.configs) {
        const cloned = await replacement.getVaultConfig(v.vault);
        expect(cloned.targetBps).to.equal(BigInt(v.targetBps));
        expect(cloned.status).to.equal(1n);
      }
    } finally {
      await network.provider.send("hardhat_stopImpersonatingAccount", [anchors.governanceSafe]);
      await network.provider.send("hardhat_reset");
    }
  });
});
