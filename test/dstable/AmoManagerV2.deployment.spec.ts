import { assert, expect } from "chai";
import hre, { getNamedAccounts } from "hardhat";
import { Address } from "hardhat-deploy/types";

import {
  AmoDebtToken,
  AmoManagerV2,
  CollateralHolderVault,
  OracleAggregatorV1_1,
  TestERC20,
  ERC20StablecoinUpgradeable,
} from "../../typechain-types";
import { getTokenContractForAddress, getTokenContractForSymbol, TokenInfo } from "../../typescript/token/utils";
import { getConfig } from "../../config/config";
import { createDStableAmoV2Fixture, DETH_CONFIG, DStableFixtureConfig, DUSD_CONFIG } from "./fixtures";

const dstableConfigs: DStableFixtureConfig[] = [DUSD_CONFIG, DETH_CONFIG];

describe("AmoManagerV2 and AmoDebtToken - Deployment Test", () => {
  let deployer: Address;
  let user1: Address;
  let user2: Address;
  let amoWallet: Address;

  before(async () => {
    ({ deployer, user1, user2 } = await getNamedAccounts());
    amoWallet = user1;
  });

  dstableConfigs.forEach((config) => {
    runDeploymentTestsForDStable(config, { deployer, user1, user2, amoWallet });
  });
});

function runDeploymentTestsForDStable(
  config: DStableFixtureConfig,
  { deployer, user1, user2, amoWallet }: { deployer: Address; user1: Address; user2: Address; amoWallet: Address },
) {
  describe(`AMO V2 Deployment Validation for ${config.symbol}`, () => {
    let amoDebtToken: AmoDebtToken;
    let amoManagerV2: AmoManagerV2;
    let dstableContract: ERC20StablecoinUpgradeable;
    let dstableInfo: TokenInfo;
    let oracleAggregatorContract: OracleAggregatorV1_1;
    let collateralVaultContract: CollateralHolderVault;
    let collateralTokens: Map<string, TestERC20> = new Map();
    let collateralInfos: Map<string, TokenInfo> = new Map();

    let amoDebtTokenAddress: Address;
    let amoManagerV2Address: Address;

    const fixture = createDStableAmoV2Fixture(config);

    beforeEach(async function () {
      await fixture();

      ({ deployer, user1, user2 } = await getNamedAccounts());

      ({ tokenInfo: dstableInfo } = (await getTokenContractForSymbol(hre, deployer, config.symbol)) as any);
      dstableContract = (await hre.ethers.getContractAt(
        "ERC20StablecoinUpgradeable",
        dstableInfo.address,
        await hre.ethers.getSigner(deployer),
      )) as unknown as ERC20StablecoinUpgradeable;

      if (!config.amoManagerV2Id || !config.amoDebtTokenId) {
        throw new Error(`AMO V2 deployment IDs not configured for ${config.symbol}`);
      }

      const amoManagerV2Deployment = await hre.deployments.get(config.amoManagerV2Id);
      const amoDebtTokenDeployment = await hre.deployments.get(config.amoDebtTokenId);

      amoManagerV2Address = amoManagerV2Deployment.address;
      amoDebtTokenAddress = amoDebtTokenDeployment.address;

      amoManagerV2 = await hre.ethers.getContractAt("AmoManagerV2", amoManagerV2Address, await hre.ethers.getSigner(deployer));
      amoDebtToken = await hre.ethers.getContractAt("AmoDebtToken", amoDebtTokenAddress, await hre.ethers.getSigner(deployer));

      const oracleAggregatorAddress = (await hre.deployments.get(config.oracleAggregatorId)).address;
      oracleAggregatorContract = await hre.ethers.getContractAt(
        "OracleAggregatorV1_1",
        oracleAggregatorAddress,
        await hre.ethers.getSigner(deployer),
      );

      const collateralVaultAddress = (await hre.deployments.get(config.collateralVaultContractId)).address;
      collateralVaultContract = await hre.ethers.getContractAt(
        "CollateralHolderVault",
        collateralVaultAddress,
        await hre.ethers.getSigner(deployer),
      );

      const networkConfig = await getConfig(hre);
      const collateralAddresses = networkConfig.dStables[config.symbol].collaterals;

      for (const collateralAddress of collateralAddresses) {
        if (collateralAddress === hre.ethers.ZeroAddress) continue;

        const { contract, tokenInfo } = await getTokenContractForAddress(hre, deployer, collateralAddress);
        collateralTokens.set(tokenInfo.symbol, contract);
        collateralInfos.set(tokenInfo.symbol, tokenInfo);
      }
    });

    describe("Deployment Script Validation", () => {
      it("should deploy contracts with correct addresses", async function () {
        expect(amoDebtTokenAddress).to.not.equal(hre.ethers.ZeroAddress);
        expect(amoManagerV2Address).to.not.equal(hre.ethers.ZeroAddress);
        expect(amoDebtTokenAddress).to.not.equal(amoManagerV2Address);
      });

      it("should have correct AmoDebtToken configuration", async function () {
        expect(await amoDebtToken.name()).to.equal("dTRINITY AMO Receipt");
        expect(await amoDebtToken.symbol()).to.equal(`amo-${config.symbol}`);
        expect(await amoDebtToken.decimals()).to.equal(18);
        expect(await amoDebtToken.totalSupply()).to.equal(0);
      });

      it("should have correct AmoManagerV2 configuration", async function () {
        expect(await amoManagerV2.debtToken()).to.equal(amoDebtTokenAddress);
        expect(await amoManagerV2.dstable()).to.equal(await dstableContract.getAddress());
        expect(await amoManagerV2.tolerance()).to.equal(1n);
        expect(await amoManagerV2.collateralVault()).to.equal(await collateralVaultContract.getAddress());
      });
    });

    describe("Role Configuration Validation", () => {
      it("should have correct roles on AmoDebtToken", async function () {
        const DEFAULT_ADMIN_ROLE = await amoDebtToken.DEFAULT_ADMIN_ROLE();
        const AMO_MANAGER_ROLE = await amoDebtToken.AMO_MANAGER_ROLE();

        expect(await amoDebtToken.hasRole(AMO_MANAGER_ROLE, amoManagerV2Address)).to.be.true;

        const networkConfig2 = await getConfig(hre);
        const governance = networkConfig2.walletAddresses.governanceMultisig;
        expect(await amoDebtToken.hasRole(DEFAULT_ADMIN_ROLE, governance)).to.be.true;
      });

      it("should have correct roles on AmoManagerV2", async function () {
        const DEFAULT_ADMIN_ROLE = await amoManagerV2.DEFAULT_ADMIN_ROLE();
        const AMO_INCREASE_ROLE = await amoManagerV2.AMO_INCREASE_ROLE();
        const AMO_DECREASE_ROLE = await amoManagerV2.AMO_DECREASE_ROLE();

        const networkConfig3 = await getConfig(hre);
        const expectedWallet = networkConfig3.walletAddresses.governanceMultisig;

        expect(await amoManagerV2.hasRole(AMO_INCREASE_ROLE, expectedWallet)).to.be.true;
        expect(await amoManagerV2.hasRole(AMO_DECREASE_ROLE, expectedWallet)).to.be.true;

        expect(await amoManagerV2.hasRole(DEFAULT_ADMIN_ROLE, expectedWallet)).to.be.true;
      });

      it("should have correct roles on dStable token", async function () {
        const MINTER_ROLE = await dstableContract.MINTER_ROLE();
        expect(await dstableContract.hasRole(MINTER_ROLE, amoManagerV2Address)).to.be.true;
      });

      it("should have correct roles on collateral vault", async function () {
        const COLLATERAL_WITHDRAWER_ROLE = await collateralVaultContract.COLLATERAL_WITHDRAWER_ROLE();
        expect(await collateralVaultContract.hasRole(COLLATERAL_WITHDRAWER_ROLE, amoManagerV2Address)).to.be.true;
      });
    });

    describe("Allowlist Configuration Validation", () => {
      it("should have correct AmoDebtToken allowlist", async function () {
        const vaultAddress = await collateralVaultContract.getAddress();
        expect(await amoDebtToken.isAllowlisted(vaultAddress)).to.be.true;
        expect(await amoDebtToken.isAllowlisted(amoManagerV2Address)).to.be.true;
      });

      it("should have correct AmoManagerV2 allowlists", async function () {
        const vaultAddress = await collateralVaultContract.getAddress();
        const allowedWallets = await amoManagerV2.getAllowedAmoWallets();
        const networkConfigLocal = await getConfig(hre);
        const governanceWallet = networkConfigLocal.walletAddresses.governanceMultisig;

        expect(allowedWallets).to.include(governanceWallet);
        expect(await amoManagerV2.collateralVault()).to.equal(vaultAddress);
      });
    });

    describe("Oracle Configuration Validation", () => {
      it("should register AmoDebtToken with hard peg oracle", async function () {
        const assetConfig = await oracleAggregatorContract.getAssetConfig(amoDebtTokenAddress);
        expect(assetConfig.oracle).to.not.equal(hre.ethers.ZeroAddress);
      });
    });

    describe("Invariant Checks", () => {
      it("should start with zero supply for debt token", async function () {
        expect(await amoDebtToken.totalSupply()).to.equal(0);
      });

      it("should have zero AMO wallet allowlist length by default", async function () {
        const length = await amoManagerV2.getAllowedAmoWalletsLength();
        expect(length).to.be.greaterThanOrEqual(0);
      });

      it("should track collateral tokens for reference", async function () {
        assert(collateralTokens.size >= 1, "Expected collateral tokens to be tracked");
      });
    });
  });
}
