import { HardhatEthersSigner } from "@nomicfoundation/hardhat-ethers/signers";
import { expect } from "chai";
import { ContractTransactionReceipt, LogDescription } from "ethers";
import { ethers, getNamedAccounts } from "hardhat";

import { ERC20StablecoinUpgradeable } from "../../typechain-types/contracts/dstable/ERC20StablecoinUpgradeable";
import { DStakeRouterV2 } from "../../typechain-types/contracts/vaults/dstake/DStakeRouterV2.sol";
import { DStakeTokenV2 } from "../../typechain-types/contracts/vaults/dstake/DStakeTokenV2";
import { createDStakeFixture, DSTAKE_CONFIGS, DStakeFixtureConfig, DStakeFixtureResult } from "./fixture";

const BPS_SCALE = 1_000_000n;

describe("dSTAKE shortfall & fee accounting", function () {
  DSTAKE_CONFIGS.forEach((config: DStakeFixtureConfig) => {
    describe(config.DStakeTokenSymbol, function () {
      const loadFixture = createDStakeFixture(config);

      let deployer: HardhatEthersSigner;
      let user: HardhatEthersSigner;
      let holder: HardhatEthersSigner;
      let keeper: HardhatEthersSigner;
      let router: DStakeRouterV2;
      let dStakeToken: DStakeTokenV2;
      let dStableToken: ERC20StablecoinUpgradeable;
      let routerAddress: string;
      let dStakeTokenAddress: string;
      let decimals: number;
      let admin: HardhatEthersSigner;

      const parseRouterEvent = (receipt: ContractTransactionReceipt, eventName: string): LogDescription | undefined => {
        for (const log of receipt.logs) {
          try {
            const parsed = router.interface.parseLog(log);
            if (parsed.name === eventName) {
              return parsed;
            }
          } catch {
            continue;
          }
        }
        return undefined;
      };

      const mintDStable = async (recipient: string, amount: bigint) => {
        await dStableToken.connect(deployer).mint(recipient, amount);
      };

      const depositFor = async (account: HardhatEthersSigner, amount: bigint) => {
        await mintDStable(account.address, amount);
        await dStableToken.connect(account).approve(dStakeTokenAddress, amount);
        await dStakeToken.connect(account).deposit(amount, account.address);
        return amount;
      };

      const maxDepositFor = async (account: HardhatEthersSigner) => {
        const limit = await dStakeToken.maxDeposit(account.address);
        if (limit === 0n) {
          throw new Error(`max deposit unavailable for ${account.address}`);
        }
        return limit;
      };

      const fractionOf = async (account: HardhatEthersSigner, divisor: bigint) => {
        const limit = await maxDepositFor(account);
        let amount = limit / divisor;
        if (amount === 0n) {
          amount = limit;
        }
        return amount;
      };

      const routerIdleBalance = async () => {
        return dStableToken.balanceOf(routerAddress);
      };

      const toUnits = (value: string) => ethers.parseUnits(value, decimals);

      beforeEach(async function () {
        const env = (await loadFixture()) as DStakeFixtureResult;
        const named = await getNamedAccounts();

        deployer = await ethers.getSigner(named.deployer);
        user = await ethers.getSigner(named.user1 ?? named.deployer);
        holder = await ethers.getSigner(named.user2 ?? named.deployer);
        keeper = await ethers.getSigner(named.user3 ?? named.user2 ?? named.deployer);

        router = env.router as DStakeRouterV2;
        dStakeToken = env.DStakeToken as DStakeTokenV2;

        const dStableAddress = await env.dStableToken.getAddress();
        dStableToken = (await ethers.getContractAt("ERC20StablecoinUpgradeable", dStableAddress)) as ERC20StablecoinUpgradeable;

        decimals = env.dStableInfo.decimals;
        routerAddress = await router.getAddress();
        dStakeTokenAddress = await dStakeToken.getAddress();

        const minterRole = await dStableToken.MINTER_ROLE();
        if (!(await dStableToken.hasRole(minterRole, deployer.address))) {
          await dStableToken.grantRole(minterRole, deployer.address);
        }

        const defaultAdminRole = await router.DEFAULT_ADMIN_ROLE();
        for (const candidate of [deployer, user, holder, keeper]) {
          if (await router.hasRole(defaultAdminRole, candidate.address)) {
            admin = candidate;
            break;
          }
        }
        if (!admin) {
          throw new Error("No router admin signer available in test accounts");
        }
      });

      it("tracks settlement shortfalls inside previews and withdrawal limits", async function () {
        const depositAmount = await fractionOf(user, 4n);
        await depositFor(user, depositAmount);

        const userShares = await dStakeToken.balanceOf(user.address);
        const totalAssetsBefore = await dStakeToken.totalAssets();
        const maxWithdrawBefore = await dStakeToken.maxWithdraw(user.address);
        const previewBefore = await dStakeToken.previewRedeem(userShares);

        const quarter = depositAmount / 4n;
        const shortfall = quarter === 0n ? 1n : quarter;
        await router.connect(admin).recordShortfall(shortfall);
        expect(await router.currentShortfall()).to.equal(shortfall);

        const totalAssetsAfter = await dStakeToken.totalAssets();
        expect(totalAssetsAfter).to.equal(totalAssetsBefore - shortfall);

        const previewAfter = await dStakeToken.previewRedeem(userShares);
        expect(previewAfter).to.be.lt(previewBefore);
        const previewDrop = previewBefore - previewAfter;
        const previewDelta = previewDrop > shortfall ? previewDrop - shortfall : shortfall - previewDrop;
        const previewTolerance = shortfall / 100_000n + 10n;
        expect(previewDelta).to.be.lte(previewTolerance);

        const maxWithdrawAfter = await dStakeToken.maxWithdraw(user.address);
        expect(maxWithdrawAfter).to.be.lt(maxWithdrawBefore);
        const netDrop = maxWithdrawBefore - maxWithdrawAfter;
        const deltaDifference = netDrop > shortfall ? netDrop - shortfall : shortfall - netDrop;
        const roundingTolerance = shortfall / 100_000n + 10n;
        expect(deltaDifference).to.be.lte(roundingTolerance);

        await expect(dStakeToken.connect(user).withdraw(maxWithdrawBefore, user.address, user.address)).to.be.revertedWithCustomError(
          dStakeToken,
          "ERC4626ExceedsMaxWithdraw",
        );

        await router.connect(admin).clearShortfall(shortfall);
        expect(await router.currentShortfall()).to.equal(0);
        expect(await dStakeToken.maxWithdraw(user.address)).to.equal(maxWithdrawBefore);
        expect(await dStakeToken.previewRedeem(userShares)).to.equal(previewBefore);
      });

      it("accrues withdrawal fees at the router while preserving remaining share price", async function () {
        const userDeposit = await fractionOf(user, 4n);
        await depositFor(user, userDeposit);

        const holderDeposit = await fractionOf(holder, 4n);
        await depositFor(holder, holderDeposit);

        const feeBps = 5_000n; // 0.5%
        await router.connect(deployer).setWithdrawalFee(feeBps);

        const holderShares = await dStakeToken.balanceOf(holder.address);
        const previewBefore = await dStakeToken.previewRedeem(holderShares);
        const totalAssetsBefore = await dStakeToken.totalAssets();

        const half = userDeposit / 2n;
        const withdrawAmount = half === 0n ? userDeposit : half;
        const routerBalanceBefore = await routerIdleBalance();

        const tx = await dStakeToken.connect(user).withdraw(withdrawAmount, user.address, user.address);
        const receipt = await tx.wait();

        const routerBalanceAfter = await routerIdleBalance();
        const feeAccumulated = routerBalanceAfter - routerBalanceBefore;
        const withdrawEvent = parseRouterEvent(receipt, "RouterWithdrawSettled");

        expect(withdrawEvent?.args?.netAssets).to.equal(withdrawAmount);
        expect(withdrawEvent?.args?.fee).to.equal(feeAccumulated);

        const totalAssetsAfter = await dStakeToken.totalAssets();
        expect(totalAssetsBefore - totalAssetsAfter).to.equal(withdrawAmount);

        const previewAfter = await dStakeToken.previewRedeem(holderShares);
        expect(previewAfter).to.be.gte(previewBefore);
      });

      it("reinvests idle fees with incentives and sweeps surplus balances", async function () {
        await depositFor(user, await fractionOf(user, 3n));
        await depositFor(holder, await fractionOf(holder, 4n));

        const holderShares = await dStakeToken.balanceOf(holder.address);
        const previewBefore = await dStakeToken.previewRedeem(holderShares);

        const idleAmount = toUnits("120");
        await mintDStable(deployer.address, idleAmount);
        await dStableToken.connect(deployer).transfer(routerAddress, idleAmount);

        const incentiveBps = 50_000n; // 5%
        await router.connect(deployer).setReinvestIncentive(incentiveBps);

        const keeperBalanceBefore = await dStableToken.balanceOf(keeper.address);
        const expectedIncentive = (idleAmount * incentiveBps) / BPS_SCALE;

        const reinvestTx = await dStakeToken.connect(keeper).reinvestFees();
        await reinvestTx.wait();

        const keeperBalanceAfter = await dStableToken.balanceOf(keeper.address);
        expect(keeperBalanceAfter - keeperBalanceBefore).to.equal(expectedIncentive);
        expect(await routerIdleBalance()).to.equal(0n);

        const previewAfterReinvest = await dStakeToken.previewRedeem(holderShares);
        expect(previewAfterReinvest).to.be.gt(previewBefore);

        const surplusAmount = toUnits("60");
        await mintDStable(deployer.address, surplusAmount);
        await dStableToken.connect(deployer).transfer(routerAddress, surplusAmount);

        const partialSweep = surplusAmount / 2n;
        const limitedSweep = await router.connect(admin).sweepSurplus(partialSweep);
        const limitedEvent = parseRouterEvent(await limitedSweep.wait(), "SurplusSwept");
        expect(limitedEvent?.args?.amount).to.equal(partialSweep);

        const balanceAfterPartialSweep = await routerIdleBalance();
        expect(balanceAfterPartialSweep).to.equal(surplusAmount - partialSweep);

        const overSweepAmount = balanceAfterPartialSweep * 2n;
        const fullSweep = await router.connect(admin).sweepSurplus(overSweepAmount);
        const fullEvent = parseRouterEvent(await fullSweep.wait(), "SurplusSwept");
        expect(fullEvent?.args?.amount).to.equal(balanceAfterPartialSweep);

        const dustTolerance = await router.dustTolerance();
        expect(await routerIdleBalance()).to.be.lte(dustTolerance);
      });

      it("no-ops reinvestment when the deposit cap is saturated and no idle fees exist", async function () {
        await depositFor(user, await fractionOf(user, 4n));

        const managed = await router.totalManagedAssets();
        const baselineAssets = await dStakeToken.totalAssets();
        await router.connect(deployer).setDepositCap(managed);
        expect(await dStakeToken.maxDeposit(user.address)).to.equal(0n);
        expect(await routerIdleBalance()).to.equal(0n);

        const previewResult = await router.reinvestFees.staticCall();
        expect(previewResult[0]).to.equal(0n);
        expect(previewResult[1]).to.equal(0n);

        await router.connect(deployer).reinvestFees();
        expect(await routerIdleBalance()).to.equal(0n);
        expect(await dStakeToken.totalAssets()).to.equal(baselineAssets);
      });
    });
  });
});
