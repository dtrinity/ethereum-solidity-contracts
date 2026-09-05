import { expect } from "chai";
import { ethers, network } from "hardhat";

const route = () => Array(11).fill(ethers.ZeroAddress);
const params = () => Array.from({ length: 5 }, () => [0, 0, 0, 0]);
const emptyPermit = (token: string) => [token, 0, 0, 0, ethers.ZeroHash, ethers.ZeroHash];

describe("Follow-up: Curve entry-point consent", function () {
  for (const kind of ["Liquidity", "Repay", "Withdraw"] as const) {
    for (const flash of kind === "Withdraw" ? [false] : [false, true]) {
      it(`${kind}, flash=${flash}: rejects an outsider despite victim approval, before touching the pool`, async function () {
        const [owner, victim, outsider] = await ethers.getSigners();
        const pool: any = await (await ethers.getContractFactory("FollowupCurvePoolSentinel")).deploy();
        const token: any = await (await ethers.getContractFactory("IncidentMintableERC20")).deploy();
        const name = kind === "Withdraw" ? "CurveWithdrawSwapAdapter" : `Curve${kind}SwapAdapter`;
        const actualName = kind === "Repay" ? "CurveRepayAdapter" : name;
        const adapter: any = await (
          await ethers.getContractFactory(actualName)
        ).deploy(pool.target, pool.target, pool.target, owner.address);
        await token.mint(victim.address, 1000);
        await token.connect(victim).approve(adapter.target, ethers.MaxUint256);
        let method: string, input: any;
        if (kind === "Liquidity") {
          method = "swapLiquidity";
          input = [token.target, 100, token.target, 1, victim.address, flash, route(), params()];
        } else if (kind === "Repay") {
          method = "repayWithCollateral";
          input = [token.target, 100, token.target, 100, 2, flash, victim.address, route(), params()];
        } else {
          method = "withdrawAndSwap";
          input = [token.target, 100, token.target, 1, victim.address, route(), params()];
        }
        await expect(adapter.connect(outsider)[method](input, emptyPermit(String(token.target))))
          .to.be.revertedWithCustomError(adapter, "UnauthorizedUser")
          .withArgs(outsider.address, victim.address);
        expect(await token.balanceOf(victim.address)).to.equal(1000);
        expect(await token.allowance(victim.address, adapter.target)).to.equal(ethers.MaxUint256);
        // A genuine self-call passes consent and reaches the pool. This is NOT a
        // successful swap proof: full supported-route/fork regressions remain mandatory.
        await expect(adapter.connect(victim)[method](input, emptyPermit(String(token.target)))).to.be.revertedWithCustomError(
          pool,
          "ExternalProtocolTouched",
        );
      });
    }
  }
});

describe("Follow-up: composite oracle conservative freshness", function () {
  async function fixture() {
    const f1: any = await (await ethers.getContractFactory("FollowupFeed")).deploy();
    const f2: any = await (await ethers.getContractFactory("FollowupFeed")).deploy();
    const composite: any = await (
      await ethers.getContractFactory("ChainlinkCompositeAggregator")
    ).deploy(f1.target, f2.target, [0, 0], [0, 0]);
    const block = await ethers.provider.getBlock("latest");
    return { f1, f2, composite, now: block!.timestamp };
  }
  for (const older of [1, 2]) {
    it(`reports feed ${older}'s older timestamp, not the fresher dependency`, async function () {
      const { f1, f2, composite, now } = await fixture();
      const old = now - 3600;
      await f1.setTimes(older === 1 ? old : now, older === 1 ? old : now);
      await f2.setTimes(older === 2 ? old : now, older === 2 ? old : now);
      const round = await composite.latestRoundData();
      expect(round.updatedAt).to.equal(old);
      expect(round.startedAt).to.equal(old);
      expect(round.answer).to.equal(100_000_000);
    });
  }
  for (const invalid of ["zero", "future", "stale"] as const) {
    it(`rejects ${invalid} dependency timestamps`, async function () {
      const { f1, composite, now } = await fixture();
      const ts = invalid === "zero" ? 0 : invalid === "future" ? now + 100_000 : now - 25 * 3600;
      await f1.setTimes(ts, ts);
      await expect(composite.latestRoundData()).to.be.revertedWithCustomError(
        composite,
        invalid === "stale" ? "PriceIsStale" : "InvalidFeedTimestamp",
      );
    });
  }
  it("makes a stricter downstream heartbeat able to detect an old leg", async function () {
    const { f1, f2, composite, now } = await fixture();
    const old = now - (24 * 3600 + 45 * 60);
    await f1.setTimes(old, old);
    await f2.setTimes(now, now);
    const round = await composite.latestRoundData();
    const block = await ethers.provider.getBlock("latest");
    expect(BigInt(block!.timestamp) - round.updatedAt).to.be.gt(BigInt(24 * 3600 + 30 * 60));
    await network.provider.send("evm_setNextBlockTimestamp", [old + 25 * 3600]);
    await network.provider.send("evm_mine");
    await expect(composite.latestRoundData()).to.be.revertedWithCustomError(composite, "PriceIsStale");
  });
});
