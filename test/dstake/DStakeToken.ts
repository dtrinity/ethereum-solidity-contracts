import { expect } from "chai";
import { ethers, getNamedAccounts } from "hardhat";

import { DStakeTokenV2 } from "../../typechain-types/contracts/vaults/dstake/DStakeTokenV2";
import { DStakeRouterV2 } from "../../typechain-types/contracts/vaults/dstake/DStakeRouterV2.sol";
import { DStakeCollateralVaultV2 } from "../../typechain-types/contracts/vaults/dstake/DStakeCollateralVaultV2.sol";
import { IDStableConversionAdapterV2 } from "../../typechain-types/contracts/vaults/dstake/interfaces/IDStableConversionAdapterV2";
import { ERC20 } from "../../typechain-types";
import { ERC20StablecoinUpgradeable } from "../../typechain-types/contracts/dstable/ERC20StablecoinUpgradeable";
import { createDStakeFixture, DSTAKE_CONFIGS, DStakeFixtureConfig } from "./fixture";

const toUnits = (value: string, decimals: number) => ethers.parseUnits(value, decimals);

describe("dSTAKE v2 core flows", function () {
  DSTAKE_CONFIGS.forEach((config: DStakeFixtureConfig) => {
    describe(config.DStakeTokenSymbol, function () {
      const loadFixture = createDStakeFixture(config);

      let deployerAddr: string;
      let adminAddr: string;
      let userAddr: string;
      let otherAddr: string;

      let dStakeToken: DStakeTokenV2;
      let router: DStakeRouterV2;
      let collateralVault: DStakeCollateralVaultV2;
      let dStableToken: ERC20StablecoinUpgradeable;
      let vaultAssetToken: ERC20;
      let adapter: IDStableConversionAdapterV2;
      let vaultAssetAddress: string;
      let dStableDecimals: number;

      beforeEach(async function () {
        const named = await getNamedAccounts();
        deployerAddr = named.deployer;
        adminAddr = named.user1 || named.deployer;
        userAddr = named.user2 || named.deployer;
        otherAddr = named.user3 || named.deployer;

        const env = await loadFixture();

        dStakeToken = env.DStakeToken as unknown as DStakeTokenV2;
        router = env.router as unknown as DStakeRouterV2;
        collateralVault = env.collateralVault as unknown as DStakeCollateralVaultV2;
        adapter = env.adapter as unknown as IDStableConversionAdapterV2;
        vaultAssetToken = env.vaultAssetToken as unknown as ERC20;
        vaultAssetAddress = env.vaultAssetAddress;

        const dStableAddress = await env.dStableToken.getAddress();
        dStableToken = (await ethers.getContractAt("ERC20StablecoinUpgradeable", dStableAddress)) as ERC20StablecoinUpgradeable;

        dStableDecimals = await dStableToken.decimals();

        const minterRole = await dStableToken.MINTER_ROLE();
        if (!(await dStableToken.hasRole(minterRole, deployerAddr))) {
          await dStableToken.grantRole(minterRole, deployerAddr);
        }

        // Ensure default deposit strategy is set to the vault asset (dLend wrapper) for these tests
        // as they rely on specific adapter behavior and balance checks.
        // This is necessary because the default configuration might use the Idle Vault.
        const adminSigner = await ethers.getSigner(adminAddr);
        const currentDefault = await router.defaultDepositStrategyShare();
        if (currentDefault !== vaultAssetAddress) {
          await router.connect(adminSigner).setDefaultDepositStrategyShare(vaultAssetAddress);
        }
      });

      const mintDStable = async (recipient: string, amount: bigint) => {
        await dStableToken.mint(recipient, amount);
      };

      const resolveTokenAdmin = async (): Promise<string> => {
        const candidates = [adminAddr, deployerAddr, userAddr, otherAddr];
        const defaultAdminRole = await dStakeToken.DEFAULT_ADMIN_ROLE();
        for (const candidate of candidates) {
          if (await dStakeToken.hasRole(defaultAdminRole, candidate)) {
            return candidate;
          }
        }
        throw new Error("No token admin signer available");
      };

      const deployRouterPair = async (admin: string) => {
        const adminSigner = await ethers.getSigner(admin);
        const dStakeTokenAddress = await dStakeToken.getAddress();
        const assetAddress = await dStakeToken.asset();

        const collateralFactory = await ethers.getContractFactory("DStakeCollateralVaultV2", adminSigner);
        const collateralCandidate = (await collateralFactory.deploy(dStakeTokenAddress, assetAddress)) as DStakeCollateralVaultV2;
        await collateralCandidate.waitForDeployment();

        const routerFactory = await ethers.getContractFactory("DStakeRouterV2", adminSigner);
        const routerCandidate = (await routerFactory.deploy(dStakeTokenAddress, await collateralCandidate.getAddress())) as DStakeRouterV2;
        await routerCandidate.waitForDeployment();

        await collateralCandidate.connect(adminSigner).setRouter(await routerCandidate.getAddress());

        return { routerCandidate, collateralCandidate };
      };

      it("registers adapter for the default strategy share", async function () {
        const adapterAddress = await router.strategyShareToAdapter(vaultAssetAddress);
        expect(adapterAddress).to.not.equal(ethers.ZeroAddress);
        expect(adapterAddress).to.equal(await adapter.getAddress());
      });

      it("auto-deposits via DStakeToken deposit", async function () {
        const userSigner = await ethers.getSigner(userAddr);
        const assets = toUnits("250", dStableDecimals);

        await mintDStable(userAddr, assets);
        await dStableToken.connect(userSigner).approve(await dStakeToken.getAddress(), assets);

        const expectedShares = await dStakeToken.previewDeposit(assets);
        const [, expectedVaultShares] = await adapter.previewDepositIntoStrategy(assets);

        const beforeVaultBal = await vaultAssetToken.balanceOf(await collateralVault.getAddress());

        await expect(dStakeToken.connect(userSigner).deposit(assets, userAddr))
          .to.emit(router, "RouterDepositRouted")
          .withArgs(userAddr, userAddr, await router.defaultDepositStrategyShare(), assets, expectedShares);

        const afterVaultBal = await vaultAssetToken.balanceOf(await collateralVault.getAddress());
        const mintedVaultShares = afterVaultBal - beforeVaultBal;

        expect(await dStakeToken.balanceOf(userAddr)).to.equal(expectedShares);
        expect(mintedVaultShares).to.equal(expectedVaultShares);
      });

      it("withdraw returns net assets when fee is zero", async function () {
        const userSigner = await ethers.getSigner(userAddr);
        const adminSigner = await ethers.getSigner(adminAddr);
        const assets = toUnits("120", dStableDecimals);

        await router.connect(adminSigner).setWithdrawalFee(0);

        await mintDStable(userAddr, assets);
        await dStableToken.connect(userSigner).approve(await dStakeToken.getAddress(), assets);
        await dStakeToken.connect(userSigner).deposit(assets, userAddr);

        const shares = await dStakeToken.balanceOf(userAddr);
        const expectedAssets = await dStakeToken.previewRedeem(shares);

        await expect(dStakeToken.connect(userSigner).withdraw(expectedAssets, userAddr, userAddr)).to.emit(router, "RouterWithdrawSettled");

        const remainingShares = await dStakeToken.balanceOf(userAddr);
        expect([0n, 1n]).to.include(remainingShares);
        expect(await dStableToken.balanceOf(userAddr)).to.equal(expectedAssets);
      });

      it("collects withdrawal fee and sends remainder to receiver", async function () {
        const userSigner = await ethers.getSigner(userAddr);
        const adminSigner = await ethers.getSigner(adminAddr);
        const assets = toUnits("100", dStableDecimals);

        await router.connect(adminSigner).setWithdrawalFee(500); // 0.5%

        await mintDStable(userAddr, assets);
        await dStableToken.connect(userSigner).approve(await dStakeToken.getAddress(), assets);
        await dStakeToken.connect(userSigner).deposit(assets, userAddr);

        const shares = await dStakeToken.balanceOf(userAddr);
        const treasuryBefore = await dStableToken.balanceOf(await router.getAddress());
        const userBalanceBefore = await dStableToken.balanceOf(userAddr);

        const tx = await dStakeToken.connect(userSigner).withdraw(await dStakeToken.previewRedeem(shares), userAddr, userAddr);
        const receipt = await tx.wait();
        const parsed = receipt?.logs
          .map((log) => {
            try {
              return router.interface.parseLog(log);
            } catch {
              return null;
            }
          })
          .find((event) => event?.name === "RouterWithdrawSettled");

        expect(parsed, "RouterWithdrawSettled event").to.not.be.undefined;

        const feeFromEvent = parsed!.args.fee as bigint;
        const netAssetsFromEvent = parsed!.args.netAssets as bigint;
        const grossAssetsFromEvent = parsed!.args.grossAssets as bigint;

        const treasuryAfter = await dStableToken.balanceOf(await router.getAddress());
        const userBalanceAfter = await dStableToken.balanceOf(userAddr);

        const remainingShares = await dStakeToken.balanceOf(userAddr);
        expect([0n, 1n]).to.include(remainingShares);

        const netAssetDelta = userBalanceAfter - userBalanceBefore - netAssetsFromEvent;
        expect([-1n, 0n, 1n]).to.include(netAssetDelta);

        const feeDelta = treasuryAfter - treasuryBefore - feeFromEvent;
        expect([-1n, 0n, 1n]).to.include(feeDelta);
        expect(netAssetsFromEvent + feeFromEvent).to.equal(grossAssetsFromEvent);
        expect(feeFromEvent).to.be.gt(0n);
      });

      it("enforces deposit caps", async function () {
        const adminSigner = await ethers.getSigner(adminAddr);
        const userSigner = await ethers.getSigner(userAddr);
        const assets = toUnits("50", dStableDecimals);

        await mintDStable(userAddr, assets * 3n);
        await dStableToken.connect(userSigner).approve(await dStakeToken.getAddress(), assets * 3n);

        await router.connect(adminSigner).setDepositCap(assets);

        await dStakeToken.connect(userSigner).deposit(assets, userAddr);
        await expect(dStakeToken.connect(userSigner).deposit(assets, userAddr)).to.be.revertedWithCustomError(
          dStakeToken,
          "ERC4626ExceededMaxDeposit",
        );
        expect(await dStakeToken.maxDeposit(userAddr)).to.equal(0);
      });

      it("restricts config changes to config managers", async function () {
        const adminSigner = await ethers.getSigner(adminAddr);
        const otherSigner = await ethers.getSigner(otherAddr);

        await expect(router.connect(otherSigner).setDepositCap(toUnits("1", dStableDecimals))).to.be.revertedWithCustomError(
          router,
          "UnauthorizedConfigCaller",
        );

        await router.connect(adminSigner).setDepositCap(toUnits("5000", dStableDecimals));

        await expect(router.connect(otherSigner).setWithdrawalFee(1)).to.be.revertedWithCustomError(router, "UnauthorizedConfigCaller");

        await router.connect(adminSigner).setWithdrawalFee(0);
      });

      it("blocks router migration while settlement shortfall remains", async function () {
        const routerAdminSigner = await ethers.getSigner(adminAddr);
        const tokenAdmin = await resolveTokenAdmin();
        const tokenAdminSigner = await ethers.getSigner(tokenAdmin);
        const userSigner = await ethers.getSigner(userAddr);
        const depositAmount = toUnits("250", dStableDecimals);

        await mintDStable(userAddr, depositAmount);
        await dStableToken.connect(userSigner).approve(await dStakeToken.getAddress(), depositAmount);
        await dStakeToken.connect(userSigner).deposit(depositAmount, userAddr);

        const shortfall = depositAmount / 4n === 0n ? 1n : depositAmount / 4n;
        await router.connect(routerAdminSigner).recordShortfall(shortfall);

        const { routerCandidate, collateralCandidate } = await deployRouterPair(tokenAdmin);

        await expect(
          dStakeToken.connect(tokenAdminSigner).migrateCore(await routerCandidate.getAddress(), await collateralCandidate.getAddress()),
        )
          .to.be.revertedWithCustomError(dStakeToken, "RouterShortfallOutstanding")
          .withArgs(shortfall);

        await router.connect(routerAdminSigner).clearShortfall(shortfall);

        await expect(
          dStakeToken.connect(tokenAdminSigner).migrateCore(await routerCandidate.getAddress(), await collateralCandidate.getAddress()),
        )
          .to.emit(dStakeToken, "RouterSet")
          .withArgs(await routerCandidate.getAddress());

        expect(await dStakeToken.router()).to.equal(await routerCandidate.getAddress());
        expect(await dStakeToken.collateralVault()).to.equal(await collateralCandidate.getAddress());
      });
    });
  });
});
