import { expect } from "chai";
import { ethers, network } from "hardhat";
import { backingFixture } from "../incident-2026-09-05/fixture";

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
  it("creates the replacement already paused", async function () {
    const f = await backingFixture();
    const router: any = await (await ethers.getContractFactory("DStakeRouterV2Incident")).deploy(f.token.target, f.collateral.target);
    expect(await router.paused()).to.equal(true);
    expect(await router.BACKING_GUARD_VERSION()).to.equal(3);
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
    const execute = await f.schedule(f.calls.filter((_, i) => i !== 4));
    await expect(execute()).to.be.reverted;
    expect(await f.guard.phase()).to.equal(0);
    expect(await f.token.router()).to.equal(f.router.target);
    expect(await f.collateral.router()).to.equal(f.router.target);
    expect(await f.adapter.hasRole(ethers.id("AUTHORIZED_CALLER_ROLE"), f.replacement.target)).to.equal(false);
  });

  it("does not strand legacy router cash, including unsolicited dust", async function () {
    const f = await migrationFixture();
    await f.asset.transfer(f.router.target, 1);
    const execute = await f.schedule();
    await expect(execute()).to.be.reverted;
    expect(await f.token.router()).to.equal(f.router.target);
  });

  it("skims unsolicited dUSD off both paused routers inside the same batch", async function () {
    const f = await migrationFixture();
    await f.router.grantRole(ethers.ZeroHash, f.tl.target);
    await f.router.grantRole(role("PAUSER_ROLE"), f.tl.target);
    await f.asset.transfer(f.router.target, 1);
    await f.asset.transfer(f.replacement.target, 1);
    const call = (c: any, method: string, args: any[] = []) => ({
      target: c.target,
      data: c.interface.encodeFunctionData(method, args),
    });
    const execute = await f.schedule([
      call(f.router, "unpause"),
      call(f.router, "reinvestFees"),
      call(f.router, "pause"),
      call(f.replacement, "rescuePausedCash"),
      ...f.calls,
    ]);
    const beforeShares = await f.vault.balanceOf(f.collateral.target);
    await execute();
    expect(await f.guard.phase()).to.equal(2);
    expect(await f.asset.balanceOf(f.router.target)).to.equal(0n);
    expect(await f.asset.balanceOf(f.replacement.target)).to.equal(0n);
    expect(await f.asset.balanceOf(f.tl.target)).to.equal(1n);
    expect(await f.vault.balanceOf(f.collateral.target)).to.be.gt(beforeShares);
    expect(await f.token.router()).to.equal(f.replacement.target);
    expect(await f.replacement.paused()).to.equal(true);
    expect(await f.router.paused()).to.equal(true);
  });

  it("does not silently forgive outstanding settlement shortfall", async function () {
    const f = await migrationFixture();
    await f.router.recordShortfall(1);
    const execute = await f.schedule();
    await expect(execute()).to.be.reverted;
    expect(await f.router.currentShortfall()).to.equal(1);
  });

  it("rejects an unpaused legacy router", async function () {
    const f = await migrationFixture();
    await f.router.unpause();
    const execute = await f.schedule();
    await expect(execute()).to.be.reverted;
    expect(await f.guard.phase()).to.equal(0);
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
