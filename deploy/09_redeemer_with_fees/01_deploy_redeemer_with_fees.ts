import { isAddress } from "ethers";
import { HardhatRuntimeEnvironment } from "hardhat/types";
import { DeployFunction } from "hardhat-deploy/types";

import { getConfig } from "../../config/config";
import {
  DETH_COLLATERAL_VAULT_CONTRACT_ID,
  DETH_REDEEMER_WITH_FEES_CONTRACT_ID,
  DETH_TOKEN_ID,
  DUSD_COLLATERAL_VAULT_CONTRACT_ID,
  DUSD_REDEEMER_WITH_FEES_CONTRACT_ID,
  DUSD_TOKEN_ID,
  ETH_ORACLE_AGGREGATOR_ID,
  USD_ORACLE_AGGREGATOR_ID,
} from "../../typescript/deploy-ids";

const func: DeployFunction = async function (hre: HardhatRuntimeEnvironment) {
  const { deployer } = await hre.getNamedAccounts();
  const { deploy, get } = hre.deployments;
  const config = await getConfig(hre);
  // Collect instructions for any manual actions required when the deployer lacks permissions.
  const manualActions: string[] = [];

  // Check all required configuration values at the top
  const dUSDConfig = config.dStables.dUSD;
  const dETHConfig = config.dStables.dS;

  const missingConfigs: string[] = [];

  // Check dUSD configuration
  if (!dUSDConfig?.initialFeeReceiver || !isAddress(dUSDConfig.initialFeeReceiver)) {
    missingConfigs.push("dStables.dUSD.initialFeeReceiver");
  }

  if (dUSDConfig?.initialRedemptionFeeBps === undefined) {
    missingConfigs.push("dStables.dUSD.initialRedemptionFeeBps");
  }

  // Check dS configuration
  if (!dETHConfig?.initialFeeReceiver || !isAddress(dETHConfig.initialFeeReceiver)) {
    missingConfigs.push("dStables.dS.initialFeeReceiver");
  }

  if (dETHConfig?.initialRedemptionFeeBps === undefined) {
    missingConfigs.push("dStables.dS.initialRedemptionFeeBps");
  }

  // If any required config values are missing, skip deployment
  if (missingConfigs.length > 0) {
    console.log(`⚠️  Skipping RedeemerWithFees deployment - missing configuration values: ${missingConfigs.join(", ")}`);
    console.log(`☯️  ${__filename.split("/").slice(-2).join("/")}: ⏭️  (skipped)`);
    return true;
  }

  // Deploy RedeemerWithFees for dUSD
  const dUSDToken = await get(DUSD_TOKEN_ID);
  const dUSDCollateralVaultDeployment = await get(DUSD_COLLATERAL_VAULT_CONTRACT_ID);
  const usdOracleAggregator = await get(USD_ORACLE_AGGREGATOR_ID);

  const dUSDRedeemerWithFeesDeployment = await deploy(DUSD_REDEEMER_WITH_FEES_CONTRACT_ID, {
    from: deployer,
    contract: "RedeemerV2",
    args: [
      dUSDCollateralVaultDeployment.address,
      dUSDToken.address,
      usdOracleAggregator.address,
      dUSDConfig.initialFeeReceiver,
      dUSDConfig.initialRedemptionFeeBps,
    ],
  });

  const dUSDCollateralVaultContract = await hre.ethers.getContractAt(
    "CollateralVault",
    dUSDCollateralVaultDeployment.address,
    await hre.ethers.getSigner(deployer),
  );
  const dUSDWithdrawerRole = await dUSDCollateralVaultContract.COLLATERAL_WITHDRAWER_ROLE();
  const dUSDHasRole = await dUSDCollateralVaultContract.hasRole(dUSDWithdrawerRole, dUSDRedeemerWithFeesDeployment.address);
  const dUSDDeployerIsAdmin = await dUSDCollateralVaultContract.hasRole(await dUSDCollateralVaultContract.DEFAULT_ADMIN_ROLE(), deployer);

  if (!dUSDHasRole) {
    if (dUSDDeployerIsAdmin) {
      console.log("Granting role for dUSD RedeemerWithFees.");
      await dUSDCollateralVaultContract.grantRole(dUSDWithdrawerRole, dUSDRedeemerWithFeesDeployment.address);
      console.log("Role granted for dUSD RedeemerWithFees.");
    } else {
      manualActions.push(
        `CollateralVault (${dUSDCollateralVaultDeployment.address}).grantRole(COLLATERAL_WITHDRAWER_ROLE, ${dUSDRedeemerWithFeesDeployment.address})`,
      );
    }
  }

  // Deploy RedeemerWithFees for dS
  const dETHToken = await get(DETH_TOKEN_ID);
  const dETHCollateralVaultDeployment = await get(DETH_COLLATERAL_VAULT_CONTRACT_ID);
  const sOracleAggregator = await get(ETH_ORACLE_AGGREGATOR_ID);

  const dETHRedeemerWithFeesDeployment = await deploy(DETH_REDEEMER_WITH_FEES_CONTRACT_ID, {
    from: deployer,
    contract: "RedeemerV2",
    args: [
      dETHCollateralVaultDeployment.address,
      dETHToken.address,
      sOracleAggregator.address,
      dETHConfig.initialFeeReceiver,
      dETHConfig.initialRedemptionFeeBps,
    ],
  });

  const dETHCollateralVaultContract = await hre.ethers.getContractAt(
    "CollateralVault",
    dETHCollateralVaultDeployment.address,
    await hre.ethers.getSigner(deployer),
  );
  const dSWithdrawerRole = await dETHCollateralVaultContract.COLLATERAL_WITHDRAWER_ROLE();
  const dSHasRole = await dETHCollateralVaultContract.hasRole(dSWithdrawerRole, dETHRedeemerWithFeesDeployment.address);
  const dSDeployerIsAdmin = await dETHCollateralVaultContract.hasRole(await dETHCollateralVaultContract.DEFAULT_ADMIN_ROLE(), deployer);

  if (!dSHasRole) {
    if (dSDeployerIsAdmin) {
      await dETHCollateralVaultContract.grantRole(dSWithdrawerRole, dETHRedeemerWithFeesDeployment.address);
      console.log("Role granted for dS RedeemerWithFees.");
    } else {
      manualActions.push(
        `CollateralVault (${dETHCollateralVaultDeployment.address}).grantRole(COLLATERAL_WITHDRAWER_ROLE, ${dETHRedeemerWithFeesDeployment.address})`,
      );
    }
  }

  // After processing, print any manual steps that are required.
  if (manualActions.length > 0) {
    console.log("\n⚠️  Manual actions required to finalize RedeemerWithFees deployment:");
    manualActions.forEach((a: string) => console.log(`   - ${a}`));
  }

  console.log(`☯️  ${__filename.split("/").slice(-2).join("/")}: ✅`);

  return true;
};

func.id = "deploy_redeemer_with_fees";
func.tags = ["dstable", "redeemerWithFees"];
func.dependencies = [
  DUSD_TOKEN_ID,
  DUSD_COLLATERAL_VAULT_CONTRACT_ID,
  USD_ORACLE_AGGREGATOR_ID,
  DETH_TOKEN_ID,
  DETH_COLLATERAL_VAULT_CONTRACT_ID,
  ETH_ORACLE_AGGREGATOR_ID,
];

export default func;
