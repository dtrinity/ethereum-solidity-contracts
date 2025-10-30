import { expect } from "chai";
import { Signer } from "ethers";
import hre, { getNamedAccounts } from "hardhat";

import { CollateralHolderVault, IssuerV2, OracleAggregatorV1_1, RedeemerV2, TestERC20, TestMintableERC20 } from "../../typechain-types";
import { getConfig } from "../../config/config";
import { TokenInfo, getTokenContractForSymbol } from "../../typescript/token/utils";
import { createDStableFixture, DUSD_CONFIG } from "./fixtures";

describe("dUSD Collateral delist lifecycle", function () {
  const collateralSymbol = "USDC";
  const fixture = createDStableFixture(DUSD_CONFIG);

  let issuer: IssuerV2;
  let redeemer: RedeemerV2;
  let collateralVault: CollateralHolderVault;
  let oracleAggregator: OracleAggregatorV1_1;
  let dstable: TestMintableERC20;
  let collateral: TestERC20;
  let collateralInfo: TokenInfo;

  let deployer: string;
  let user1: string;
  let user2: string;
  let governanceAddress: string;
  let deployerSigner: Signer;
  let user1Signer: Signer;
  let user2Signer: Signer;
  let governanceSigner: Signer;
  let issuerPauserSigner: Signer;
  let redeemerPauserSigner: Signer;
  let collateralManagerSigner: Signer;
  let oracleManagerSigner: Signer;

  beforeEach(async function () {
    await fixture();

    ({ deployer, user1, user2 } = await getNamedAccounts());

    const networkConfig = await getConfig(hre);
    governanceAddress = networkConfig.walletAddresses.governanceMultisig;

    deployerSigner = await hre.ethers.getSigner(deployer);
    user1Signer = await hre.ethers.getSigner(user1);
    user2Signer = await hre.ethers.getSigner(user2);
    governanceSigner = await hre.ethers.getSigner(governanceAddress);

    const issuerAddress = (await hre.deployments.get(DUSD_CONFIG.issuerContractId)).address;
    issuer = await hre.ethers.getContractAt("IssuerV2", issuerAddress, deployerSigner);

    const redeemerAddress = (await hre.deployments.get(DUSD_CONFIG.redeemerContractId)).address;
    redeemer = await hre.ethers.getContractAt("RedeemerV2", redeemerAddress, deployerSigner);

    const collateralVaultAddress = (await hre.deployments.get(DUSD_CONFIG.collateralVaultContractId)).address;
    collateralVault = await hre.ethers.getContractAt("CollateralHolderVault", collateralVaultAddress, deployerSigner);

    const oracleAddress = (await hre.deployments.get(DUSD_CONFIG.oracleAggregatorId)).address;
    oracleAggregator = await hre.ethers.getContractAt("OracleAggregatorV1_1", oracleAddress, deployerSigner);

    const dstableResult = await getTokenContractForSymbol(hre, deployer, DUSD_CONFIG.symbol);
    dstable = dstableResult.contract as TestMintableERC20;

    const collateralResult = await getTokenContractForSymbol(hre, deployer, collateralSymbol);
    collateral = collateralResult.contract as TestERC20;
    collateralInfo = collateralResult.tokenInfo;

    const issuerPauserRole = await issuer.PAUSER_ROLE();
    issuerPauserSigner = (await issuer.hasRole(issuerPauserRole, governanceAddress)) ? governanceSigner : deployerSigner;

    const redeemerPauserRole = await redeemer.PAUSER_ROLE();
    redeemerPauserSigner = (await redeemer.hasRole(redeemerPauserRole, governanceAddress)) ? governanceSigner : deployerSigner;

    const collateralManagerRole = await collateralVault.COLLATERAL_MANAGER_ROLE();
    collateralManagerSigner = (await collateralVault.hasRole(collateralManagerRole, governanceAddress)) ? governanceSigner : deployerSigner;

    const oracleManagerRole = await oracleAggregator.ORACLE_MANAGER_ROLE();
    oracleManagerSigner = (await oracleAggregator.hasRole(oracleManagerRole, governanceAddress)) ? governanceSigner : deployerSigner;
  });

  it("handles oracle loss, governance delisting, and re-onboarding", async function () {
    const supportedCollaterals = await collateralVault.listCollateral();
    expect(supportedCollaterals.length).to.be.greaterThan(1);
    expect(await collateralVault.isCollateralSupported(collateralInfo.address)).to.equal(true);

    const seedAmount = hre.ethers.parseUnits("10000", collateralInfo.decimals);
    await collateral.connect(deployerSigner).transfer(user1, seedAmount);
    await collateral.connect(deployerSigner).transfer(user2, seedAmount);

    const navBeforeIssuance = await collateralVault.totalValue();

    const depositAmount = hre.ethers.parseUnits("1000", collateralInfo.decimals);
    await collateral.connect(user1Signer).approve(await issuer.getAddress(), depositAmount);
    const user1DstableBefore = await dstable.balanceOf(user1);
    const depositValue = await collateralVault.assetValueFromAmount(depositAmount, collateralInfo.address);

    await issuer.connect(user1Signer).issue(depositAmount, collateralInfo.address, 0);

    const navAfterIssuance = await collateralVault.totalValue();
    expect(navAfterIssuance - navBeforeIssuance).to.equal(depositValue);

    const mintedDstable = (await dstable.balanceOf(user1)) - user1DstableBefore;
    expect(mintedDstable).to.be.gt(0n);
    const redeemPortion = mintedDstable / 2n;
    expect(redeemPortion).to.be.gt(0n);

    const preservedOracleAddress = await oracleAggregator.assetOracles(collateralInfo.address);
    expect(preservedOracleAddress).to.not.equal(hre.ethers.ZeroAddress);

    await expect(oracleAggregator.connect(oracleManagerSigner).removeOracle(collateralInfo.address))
      .to.emit(oracleAggregator, "OracleUpdated")
      .withArgs(collateralInfo.address, hre.ethers.ZeroAddress);

    await expect(collateralVault.totalValue())
      .to.be.revertedWithCustomError(oracleAggregator, "OracleNotSet")
      .withArgs(collateralInfo.address);

    const user2AttemptAmount = hre.ethers.parseUnits("100", collateralInfo.decimals);
    await collateral.connect(user2Signer).approve(await issuer.getAddress(), user2AttemptAmount);
    await expect(issuer.connect(user2Signer).issue(user2AttemptAmount, collateralInfo.address, 0))
      .to.be.revertedWithCustomError(oracleAggregator, "OracleNotSet")
      .withArgs(collateralInfo.address);

    await dstable.connect(user1Signer).approve(await redeemer.getAddress(), redeemPortion);
    await expect(redeemer.connect(user1Signer).redeem(redeemPortion, collateralInfo.address, 0))
      .to.be.revertedWithCustomError(oracleAggregator, "OracleNotSet")
      .withArgs(collateralInfo.address);

    await expect(issuer.connect(issuerPauserSigner).setAssetMintingPause(collateralInfo.address, true))
      .to.emit(issuer, "AssetMintingPauseUpdated")
      .withArgs(collateralInfo.address, true);
    await expect(redeemer.connect(redeemerPauserSigner).setAssetRedemptionPause(collateralInfo.address, true))
      .to.emit(redeemer, "AssetRedemptionPauseUpdated")
      .withArgs(collateralInfo.address, true);
    expect(await issuer.isAssetMintingEnabled(collateralInfo.address)).to.equal(false);
    expect(await redeemer.isAssetRedemptionEnabled(collateralInfo.address)).to.equal(false);

    await expect(collateralVault.connect(collateralManagerSigner).disallowCollateral(collateralInfo.address))
      .to.emit(collateralVault, "CollateralDisallowed")
      .withArgs(collateralInfo.address);
    expect(await collateralVault.isCollateralSupported(collateralInfo.address)).to.equal(false);

    const navAfterDustIsolation = await collateralVault.totalValue();
    expect(navAfterDustIsolation).to.equal(navBeforeIssuance);

    await expect(oracleAggregator.connect(oracleManagerSigner).setOracle(collateralInfo.address, preservedOracleAddress))
      .to.emit(oracleAggregator, "OracleUpdated")
      .withArgs(collateralInfo.address, preservedOracleAddress);

    await expect(collateralVault.connect(collateralManagerSigner).allowCollateral(collateralInfo.address))
      .to.emit(collateralVault, "CollateralAllowed")
      .withArgs(collateralInfo.address);

    await expect(issuer.connect(issuerPauserSigner).setAssetMintingPause(collateralInfo.address, false))
      .to.emit(issuer, "AssetMintingPauseUpdated")
      .withArgs(collateralInfo.address, false);
    await expect(redeemer.connect(redeemerPauserSigner).setAssetRedemptionPause(collateralInfo.address, false))
      .to.emit(redeemer, "AssetRedemptionPauseUpdated")
      .withArgs(collateralInfo.address, false);
    expect(await issuer.isAssetMintingEnabled(collateralInfo.address)).to.equal(true);
    expect(await redeemer.isAssetRedemptionEnabled(collateralInfo.address)).to.equal(true);

    const navAfterReenable = await collateralVault.totalValue();
    expect(navAfterReenable).to.equal(navAfterIssuance);

    const user2NewDeposit = hre.ethers.parseUnits("250", collateralInfo.decimals);
    await collateral.connect(user2Signer).approve(await issuer.getAddress(), user2NewDeposit);
    const navBeforeUser2Issue = await collateralVault.totalValue();
    await issuer.connect(user2Signer).issue(user2NewDeposit, collateralInfo.address, 0);
    const navAfterUser2Issue = await collateralVault.totalValue();
    const user2Contribution = await collateralVault.assetValueFromAmount(user2NewDeposit, collateralInfo.address);
    expect(navAfterUser2Issue - navBeforeUser2Issue).to.equal(user2Contribution);

    const user1CollateralBefore = await collateral.balanceOf(user1);
    await dstable.connect(user1Signer).approve(await redeemer.getAddress(), redeemPortion);
    await redeemer.connect(user1Signer).redeem(redeemPortion, collateralInfo.address, 0);
    const user1CollateralAfter = await collateral.balanceOf(user1);
    expect(user1CollateralAfter - user1CollateralBefore).to.be.gt(0n);
  });
});
