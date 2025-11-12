import { SignerWithAddress } from "@nomicfoundation/hardhat-ethers/signers";
import { expect } from "chai";
import { ZeroAddress } from "ethers";
import { ethers, getNamedAccounts } from "hardhat";

import type { IERC4626 } from "../../typechain-types";
import { ERC20, IERC20 } from "../../typechain-types";
import { ERC20StablecoinUpgradeable } from "../../typechain-types/contracts/dstable/ERC20StablecoinUpgradeable";
import { WrappedDLendConversionAdapter } from "../../typechain-types/contracts/vaults/dstake/adapters/WrappedDLendConversionAdapter";
import type { DStakeCollateralVault } from "../../typechain-types/contracts/vaults/dstake/DStakeCollateralVault";
import { createDStakeFixture, DSTAKE_CONFIGS, DStakeFixtureConfig } from "./fixture";

const parseUnits = (value: string | number, decimals: number | bigint) => ethers.parseUnits(value.toString(), decimals);

DSTAKE_CONFIGS.forEach((config: DStakeFixtureConfig) => {
  describe(`WrappedDLendConversionAdapter for ${config.DStakeTokenSymbol}`, function () {
    // Create fixture function once per suite for snapshot caching
    const fixture = createDStakeFixture(config);

    let deployer: SignerWithAddress;
    let user1: SignerWithAddress;
    let user2: SignerWithAddress;
    let adapter: WrappedDLendConversionAdapter;
    let adapterAddress: string;
    let dStableToken: ERC20;
    let dStableDecimals: number;
    let stable: ERC20StablecoinUpgradeable;
    let wrapperToken: IERC20;
    let wrapper: IERC4626;
    let vaultAssetAddress: string;
    let collateralVault: DStakeCollateralVault;
    let collateralVaultAddress: string;
    let vaultAssetDecimals: bigint;

    beforeEach(async function () {
      // Revert to snapshot instead of full deployment
      const out = await fixture();
      // Set up signers
      deployer = out.deployer;
      const named = await getNamedAccounts();
      user1 = await ethers.getSigner(named.user1);
      user2 = await ethers.getSigner(named.user2);

      // Extract deployed contracts and info
      dStableToken = out.dStableToken as unknown as ERC20;
      dStableDecimals = out.dStableInfo.decimals;
      vaultAssetAddress = out.vaultAssetAddress;
      wrapperToken = out.vaultAssetToken;
      adapterAddress = out.adapterAddress;
      // get the full adapter contract for WrappedDLendConversionAdapter
      adapter = (await ethers.getContractAt("WrappedDLendConversionAdapter", adapterAddress, deployer)) as WrappedDLendConversionAdapter;
      collateralVault = out.collateralVault as unknown as DStakeCollateralVault;
      collateralVaultAddress = await collateralVault.getAddress();

      // Get wrapper as IERC4626 for previews
      wrapper = (await ethers.getContractAt(
        "@openzeppelin/contracts/interfaces/IERC4626.sol:IERC4626",
        vaultAssetAddress,
        deployer,
      )) as unknown as IERC4626;

      // Determine wrapper token decimals
      const tempWrapper = (await ethers.getContractAt(
        "@openzeppelin/contracts/token/ERC20/ERC20.sol:ERC20",
        vaultAssetAddress,
      )) as unknown as ERC20;
      vaultAssetDecimals = await tempWrapper.decimals();

      // Grant MINTER_ROLE to deployer so we can mint dStable
      const dStableAddress = await dStableToken.getAddress();
      stable = (await ethers.getContractAt("ERC20StablecoinUpgradeable", dStableAddress, deployer)) as ERC20StablecoinUpgradeable;
      const minterRole = await stable.MINTER_ROLE();
      await stable.grantRole(minterRole, deployer.address);

      // Sanity checks
      expect(adapterAddress).to.not.equal(ZeroAddress);
      // Ensure deployer is registered as router on collateralVault
      await collateralVault.setRouter(deployer.address);
      // Allow named router signer (user1) to exercise adapter flows in tests
      await adapter.connect(deployer).setAuthorizedCaller(user1.address, true);
    });

    describe("Initialization & Deployment State", function () {
      it("should deploy with correct initial state", async function () {
        // dStable address
        const dStableAddr = await adapter.dStable();
        expect(dStableAddr).to.equal(await dStableToken.getAddress());
        // wrappedDLendToken address
        expect(await adapter.wrappedDLendToken()).to.equal(vaultAssetAddress);
        // collateralVault address
        expect(await adapter.collateralVault()).to.equal(collateralVaultAddress);
        // wrapper underlying asset matches dStable
        expect(await wrapper.asset()).to.equal(await dStableToken.getAddress());
      });
    });

    describe("depositIntoStrategy", function () {
      it("should revert if dStableAmount is 0", async function () {
        await expect(adapter.connect(user1).depositIntoStrategy(0)).to.be.revertedWithCustomError(adapter, "InvalidAmount");
      });

      it("should revert if user has insufficient dStable balance", async function () {
        const amt = parseUnits(1, dStableDecimals);
        // Approve adapter so transferFrom checks balance not allowance
        await dStableToken.connect(user1).approve(adapterAddress, amt);
        await expect(adapter.connect(user1).depositIntoStrategy(amt)).to.be.reverted;
      });

      it("should revert if adapter is not approved to spend dStable", async function () {
        const amt = parseUnits(100, dStableDecimals);
        await stable.mint(user1.address, amt);
        await expect(adapter.connect(user1).depositIntoStrategy(amt)).to.be.reverted;
      });

      it("should successfully convert dStable to wrappedDLendToken", async function () {
        const amt = parseUnits(100, dStableDecimals);
        // Mint and approve
        await stable.mint(user1.address, amt);
        await dStableToken.connect(user1).approve(adapterAddress, amt);

        // Preview expected vault amount
        const [previewAsset, expectedVaultAmt] = await adapter.previewDepositIntoStrategy(amt);
        expect(previewAsset).to.equal(vaultAssetAddress);

        // Balances before
        const initialUserDStable = await dStableToken.balanceOf(user1.address);
        const initialAdapterDStable = await dStableToken.balanceOf(adapterAddress);
        const initialVaultWrapped = await wrapperToken.balanceOf(collateralVaultAddress);

        // Execute conversion
        await adapter.connect(user1).depositIntoStrategy(amt);

        // Balances after
        const finalUserDStable = await dStableToken.balanceOf(user1.address);
        const finalAdapterDStable = await dStableToken.balanceOf(adapterAddress);
        const finalVaultWrapped = await wrapperToken.balanceOf(collateralVaultAddress);

        expect(finalUserDStable).to.equal(initialUserDStable - amt);
        expect(finalAdapterDStable).to.equal(0);
        expect(finalVaultWrapped).to.equal(initialVaultWrapped + expectedVaultAmt);
      });
    });

    describe("withdrawFromStrategy", function () {
      it("should revert if vaultAssetAmount is 0", async function () {
        await expect(adapter.connect(user1).withdrawFromStrategy(0)).to.be.revertedWithCustomError(adapter, "InvalidAmount");
      });

      it("should revert if user has insufficient wrappedDLendToken balance", async function () {
        const amt = parseUnits(1, vaultAssetDecimals);
        // Approve adapter so safeTransferFrom checks balance
        await wrapperToken.connect(user1).approve(adapterAddress, amt);
        await expect(adapter.connect(user1).withdrawFromStrategy(amt)).to.be.reverted;
      });

      it("should revert if adapter is not approved to spend wrappedDLendToken", async function () {
        // First mint and convert dStable to get wrapped tokens
        const depositAmt = parseUnits(100, dStableDecimals);
        await stable.mint(user1.address, depositAmt);
        await dStableToken.connect(user1).approve(adapterAddress, depositAmt);
        // Get expected vault amount and convert
        const [, vaultAmt] = await adapter.previewDepositIntoStrategy(depositAmt);
        await adapter.connect(user1).depositIntoStrategy(depositAmt);
        // Send vault tokens to user1 via collateralVault
        await collateralVault.connect(deployer).sendAsset(vaultAssetAddress, vaultAmt, user1.address);
        // Do not approve adapter for wrapped tokens
        await expect(adapter.connect(user1).withdrawFromStrategy(vaultAmt)).to.be.reverted;
      });

      it("should successfully convert wrappedDLendToken to dStable", async function () {
        // Prepare: user1 obtains wrapped tokens
        const depositAmt = parseUnits(100, dStableDecimals);
        await stable.mint(user1.address, depositAmt);
        await dStableToken.connect(user1).approve(adapterAddress, depositAmt);
        // use preview to get expected vault amount
        const [, vaultAmt] = await adapter.previewDepositIntoStrategy(depositAmt);
        await adapter.connect(user1).depositIntoStrategy(depositAmt);
        await collateralVault.connect(deployer).sendAsset(vaultAssetAddress, vaultAmt, user1.address);

        // Balances before
        const initialUserWrapped = await wrapperToken.balanceOf(user1.address);
        const initialUserDStable = await dStableToken.balanceOf(user1.address);

        // Approve and preview
        await wrapperToken.connect(user1).approve(adapterAddress, vaultAmt);
        const expectedDStableAmt = await adapter.previewWithdrawFromStrategy(vaultAmt);

        // Execute conversion
        await adapter.connect(user1).withdrawFromStrategy(vaultAmt);

        // Balances after
        const finalUserWrapped = await wrapperToken.balanceOf(user1.address);
        const finalUserDStable = await dStableToken.balanceOf(user1.address);

        expect(finalUserWrapped).to.equal(initialUserWrapped - vaultAmt);
        expect(finalUserDStable).to.equal(initialUserDStable + expectedDStableAmt);
      });
    });

    describe("View Functions", function () {
      it("strategyShareValueInDStable returns correct values", async function () {
        const depositAmt = parseUnits(10, dStableDecimals);
        const [_, vaultAmt] = await adapter.previewDepositIntoStrategy(depositAmt);
        // preview assetValue
        const value = await adapter.strategyShareValueInDStable(vaultAssetAddress, vaultAmt);
        const expected = await wrapper.previewRedeem(vaultAmt);
        expect(value).to.equal(expected);
      });

      it("strategyShare returns correct asset address", async function () {
        expect(await adapter.strategyShare()).to.equal(vaultAssetAddress);
      });

      it("previewDepositIntoStrategy behaves correctly", async function () {
        const depositAmt = parseUnits(50, dStableDecimals);
        const [asset, amt] = await adapter.previewDepositIntoStrategy(depositAmt);
        expect(asset).to.equal(vaultAssetAddress);
        const expected = await wrapper.previewDeposit(depositAmt);
        expect(amt).to.equal(expected);
      });

      it("previewWithdrawFromStrategy behaves correctly", async function () {
        const previewAmt = parseUnits(20, vaultAssetDecimals);
        const expected = await wrapper.previewRedeem(previewAmt);
        expect(await adapter.previewWithdrawFromStrategy(previewAmt)).to.equal(expected);
      });
    });

    describe("caller authorization", function () {
      it("reverts when caller lacks authorization", async function () {
        const amt = parseUnits(1, dStableDecimals);
        await dStableToken.connect(user2).approve(adapterAddress, amt);
        await expect(adapter.connect(user2).depositIntoStrategy(amt)).to.be.revertedWithCustomError(
          adapter,
          "AccessControlUnauthorizedAccount",
        );
      });

      it("allows admin to authorize a new caller", async function () {
        const amt = parseUnits(1, dStableDecimals);
        await stable.mint(user2.address, amt);
        await dStableToken.connect(user2).approve(adapterAddress, amt);
        await adapter.connect(deployer).setAuthorizedCaller(user2.address, true);
        await expect(adapter.connect(user2).depositIntoStrategy(amt)).to.emit(adapter, "ConversionToVault");
      });
    });
  });
});
