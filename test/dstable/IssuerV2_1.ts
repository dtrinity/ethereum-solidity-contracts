import { assert, expect } from "chai";
import hre, { getNamedAccounts } from "hardhat";
import { Address } from "hardhat-deploy/types";

import {
  CollateralHolderVault,
  IssuerV2_1,
  OracleAggregatorV1_1,
  TestERC20,
  TestMintableERC20,
} from "../../typechain-types";
import { ORACLE_AGGREGATOR_PRICE_DECIMALS } from "../../typescript/oracle_aggregator/constants";
import { getTokenContractForSymbol, TokenInfo } from "../../typescript/token/utils";
import { createDStableFixture, DETH_CONFIG, DStableFixtureConfig, DUSD_CONFIG } from "./fixtures";

/**
 *
 * @param collateralAmount
 * @param collateralSymbol
 * @param collateralDecimals
 * @param dstableSymbol
 * @param dstableDecimals
 * @param oracleAggregator
 * @param collateralAddress
 * @param dstableAddress
 */
async function calculateExpectedDstableAmount(
  collateralAmount: bigint,
  collateralSymbol: string,
  collateralDecimals: number,
  dstableSymbol: string,
  dstableDecimals: number,
  oracleAggregator: OracleAggregatorV1_1,
  collateralAddress: string,
  dstableAddress: string,
): Promise<bigint> {
  const collateralPrice = await oracleAggregator.getAssetPrice(collateralAddress);
  const dstablePrice = await oracleAggregator.getAssetPrice(dstableAddress);
  const collateralBaseValue = (collateralAmount * collateralPrice) / 10n ** BigInt(collateralDecimals);
  return (collateralBaseValue * 10n ** BigInt(dstableDecimals)) / dstablePrice;
}

/**
 *
 * @param baseValue
 * @param dstableSymbol
 * @param dstableDecimals
 * @param oracleAggregator
 * @param dstableAddress
 */
async function calculateExpectedDstableFromBase(
  baseValue: bigint,
  dstableSymbol: string,
  dstableDecimals: number,
  oracleAggregator: OracleAggregatorV1_1,
  dstableAddress: string,
): Promise<bigint> {
  const dstablePrice = await oracleAggregator.getAssetPrice(dstableAddress);
  return (baseValue * 10n ** BigInt(dstableDecimals)) / dstablePrice;
}

// Run tests for each dStable configuration
const dstableConfigs: DStableFixtureConfig[] = [DUSD_CONFIG, DETH_CONFIG];

dstableConfigs.forEach((config) => {
  describe(`IssuerV2_1 for ${config.symbol}`, () => {
    let issuerV2_1: IssuerV2_1;
    let collateralVaultContract: CollateralHolderVault;
    let oracleAggregatorContract: OracleAggregatorV1_1;
    const collateralContracts: Map<string, TestERC20> = new Map();
    const collateralInfos: Map<string, TokenInfo> = new Map();
    let dstableContract: TestMintableERC20;
    let dstableInfo: TokenInfo;
    let deployer: Address;
    let user1: Address;
    let user2: Address;

    // Set up fixture for this specific dStable configuration
    const fixture = createDStableFixture(config);

    beforeEach(async function () {
      await fixture();

      ({ deployer, user1, user2 } = await getNamedAccounts());

      const collateralVaultAddress = (await hre.deployments.get(config.collateralVaultContractId)).address;
      collateralVaultContract = await hre.ethers.getContractAt(
        "CollateralHolderVault",
        collateralVaultAddress,
        await hre.ethers.getSigner(deployer),
      );

      // Get the oracle aggregator based on the dStable configuration
      const oracleAggregatorAddress = (await hre.deployments.get(config.oracleAggregatorId)).address;
      oracleAggregatorContract = await hre.ethers.getContractAt(
        "OracleAggregatorV1_1",
        oracleAggregatorAddress,
        await hre.ethers.getSigner(deployer),
      );

      // Get dStable token
      const dstableResult = await getTokenContractForSymbol(hre, deployer, config.symbol);
      dstableContract = dstableResult.contract as TestMintableERC20;
      dstableInfo = dstableResult.tokenInfo;

      // Get collateral tokens
      collateralContracts.clear();
      collateralInfos.clear();
      for (const symbol of config.peggedCollaterals) {
        const result = await getTokenContractForSymbol(hre, deployer, symbol);
        collateralContracts.set(symbol, result.contract);
        collateralInfos.set(symbol, result.tokenInfo);

        // Allow this collateral in the vault
        try {
          await collateralVaultContract.allowCollateral(result.tokenInfo.address);
        } catch {
          // Ignore if already allowed
        }

        // Transfer tokens to test users
        const amount = hre.ethers.parseUnits("10000", result.tokenInfo.decimals);
        await result.contract.transfer(user1, amount);
        await result.contract.transfer(user2, amount);
      }

      // Deploy IssuerV2_1 pointing at existing ecosystem contracts
      const IssuerV2_1Factory = await hre.ethers.getContractFactory("IssuerV2_1", await hre.ethers.getSigner(deployer));
      issuerV2_1 = (await IssuerV2_1Factory.deploy(
        collateralVaultAddress,
        dstableInfo.address,
        oracleAggregatorAddress,
      )) as unknown as IssuerV2_1;
      await issuerV2_1.waitForDeployment();

      // Grant MINTER_ROLE to IssuerV2_1 on the real stablecoin (upgradeable impl)
      const stableWithRoles = await hre.ethers.getContractAt(
        "ERC20StablecoinUpgradeable",
        dstableInfo.address,
        await hre.ethers.getSigner(deployer),
      );
      const MINTER_ROLE = await (stableWithRoles as any).MINTER_ROLE();
      if (!(await (stableWithRoles as any).hasRole(MINTER_ROLE, deployer))) {
        await (stableWithRoles as any).grantRole(MINTER_ROLE, deployer);
      }
      await (stableWithRoles as any).grantRole(MINTER_ROLE, await issuerV2_1.getAddress());
    });

    describe("Permissionless issuance", () => {
      // Test for each collateral type
      config.peggedCollaterals.forEach((collateralSymbol) => {
        it(`issues ${config.symbol} in exchange for ${collateralSymbol} collateral`, async function () {
          const collateralContract = collateralContracts.get(collateralSymbol) as TestERC20;
          const collateralInfo = collateralInfos.get(collateralSymbol) as TokenInfo;

          const collateralAmount = hre.ethers.parseUnits("1000", collateralInfo.decimals);

          const expectedDstableAmount = await calculateExpectedDstableAmount(
            collateralAmount,
            collateralSymbol,
            collateralInfo.decimals,
            config.symbol,
            dstableInfo.decimals,
            oracleAggregatorContract,
            collateralInfo.address,
            dstableInfo.address,
          );

          const minDStable = expectedDstableAmount;

          const vaultBalanceBefore = await collateralContract.balanceOf(await collateralVaultContract.getAddress());
          const userDstableBalanceBefore = await dstableContract.balanceOf(user1);

          await collateralContract.connect(await hre.ethers.getSigner(user1)).approve(await issuerV2_1.getAddress(), collateralAmount);

          await issuerV2_1.connect(await hre.ethers.getSigner(user1)).issue(collateralAmount, collateralInfo.address, minDStable);

          const vaultBalanceAfter = await collateralContract.balanceOf(await collateralVaultContract.getAddress());
          const userDstableBalanceAfter = await dstableContract.balanceOf(user1);

          assert.equal(
            vaultBalanceAfter - vaultBalanceBefore,
            collateralAmount,
            "Collateral vault balance did not increase by the expected amount",
          );

          const dstableReceived = userDstableBalanceAfter - userDstableBalanceBefore;

          assert.equal(
            dstableReceived,
            expectedDstableAmount,
            `User did not receive the expected amount of dStable. Expected ${expectedDstableAmount}, received ${dstableReceived}`,
          );
        });

        it(`cannot issue ${config.symbol} when asset minting is paused for ${collateralSymbol}`, async function () {
          const collateralInfo = collateralInfos.get(collateralSymbol) as TokenInfo;

          // Pause asset for minting
          await issuerV2_1.setAssetMintingPause(collateralInfo.address, true);

          const collateralAmount = hre.ethers.parseUnits("100", collateralInfo.decimals);

          await expect(issuerV2_1.connect(await hre.ethers.getSigner(user1)).issue(collateralAmount, collateralInfo.address, 0))
            .to.be.revertedWithCustomError(issuerV2_1, "AssetMintingPaused")
            .withArgs(collateralInfo.address);

          // Re-enable and verify succeeds
          await issuerV2_1.setAssetMintingPause(collateralInfo.address, false);
        });
      });

      it(`baseValueToDstableAmount converts correctly for ${config.symbol}`, async function () {
        const baseValue = hre.ethers.parseUnits("100", ORACLE_AGGREGATOR_PRICE_DECIMALS);

        const expectedDstableAmount = await calculateExpectedDstableFromBase(
          baseValue,
          config.symbol,
          dstableInfo.decimals,
          oracleAggregatorContract,
          dstableInfo.address,
        );

        const actualDstableAmount = await issuerV2_1.baseValueToDstableAmount(baseValue);

        assert.equal(actualDstableAmount, expectedDstableAmount, "Conversion from base value to dStable was incorrect");
      });
    });

    describe("Permissioned and control behaviors", () => {
      it("only PAUSER_ROLE can set asset minting pause", async function () {
        const [collateralSymbol] = config.peggedCollaterals;
        const collateralInfo = collateralInfos.get(collateralSymbol) as TokenInfo;

        // user1 should not have permission
        await expect(issuerV2_1.connect(await hre.ethers.getSigner(user1)).setAssetMintingPause(collateralInfo.address, true))
          .to.be.revertedWithCustomError(issuerV2_1, "AccessControlUnauthorizedAccount")
          .withArgs(user1, await issuerV2_1.PAUSER_ROLE());

        // deployer can set
        await issuerV2_1.setAssetMintingPause(collateralInfo.address, true);
        expect(await issuerV2_1.isAssetMintingEnabled(collateralInfo.address)).to.be.false;
        await issuerV2_1.setAssetMintingPause(collateralInfo.address, false);
        expect(await issuerV2_1.isAssetMintingEnabled(collateralInfo.address)).to.be.true;
      });

      it("pause prevents minting functions and unpause restores", async function () {
        const [collateralSymbol] = config.peggedCollaterals;
        const collateralContract = collateralContracts.get(collateralSymbol) as TestERC20;
        const collateralInfo = collateralInfos.get(collateralSymbol) as TokenInfo;

        const collateralAmount = hre.ethers.parseUnits("10", collateralInfo.decimals);
        await collateralContract.connect(await hre.ethers.getSigner(user1)).approve(await issuerV2_1.getAddress(), collateralAmount);

        // Pause by deployer (has PAUSER_ROLE)
        await issuerV2_1.pauseMinting();

        await expect(
          issuerV2_1.connect(await hre.ethers.getSigner(user1)).issue(collateralAmount, collateralInfo.address, 0),
        ).to.be.revertedWithCustomError(issuerV2_1, "EnforcedPause");

        await expect(issuerV2_1.issueUsingExcessCollateral(user2, 1n)).to.be.revertedWithCustomError(issuerV2_1, "EnforcedPause");

        // Only PAUSER_ROLE can unpause; user1 should fail
        await expect(issuerV2_1.connect(await hre.ethers.getSigner(user1)).unpauseMinting())
          .to.be.revertedWithCustomError(issuerV2_1, "AccessControlUnauthorizedAccount")
          .withArgs(user1, await issuerV2_1.PAUSER_ROLE());

        await issuerV2_1.unpauseMinting();

        await issuerV2_1.connect(await hre.ethers.getSigner(user1)).issue(collateralAmount, collateralInfo.address, 0);
      });
    });

    describe("Excess collateral issuance", () => {
      it("mints against excess collateral and respects aggregate backing", async function () {
        const [collateralSymbol] = config.peggedCollaterals;
        const collateralContract = collateralContracts.get(collateralSymbol) as TestERC20;
        const collateralInfo = collateralInfos.get(collateralSymbol) as TokenInfo;
        const user1Signer = await hre.ethers.getSigner(user1);

        // Deposit collateral directly into the vault without minting dStable
        const depositAmount = hre.ethers.parseUnits("1000", collateralInfo.decimals);
        await collateralContract.connect(user1Signer).approve(await collateralVaultContract.getAddress(), depositAmount);
        await collateralVaultContract.connect(user1Signer).deposit(depositAmount, collateralInfo.address);

        const expectedMint = await calculateExpectedDstableAmount(
          depositAmount,
          collateralSymbol,
          collateralInfo.decimals,
          config.symbol,
          dstableInfo.decimals,
          oracleAggregatorContract,
          collateralInfo.address,
          dstableInfo.address,
        );

        await issuerV2_1.issueUsingExcessCollateral(user2, expectedMint);

        // Attempting to mint any additional amount should revert because there is no further excess collateral
        await expect(issuerV2_1.issueUsingExcessCollateral(user2, 1n))
          .to.be.revertedWithCustomError(issuerV2_1, "IssuanceSurpassesCollateral");
      });
    });
  });
});
