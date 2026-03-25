import { SignerWithAddress } from "@nomicfoundation/hardhat-ethers/signers";
import { expect } from "chai";
import hre, { ethers } from "hardhat";

import {
  ATOKEN_IMPL_ID,
  ATOMIC_MARKET_LISTING_HELPER_ID,
  STABLE_DEBT_TOKEN_IMPL_ID,
  TREASURY_PROXY_ID,
  VARIABLE_DEBT_TOKEN_IMPL_ID,
} from "../../typescript/deploy-ids";
import { dLendFixture, DLendFixtureResult } from "./fixtures";

type DecodedReserveConfig = {
  ltv: bigint;
  liquidationThreshold: bigint;
  liquidationBonus: bigint;
  reserveFactor: bigint;
  active: boolean;
  frozen: boolean;
  borrowingEnabled: boolean;
  stableBorrowingEnabled: boolean;
  paused: boolean;
  borrowableInIsolation: boolean;
  flashLoanEnabled: boolean;
  borrowCap: bigint;
  supplyCap: bigint;
  liquidationProtocolFee: bigint;
  unbackedMintCap: bigint;
  debtCeiling: bigint;
};

function bit(value: bigint, start: bigint, width = 1n): bigint {
  return (value >> start) & ((1n << width) - 1n);
}

function decodeReserveConfig(data: bigint): DecodedReserveConfig {
  return {
    ltv: bit(data, 0n, 16n),
    liquidationThreshold: bit(data, 16n, 16n),
    liquidationBonus: bit(data, 32n, 16n),
    active: bit(data, 56n) === 1n,
    frozen: bit(data, 57n) === 1n,
    borrowingEnabled: bit(data, 58n) === 1n,
    stableBorrowingEnabled: bit(data, 59n) === 1n,
    paused: bit(data, 60n) === 1n,
    borrowableInIsolation: bit(data, 61n) === 1n,
    flashLoanEnabled: bit(data, 63n) === 1n,
    reserveFactor: bit(data, 64n, 16n),
    borrowCap: bit(data, 80n, 36n),
    supplyCap: bit(data, 116n, 36n),
    liquidationProtocolFee: bit(data, 152n, 16n),
    unbackedMintCap: bit(data, 176n, 36n),
    debtCeiling: bit(data, 212n, 40n),
  };
}

describe("AtomicMarketListingHelper", () => {
  let deployerSigner: SignerWithAddress;
  let user1Signer: SignerWithAddress;
  let fixture: DLendFixtureResult;
  let helper: any;
  let pool: any;
  let poolConfigurator: any;
  let collateralAsset: string;
  let collateralToken: any;

  async function readConfig(asset: string): Promise<DecodedReserveConfig> {
    const raw = await pool.getConfiguration(asset);
    return decodeReserveConfig(BigInt(raw.data.toString()));
  }

  beforeEach(async () => {
    const { deployer, user1 } = await hre.getNamedAccounts();
    deployerSigner = await ethers.getSigner(deployer);
    user1Signer = await ethers.getSigner(user1);

    fixture = await dLendFixture();
    pool = fixture.contracts.pool;
    poolConfigurator = fixture.contracts.poolConfigurator;

    const helperAddress = (await hre.deployments.get(ATOMIC_MARKET_LISTING_HELPER_ID)).address;
    helper = await ethers.getContractAt("AtomicMarketListingHelper", helperAddress, deployerSigner);

    const aclManager = await ethers.getContractAt(
      "ACLManager",
      await fixture.contracts.poolAddressesProvider.getACLManager(),
      deployerSigner,
    );
    await aclManager.addAssetListingAdmin(await helper.getAddress());
    await aclManager.addRiskAdmin(await helper.getAddress());

    for (const [asset, reserveInfo] of Object.entries(fixture.assets)) {
      if (!reserveInfo.isDStable && reserveInfo.ltv > 0n) {
        collateralAsset = asset;
        break;
      }
    }

    if (!collateralAsset) {
      throw new Error("Expected at least one collateral reserve in the local fixture.");
    }

    collateralToken = await ethers.getContractAt("TestERC20", collateralAsset, deployerSigner);
  });

  it("stages a configured reserve and refuses to enable it before it is seeded", async () => {
    const beforeConfig = await readConfig(collateralAsset);
    const reserveData = await pool.getReserveData(collateralAsset);
    const decimals = await collateralToken.decimals();

    expect(beforeConfig.ltv).to.be.gt(0n);
    expect(beforeConfig.flashLoanEnabled).to.be.true;

    await helper.stageReserves(await pool.getAddress(), await poolConfigurator.getAddress(), [
      {
        asset: collateralAsset,
        reserveFactor: beforeConfig.reserveFactor,
        supplyCap: beforeConfig.supplyCap,
        debtCeiling: beforeConfig.debtCeiling,
      },
    ]);

    const stagedConfig = await readConfig(collateralAsset);
    expect(stagedConfig.ltv).to.equal(0n);
    expect(stagedConfig.liquidationThreshold).to.equal(0n);
    expect(stagedConfig.liquidationBonus).to.equal(0n);
    expect(stagedConfig.borrowingEnabled).to.be.false;
    expect(stagedConfig.stableBorrowingEnabled).to.be.false;
    expect(stagedConfig.flashLoanEnabled).to.be.false;
    expect(stagedConfig.borrowCap).to.equal(0n);
    expect(stagedConfig.borrowableInIsolation).to.be.false;

    const seedFloor = ethers.parseUnits("1", decimals);

    await expect(
      helper.enableReserves(await pool.getAddress(), await poolConfigurator.getAddress(), [
        {
          asset: collateralAsset,
          baseLTV: beforeConfig.ltv,
          liquidationThreshold: beforeConfig.liquidationThreshold,
          liquidationBonus: beforeConfig.liquidationBonus,
          reserveFactor: beforeConfig.reserveFactor,
          borrowCap: beforeConfig.borrowCap,
          supplyCap: beforeConfig.supplyCap,
          debtCeiling: beforeConfig.debtCeiling,
          unbackedMintCap: beforeConfig.unbackedMintCap,
          liquidationProtocolFee: beforeConfig.liquidationProtocolFee,
          borrowableInIsolation: false,
          borrowingEnabled: false,
          stableBorrowingEnabled: false,
          flashLoanEnabled: false,
          minATokenSupply: seedFloor,
        },
      ]),
    )
      .to.be.revertedWithCustomError(helper, "InsufficientATokenSupply")
      .withArgs(collateralAsset, 0n, seedFloor);

    const seedAmount = ethers.parseUnits("2", decimals);
    await collateralToken.transfer(user1Signer.address, seedAmount);
    await collateralToken.connect(user1Signer).approve(await pool.getAddress(), seedAmount);
    await pool.connect(user1Signer).supply(collateralAsset, seedAmount, user1Signer.address, 0);

    await helper.enableReserves(await pool.getAddress(), await poolConfigurator.getAddress(), [
      {
        asset: collateralAsset,
        baseLTV: beforeConfig.ltv,
        liquidationThreshold: beforeConfig.liquidationThreshold,
        liquidationBonus: beforeConfig.liquidationBonus,
        reserveFactor: beforeConfig.reserveFactor,
        borrowCap: beforeConfig.borrowCap,
        supplyCap: beforeConfig.supplyCap,
        debtCeiling: beforeConfig.debtCeiling,
        unbackedMintCap: beforeConfig.unbackedMintCap,
        liquidationProtocolFee: beforeConfig.liquidationProtocolFee,
        borrowableInIsolation: false,
        borrowingEnabled: false,
        stableBorrowingEnabled: false,
        flashLoanEnabled: false,
        minATokenSupply: seedAmount,
      },
    ]);

    const enabledConfig = await readConfig(collateralAsset);
    expect(enabledConfig.ltv).to.equal(beforeConfig.ltv);
    expect(enabledConfig.liquidationThreshold).to.equal(beforeConfig.liquidationThreshold);
    expect(enabledConfig.liquidationBonus).to.equal(beforeConfig.liquidationBonus);
    expect(enabledConfig.reserveFactor).to.equal(beforeConfig.reserveFactor);
    expect(enabledConfig.supplyCap).to.equal(beforeConfig.supplyCap);
    expect(enabledConfig.flashLoanEnabled).to.be.false;

    const aToken = await ethers.getContractAt("AToken", reserveData.aTokenAddress, deployerSigner);
    expect(await aToken.totalSupply()).to.equal(seedAmount);
  });

  it("stages a nonzero debt ceiling before seed supply so isolated enable can complete", async () => {
    const beforeConfig = await readConfig(collateralAsset);
    const stagedDebtCeiling = 123n;
    const seedAmount = ethers.parseUnits("2", await collateralToken.decimals());

    await helper.stageReserves(await pool.getAddress(), await poolConfigurator.getAddress(), [
      {
        asset: collateralAsset,
        reserveFactor: beforeConfig.reserveFactor,
        supplyCap: beforeConfig.supplyCap,
        debtCeiling: stagedDebtCeiling,
      },
    ]);

    const stagedConfig = await readConfig(collateralAsset);
    expect(stagedConfig.debtCeiling).to.equal(stagedDebtCeiling);

    await collateralToken.transfer(user1Signer.address, seedAmount);
    await collateralToken.connect(user1Signer).approve(await pool.getAddress(), seedAmount);
    await pool.connect(user1Signer).supply(collateralAsset, seedAmount, user1Signer.address, 0);

    await helper.enableReserves(await pool.getAddress(), await poolConfigurator.getAddress(), [
      {
        asset: collateralAsset,
        baseLTV: beforeConfig.ltv,
        liquidationThreshold: beforeConfig.liquidationThreshold,
        liquidationBonus: beforeConfig.liquidationBonus,
        reserveFactor: beforeConfig.reserveFactor,
        borrowCap: beforeConfig.borrowCap,
        supplyCap: beforeConfig.supplyCap,
        debtCeiling: stagedDebtCeiling,
        unbackedMintCap: beforeConfig.unbackedMintCap,
        liquidationProtocolFee: beforeConfig.liquidationProtocolFee,
        borrowableInIsolation: false,
        borrowingEnabled: false,
        stableBorrowingEnabled: false,
        flashLoanEnabled: false,
        minATokenSupply: seedAmount,
      },
    ]);

    const enabledConfig = await readConfig(collateralAsset);
    expect(enabledConfig.debtCeiling).to.equal(stagedDebtCeiling);
  });

  it("rejects enabling a seeded reserve with a new nonzero debt ceiling that was not staged", async () => {
    const beforeConfig = await readConfig(collateralAsset);
    const seedAmount = ethers.parseUnits("2", await collateralToken.decimals());
    const requestedDebtCeiling = 321n;

    await helper.stageReserves(await pool.getAddress(), await poolConfigurator.getAddress(), [
      {
        asset: collateralAsset,
        reserveFactor: beforeConfig.reserveFactor,
        supplyCap: beforeConfig.supplyCap,
        debtCeiling: beforeConfig.debtCeiling,
      },
    ]);

    await collateralToken.transfer(user1Signer.address, seedAmount);
    await collateralToken.connect(user1Signer).approve(await pool.getAddress(), seedAmount);
    await pool.connect(user1Signer).supply(collateralAsset, seedAmount, user1Signer.address, 0);

    await expect(
      helper.enableReserves(await pool.getAddress(), await poolConfigurator.getAddress(), [
        {
          asset: collateralAsset,
          baseLTV: beforeConfig.ltv,
          liquidationThreshold: beforeConfig.liquidationThreshold,
          liquidationBonus: beforeConfig.liquidationBonus,
          reserveFactor: beforeConfig.reserveFactor,
          borrowCap: beforeConfig.borrowCap,
          supplyCap: beforeConfig.supplyCap,
          debtCeiling: requestedDebtCeiling,
          unbackedMintCap: beforeConfig.unbackedMintCap,
          liquidationProtocolFee: beforeConfig.liquidationProtocolFee,
          borrowableInIsolation: false,
          borrowingEnabled: false,
          stableBorrowingEnabled: false,
          flashLoanEnabled: false,
          minATokenSupply: seedAmount,
        },
      ]),
    )
      .to.be.revertedWithCustomError(helper, "DebtCeilingMustBeStagedBeforeSeeding")
      .withArgs(collateralAsset, seedAmount, 0n, requestedDebtCeiling);
  });

  it("initializes and stages a brand-new reserve atomically", async () => {
    const existingReserveData = await pool.getReserveData(collateralAsset);
    const strategyAddress = existingReserveData.interestRateStrategyAddress;

    const tokenFactory = await ethers.getContractFactory("TestERC20", deployerSigner);
    const newToken = await tokenFactory.deploy("Atomic Listing Asset", "ALA", 18);
    await newToken.waitForDeployment();

    const aTokenImplAddress = (await hre.deployments.get(ATOKEN_IMPL_ID)).address;
    const stableDebtTokenImplAddress = (await hre.deployments.get(STABLE_DEBT_TOKEN_IMPL_ID)).address;
    const variableDebtTokenImplAddress = (await hre.deployments.get(VARIABLE_DEBT_TOKEN_IMPL_ID)).address;
    const treasuryAddress = (await hre.deployments.get(TREASURY_PROXY_ID)).address;
    const newAsset = await newToken.getAddress();

    await helper.initAndStageReserves(await pool.getAddress(), await poolConfigurator.getAddress(), [
      {
        aTokenImpl: aTokenImplAddress,
        stableDebtTokenImpl: stableDebtTokenImplAddress,
        variableDebtTokenImpl: variableDebtTokenImplAddress,
        underlyingAssetDecimals: 18,
        interestRateStrategyAddress: strategyAddress,
        underlyingAsset: newAsset,
        treasury: treasuryAddress,
        incentivesController: ethers.ZeroAddress,
        aTokenName: "dLEND Atomic Listing Asset",
        aTokenSymbol: "dLEND-ALA",
        variableDebtTokenName: "dLEND Variable Debt ALA",
        variableDebtTokenSymbol: "dLEND-variableDebt-ALA",
        stableDebtTokenName: "dLEND Stable Debt ALA",
        stableDebtTokenSymbol: "dLEND-stableDebt-ALA",
        params: "0x10",
        reserveFactor: 1000n,
        supplyCap: 1000n,
        debtCeiling: 456n,
      },
    ]);

    const newReserveData = await pool.getReserveData(newAsset);
    expect(newReserveData.aTokenAddress).to.not.equal(ethers.ZeroAddress);

    const newConfig = await readConfig(newAsset);
    expect(newConfig.active).to.be.true;
    expect(newConfig.paused).to.be.false;
    expect(newConfig.frozen).to.be.false;
    expect(newConfig.ltv).to.equal(0n);
    expect(newConfig.liquidationThreshold).to.equal(0n);
    expect(newConfig.liquidationBonus).to.equal(0n);
    expect(newConfig.borrowingEnabled).to.be.false;
    expect(newConfig.stableBorrowingEnabled).to.be.false;
    expect(newConfig.flashLoanEnabled).to.be.false;
    expect(newConfig.borrowCap).to.equal(0n);
    expect(newConfig.supplyCap).to.equal(1000n);
    expect(newConfig.reserveFactor).to.equal(1000n);
    expect(newConfig.debtCeiling).to.equal(456n);
  });
});
