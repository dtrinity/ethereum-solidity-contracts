import { HardhatRuntimeEnvironment } from "hardhat/types";
import { DeployFunction } from "hardhat-deploy/types";

import {
  DETH_AMO_DEBT_TOKEN_ID,
  DETH_AMO_MANAGER_V2_ID,
  DETH_COLLATERAL_VAULT_CONTRACT_ID,
  DETH_HARD_PEG_ORACLE_WRAPPER_ID,
  DETH_TOKEN_ID,
  DUSD_AMO_DEBT_TOKEN_ID,
  DUSD_AMO_MANAGER_V2_ID,
  DUSD_COLLATERAL_VAULT_CONTRACT_ID,
  DUSD_HARD_PEG_ORACLE_WRAPPER_ID,
  DUSD_TOKEN_ID,
  ETH_ORACLE_AGGREGATOR_ID,
  USD_ORACLE_AGGREGATOR_ID,
} from "../../typescript/deploy-ids";

const func: DeployFunction = async function (hre: HardhatRuntimeEnvironment) {
  const { deployments, getNamedAccounts, ethers } = hre;
  const { deploy } = deployments;
  const { deployer } = await getNamedAccounts();

  console.log(`\n≻ ${__filename.split("/").slice(-2).join("/")}: executing...`);

  const amoConfigs = [
    {
      name: "dUSD",
      tokenId: DUSD_TOKEN_ID,
      oracleId: USD_ORACLE_AGGREGATOR_ID,
      collateralVaultId: DUSD_COLLATERAL_VAULT_CONTRACT_ID,
      amoManagerV2Id: DUSD_AMO_MANAGER_V2_ID,
      amoDebtTokenId: DUSD_AMO_DEBT_TOKEN_ID,
      hardPegOracleId: DUSD_HARD_PEG_ORACLE_WRAPPER_ID,
    },
    {
      name: "dETH",
      tokenId: DETH_TOKEN_ID,
      oracleId: ETH_ORACLE_AGGREGATOR_ID,
      collateralVaultId: DETH_COLLATERAL_VAULT_CONTRACT_ID,
      amoManagerV2Id: DETH_AMO_MANAGER_V2_ID,
      amoDebtTokenId: DETH_AMO_DEBT_TOKEN_ID,
      hardPegOracleId: DETH_HARD_PEG_ORACLE_WRAPPER_ID,
    },
  ];

  for (const amoConfig of amoConfigs) {
    console.log(`\n🔄 Deploying AMO system for ${amoConfig.name}...`);

    const tokenDeployment = await deployments.get(amoConfig.tokenId);
    const oracleDeployment = await deployments.get(amoConfig.oracleId);
    const collateralVaultDeployment = await deployments.get(amoConfig.collateralVaultId);

    console.log(`  📄 Dependencies:`);
    console.log(`    Token: ${tokenDeployment.address}`);
    console.log(`    Oracle: ${oracleDeployment.address}`);
    console.log(`    Collateral Vault: ${collateralVaultDeployment.address}`);

    const tokenName = "dTRINITY AMO Receipt";
    const tokenSymbol = `amo-${amoConfig.name}`;

    const debtTokenDeployment = await deploy(amoConfig.amoDebtTokenId, {
      from: deployer,
      contract: "AmoDebtToken",
      args: [tokenName, tokenSymbol],
      log: true,
      autoMine: true,
    });

    try {
      console.log(`  🔧 Ensuring oracle entry for ${amoConfig.name} debt token...`);
      const hardPegDeployment = await deployments.get(amoConfig.hardPegOracleId);
      const deployerSigner = await ethers.getSigner(deployer);
      console.log(`    ℹ️ Loading OracleAggregatorV1_1 at ${oracleDeployment.address}`);
      const oracleAggregator = await ethers.getContractAt("OracleAggregatorV1_1", oracleDeployment.address, deployerSigner);
      const oracleManagerRole = await oracleAggregator.ORACLE_MANAGER_ROLE();
      const hasRole = await oracleAggregator.hasRole(oracleManagerRole, deployer);

      if (!hasRole) {
        console.log(
          `  ⚠️  Deployer lacks ORACLE_MANAGER_ROLE on ${amoConfig.name} oracle aggregator. ` +
            `Grant role before rerunning or configure oracle manually.`,
        );
      } else {
        const hardPegWrapper = await ethers.getContractAt("HardPegOracleWrapperV1_1", hardPegDeployment.address, deployerSigner);

        const baseCurrencyUnit = await oracleAggregator.BASE_CURRENCY_UNIT();
        const lowerGuard = 0n;
        const upperGuard = 0n;

        const assetConfig = await oracleAggregator.getAssetConfig(debtTokenDeployment.address);
        const currentOracle = assetConfig.exists ? assetConfig.oracle : ethers.ZeroAddress;

        if (currentOracle !== hardPegDeployment.address) {
          const tx = await oracleAggregator.setOracle(debtTokenDeployment.address, hardPegDeployment.address);
          await tx.wait();
          console.log(`  ✅ Set hard peg oracle for ${amoConfig.name} debt token`);
        } else {
          console.log(`  ✅ Hard peg oracle already configured for ${amoConfig.name} debt token`);
        }

        const pegInfo = await hardPegWrapper.pegConfig(debtTokenDeployment.address);

        if (pegInfo.pricePeg === 0n) {
          const tx = await hardPegWrapper.configurePeg(debtTokenDeployment.address, baseCurrencyUnit, lowerGuard, upperGuard);
          await tx.wait();
          console.log(`  ✅ Configured hard peg price for ${amoConfig.name} debt token`);
        } else {
          console.log(`  ✅ Hard peg price already configured for ${amoConfig.name} debt token`);
        }
      }
    } catch (error) {
      console.log(`  ⚠️  Unable to configure hard peg oracle before manager deployment: ${(error as Error).message}`);
      console.log(`     Manager deployment may revert if oracle remains unset.`);
    }

    console.log(`  🏛️ Deploying ${amoConfig.name} AMO Manager V2...`);

    await deploy(amoConfig.amoManagerV2Id, {
      from: deployer,
      contract: "AmoManagerV2",
      args: [oracleDeployment.address, debtTokenDeployment.address, tokenDeployment.address, collateralVaultDeployment.address],
      log: true,
      autoMine: true,
    });

    console.log(`  ✅ ${amoConfig.name} AMO system deployed:`);
    console.log(`    Debt Token: ${debtTokenDeployment.address}`);
    console.log(`    Manager V2: ${(await deployments.get(amoConfig.amoManagerV2Id)).address}`);
  }

  console.log(`\n≻ ${__filename.split("/").slice(-2).join("/")}: ✅`);
};

export default func;
func.id = "01_deploy_amo_manager_v2_and_debt";
func.tags = ["amo-v2"];
func.dependencies = [
  DUSD_TOKEN_ID,
  DETH_TOKEN_ID,
  USD_ORACLE_AGGREGATOR_ID,
  ETH_ORACLE_AGGREGATOR_ID,
  DUSD_HARD_PEG_ORACLE_WRAPPER_ID,
  DETH_HARD_PEG_ORACLE_WRAPPER_ID,
  DUSD_COLLATERAL_VAULT_CONTRACT_ID,
  DETH_COLLATERAL_VAULT_CONTRACT_ID,
];
