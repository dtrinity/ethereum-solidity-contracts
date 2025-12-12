import { isAddress } from "ethers";
import { HardhatRuntimeEnvironment } from "hardhat/types";
import { DeployFunction } from "hardhat-deploy/types";

import { getConfig } from "../../config/config";
import {
  DETH_COLLATERAL_VAULT_CONTRACT_ID,
  DETH_REDEEMER_V2_CONTRACT_ID,
  DETH_TOKEN_ID,
  DUSD_COLLATERAL_VAULT_CONTRACT_ID,
  DUSD_REDEEMER_V2_CONTRACT_ID,
  DUSD_TOKEN_ID,
  ETH_ORACLE_AGGREGATOR_ID,
  USD_ORACLE_AGGREGATOR_ID,
} from "../../typescript/deploy-ids";

const func: DeployFunction = async function (hre: HardhatRuntimeEnvironment) {
  const { deployer } = await hre.getNamedAccounts();
  const { deploy, getOrNull } = hre.deployments;
  const config = await getConfig(hre);
  // Collect instructions for any manual actions required when the deployer lacks permissions.
  const manualActions: string[] = [];

  // Check all required configuration values at the top
  const dUSDConfig = config.dStables.dUSD;
  const dETHConfig = config.dStables.dETH;

  const missingConfigs: string[] = [];

  // Check dUSD configuration
  if (!dUSDConfig?.initialFeeReceiver || !isAddress(dUSDConfig.initialFeeReceiver)) {
    missingConfigs.push("dStables.dUSD.initialFeeReceiver");
  }

  if (dUSDConfig?.initialRedemptionFeeBps === undefined) {
    missingConfigs.push("dStables.dUSD.initialRedemptionFeeBps");
  }

  // Check dETH configuration
  if (!dETHConfig?.initialFeeReceiver || !isAddress(dETHConfig.initialFeeReceiver)) {
    missingConfigs.push("dStables.dETH.initialFeeReceiver");
  }

  if (dETHConfig?.initialRedemptionFeeBps === undefined) {
    missingConfigs.push("dStables.dETH.initialRedemptionFeeBps");
  }

  // If any required config values are missing, skip deployment
  if (missingConfigs.length > 0) {
    console.log(`⚠️  Skipping RedeemerV2 deployment - missing configuration values: ${missingConfigs.join(", ")}`);
    console.log(`☯️  ${__filename.split("/").slice(-2).join("/")}: ⏭️  (skipped)`);
    return true;
  }

  // Resolve required deployments (non-throwing so we can skip cleanly without --reset)
  const dUSDToken = await getOrNull(DUSD_TOKEN_ID);
  const dUSDCollateralVaultDeployment = await getOrNull(DUSD_COLLATERAL_VAULT_CONTRACT_ID);
  const usdOracleAggregator = await getOrNull(USD_ORACLE_AGGREGATOR_ID);
  const dETHToken = await getOrNull(DETH_TOKEN_ID);
  const dETHCollateralVaultDeployment = await getOrNull(DETH_COLLATERAL_VAULT_CONTRACT_ID);
  const ethOracleAggregator = await getOrNull(ETH_ORACLE_AGGREGATOR_ID);

  const missingDeployments: string[] = [];
  if (!dUSDToken) missingDeployments.push(DUSD_TOKEN_ID);
  if (!dUSDCollateralVaultDeployment) missingDeployments.push(DUSD_COLLATERAL_VAULT_CONTRACT_ID);
  if (!usdOracleAggregator) missingDeployments.push(USD_ORACLE_AGGREGATOR_ID);
  if (!dETHToken) missingDeployments.push(DETH_TOKEN_ID);
  if (!dETHCollateralVaultDeployment) missingDeployments.push(DETH_COLLATERAL_VAULT_CONTRACT_ID);
  if (!ethOracleAggregator) missingDeployments.push(ETH_ORACLE_AGGREGATOR_ID);

  if (missingDeployments.length > 0) {
    console.log(`⚠️  Skipping RedeemerV2 deployment - missing deployments: ${missingDeployments.join(", ")}`);
    console.log(`☯️  ${__filename.split("/").slice(-2).join("/")}: ⏭️  (skipped)`);
    return true;
  }

  // At this point, all deployments exist.
  const dUSDTokenDeployment = dUSDToken!;
  const dUSDCollateralVault = dUSDCollateralVaultDeployment!;
  const usdOracle = usdOracleAggregator!;
  const dETHTokenDeployment = dETHToken!;
  const dETHCollateralVault = dETHCollateralVaultDeployment!;
  const ethOracle = ethOracleAggregator!;

  // Deploy RedeemerV2 for dUSD
  const dUSDRedeemerDeployment = await deploy(DUSD_REDEEMER_V2_CONTRACT_ID, {
    from: deployer,
    contract: "RedeemerV2",
    args: [
      dUSDCollateralVault.address,
      dUSDTokenDeployment.address,
      usdOracle.address,
      dUSDConfig.initialFeeReceiver,
      dUSDConfig.initialRedemptionFeeBps,
    ],
  });

  const dUSDCollateralVaultContract = await hre.ethers.getContractAt(
    "CollateralVault",
    dUSDCollateralVault.address,
    await hre.ethers.getSigner(deployer),
  );
  const dUSDWithdrawerRole = await dUSDCollateralVaultContract.COLLATERAL_WITHDRAWER_ROLE();
  const dUSDHasRole = await dUSDCollateralVaultContract.hasRole(dUSDWithdrawerRole, dUSDRedeemerDeployment.address);
  const dUSDDeployerIsAdmin = await dUSDCollateralVaultContract.hasRole(await dUSDCollateralVaultContract.DEFAULT_ADMIN_ROLE(), deployer);

  if (!dUSDHasRole) {
    if (dUSDDeployerIsAdmin) {
      console.log("Granting role for dUSD RedeemerV2.");
      await dUSDCollateralVaultContract.grantRole(dUSDWithdrawerRole, dUSDRedeemerDeployment.address);
      console.log("Role granted for dUSD RedeemerV2.");
    } else {
      manualActions.push(
        `CollateralVault (${dUSDCollateralVault.address}).grantRole(COLLATERAL_WITHDRAWER_ROLE, ${dUSDRedeemerDeployment.address})`,
      );
    }
  }

  // Deploy RedeemerV2 for dETH

  const dETHRedeemerDeployment = await deploy(DETH_REDEEMER_V2_CONTRACT_ID, {
    from: deployer,
    contract: "RedeemerV2",
    args: [
      dETHCollateralVault.address,
      dETHTokenDeployment.address,
      ethOracle.address,
      dETHConfig.initialFeeReceiver,
      dETHConfig.initialRedemptionFeeBps,
    ],
  });

  const dETHCollateralVaultContract = await hre.ethers.getContractAt(
    "CollateralVault",
    dETHCollateralVault.address,
    await hre.ethers.getSigner(deployer),
  );
  const dETHWithdrawerRole = await dETHCollateralVaultContract.COLLATERAL_WITHDRAWER_ROLE();
  const dETHHasRole = await dETHCollateralVaultContract.hasRole(dETHWithdrawerRole, dETHRedeemerDeployment.address);
  const dETHDeployerIsAdmin = await dETHCollateralVaultContract.hasRole(await dETHCollateralVaultContract.DEFAULT_ADMIN_ROLE(), deployer);

  if (!dETHHasRole) {
    if (dETHDeployerIsAdmin) {
      await dETHCollateralVaultContract.grantRole(dETHWithdrawerRole, dETHRedeemerDeployment.address);
      console.log("Role granted for dETH RedeemerV2.");
    } else {
      manualActions.push(
        `CollateralVault (${dETHCollateralVault.address}).grantRole(COLLATERAL_WITHDRAWER_ROLE, ${dETHRedeemerDeployment.address})`,
      );
    }
  }

  // After processing, print any manual steps that are required.
  if (manualActions.length > 0) {
    console.log("\n⚠️  Manual actions required to finalize RedeemerV2 deployment:");
    manualActions.forEach((a: string) => console.log(`   - ${a}`));
  }

  console.log(`☯️  ${__filename.split("/").slice(-2).join("/")}: ✅`);

  return true;
};

func.id = "deploy_redeemer_v2";
func.tags = ["dstable", "redeemerV2"];
func.dependencies = [
  DUSD_TOKEN_ID,
  DUSD_COLLATERAL_VAULT_CONTRACT_ID,
  USD_ORACLE_AGGREGATOR_ID,
  DETH_TOKEN_ID,
  DETH_COLLATERAL_VAULT_CONTRACT_ID,
  ETH_ORACLE_AGGREGATOR_ID,
];

export default func;
