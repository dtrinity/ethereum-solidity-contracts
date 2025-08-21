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
import { ZERO_BYTES_32 } from "../../typescript/dlend/constants";
import { isMainnet } from "../../typescript/hardhat/deploy";

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
  if (
    !dUSDConfig?.initialFeeReceiver ||
    !isAddress(dUSDConfig.initialFeeReceiver)
  ) {
    missingConfigs.push("dStables.dUSD.initialFeeReceiver");
  }

  if (dUSDConfig?.initialRedemptionFeeBps === undefined) {
    missingConfigs.push("dStables.dUSD.initialRedemptionFeeBps");
  }

  // Check dS configuration
  if (
    !dETHConfig?.initialFeeReceiver ||
    !isAddress(dETHConfig.initialFeeReceiver)
  ) {
    missingConfigs.push("dStables.dS.initialFeeReceiver");
  }

  if (dETHConfig?.initialRedemptionFeeBps === undefined) {
    missingConfigs.push("dStables.dS.initialRedemptionFeeBps");
  }

  // If any required config values are missing, skip deployment
  if (missingConfigs.length > 0) {
    console.log(
      `⚠️  Skipping RedeemerWithFees deployment - missing configuration values: ${missingConfigs.join(", ")}`,
    );
    console.log(
      `☯️  ${__filename.split("/").slice(-2).join("/")}: ⏭️  (skipped)`,
    );
    return true;
  }

  // Deploy RedeemerWithFees for dUSD
  const dUSDToken = await get(DUSD_TOKEN_ID);
  const dUSDCollateralVaultDeployment = await get(
    DUSD_COLLATERAL_VAULT_CONTRACT_ID,
  );
  const usdOracleAggregator = await get(USD_ORACLE_AGGREGATOR_ID);

  const dUSDRedeemerWithFeesDeployment = await deploy(
    DUSD_REDEEMER_WITH_FEES_CONTRACT_ID,
    {
      from: deployer,
      contract: "RedeemerV2",
      args: [
        dUSDCollateralVaultDeployment.address,
        dUSDToken.address,
        usdOracleAggregator.address,
        dUSDConfig.initialFeeReceiver,
        dUSDConfig.initialRedemptionFeeBps,
      ],
    },
  );

  const dUSDCollateralVaultContract = await hre.ethers.getContractAt(
    "CollateralVault",
    dUSDCollateralVaultDeployment.address,
    await hre.ethers.getSigner(deployer),
  );
  const dUSDWithdrawerRole =
    await dUSDCollateralVaultContract.COLLATERAL_WITHDRAWER_ROLE();
  const dUSDHasRole = await dUSDCollateralVaultContract.hasRole(
    dUSDWithdrawerRole,
    dUSDRedeemerWithFeesDeployment.address,
  );
  const dUSDDeployerIsAdmin = await dUSDCollateralVaultContract.hasRole(
    await dUSDCollateralVaultContract.DEFAULT_ADMIN_ROLE(),
    deployer,
  );

  if (!dUSDHasRole) {
    if (dUSDDeployerIsAdmin) {
      console.log("Granting role for dUSD RedeemerWithFees.");
      await dUSDCollateralVaultContract.grantRole(
        dUSDWithdrawerRole,
        dUSDRedeemerWithFeesDeployment.address,
      );
      console.log("Role granted for dUSD RedeemerWithFees.");
    } else {
      manualActions.push(
        `CollateralVault (${dUSDCollateralVaultDeployment.address}).grantRole(COLLATERAL_WITHDRAWER_ROLE, ${dUSDRedeemerWithFeesDeployment.address})`,
      );
    }
  }

  // Deploy RedeemerWithFees for dS
  const dETHToken = await get(DETH_TOKEN_ID);
  const dETHCollateralVaultDeployment = await get(
    DETH_COLLATERAL_VAULT_CONTRACT_ID,
  );
  const sOracleAggregator = await get(ETH_ORACLE_AGGREGATOR_ID);

  const dETHRedeemerWithFeesDeployment = await deploy(
    DETH_REDEEMER_WITH_FEES_CONTRACT_ID,
    {
      from: deployer,
      contract: "RedeemerV2",
      args: [
        dETHCollateralVaultDeployment.address,
        dETHToken.address,
        sOracleAggregator.address,
        dETHConfig.initialFeeReceiver,
        dETHConfig.initialRedemptionFeeBps,
      ],
    },
  );

  const dETHCollateralVaultContract = await hre.ethers.getContractAt(
    "CollateralVault",
    dETHCollateralVaultDeployment.address,
    await hre.ethers.getSigner(deployer),
  );
  const dSWithdrawerRole =
    await dETHCollateralVaultContract.COLLATERAL_WITHDRAWER_ROLE();
  const dSHasRole = await dETHCollateralVaultContract.hasRole(
    dSWithdrawerRole,
    dETHRedeemerWithFeesDeployment.address,
  );
  const dSDeployerIsAdmin = await dETHCollateralVaultContract.hasRole(
    await dETHCollateralVaultContract.DEFAULT_ADMIN_ROLE(),
    deployer,
  );

  if (!dSHasRole) {
    if (dSDeployerIsAdmin) {
      await dETHCollateralVaultContract.grantRole(
        dSWithdrawerRole,
        dETHRedeemerWithFeesDeployment.address,
      );
      console.log("Role granted for dS RedeemerWithFees.");
    } else {
      manualActions.push(
        `CollateralVault (${dETHCollateralVaultDeployment.address}).grantRole(COLLATERAL_WITHDRAWER_ROLE, ${dETHRedeemerWithFeesDeployment.address})`,
      );
    }
  }

  // Transfer admin roles to governance multisig (mainnet only)
  if (isMainnet(hre.network.name)) {
    const governanceAddress = config.walletAddresses.governanceMultisig;
    const DEFAULT_ADMIN_ROLE = ZERO_BYTES_32;
    const deployerSigner = await hre.ethers.getSigner(deployer);

    console.log(
      `\n🔄 Transferring RedeemerWithFees admin roles to ${governanceAddress}...`,
    );

    // Transfer dUSD RedeemerWithFees admin role
    try {
      const dUSDRedeemerContract = await hre.ethers.getContractAt(
        "RedeemerV2",
        dUSDRedeemerWithFeesDeployment.address,
        deployerSigner,
      );

      if (
        !(await dUSDRedeemerContract.hasRole(
          DEFAULT_ADMIN_ROLE,
          governanceAddress,
        ))
      ) {
        await dUSDRedeemerContract.grantRole(
          DEFAULT_ADMIN_ROLE,
          governanceAddress,
        );
        console.log(
          `  ➕ Granted DEFAULT_ADMIN_ROLE to ${governanceAddress} for dUSD RedeemerWithFees`,
        );
      }

      if (await dUSDRedeemerContract.hasRole(DEFAULT_ADMIN_ROLE, deployer)) {
        await dUSDRedeemerContract.revokeRole(DEFAULT_ADMIN_ROLE, deployer);
        console.log(
          `  ➖ Revoked DEFAULT_ADMIN_ROLE from deployer for dUSD RedeemerWithFees`,
        );
      }
    } catch (error) {
      console.error(
        `  ❌ Failed to transfer dUSD RedeemerWithFees admin role: ${error}`,
      );
      manualActions.push(
        `dUSD_RedeemerWithFees (${dUSDRedeemerWithFeesDeployment.address}).grantRole(DEFAULT_ADMIN_ROLE, ${governanceAddress})`,
      );
      manualActions.push(
        `dUSD_RedeemerWithFees (${dUSDRedeemerWithFeesDeployment.address}).revokeRole(DEFAULT_ADMIN_ROLE, ${deployer})`,
      );
    }

    // Transfer dS RedeemerWithFees admin role
    try {
      const dETHRedeemerContract = await hre.ethers.getContractAt(
        "RedeemerV2",
        dETHRedeemerWithFeesDeployment.address,
        deployerSigner,
      );

      if (
        !(await dETHRedeemerContract.hasRole(
          DEFAULT_ADMIN_ROLE,
          governanceAddress,
        ))
      ) {
        await dETHRedeemerContract.grantRole(
          DEFAULT_ADMIN_ROLE,
          governanceAddress,
        );
        console.log(
          `  ➕ Granted DEFAULT_ADMIN_ROLE to ${governanceAddress} for dS RedeemerWithFees`,
        );
      }

      if (await dETHRedeemerContract.hasRole(DEFAULT_ADMIN_ROLE, deployer)) {
        await dETHRedeemerContract.revokeRole(DEFAULT_ADMIN_ROLE, deployer);
        console.log(
          `  ➖ Revoked DEFAULT_ADMIN_ROLE from deployer for dS RedeemerWithFees`,
        );
      }
    } catch (error) {
      console.error(
        `  ❌ Failed to transfer dS RedeemerWithFees admin role: ${error}`,
      );
      manualActions.push(
        `dS_RedeemerWithFees (${dETHRedeemerWithFeesDeployment.address}).grantRole(DEFAULT_ADMIN_ROLE, ${governanceAddress})`,
      );
      manualActions.push(
        `dS_RedeemerWithFees (${dETHRedeemerWithFeesDeployment.address}).revokeRole(DEFAULT_ADMIN_ROLE, ${deployer})`,
      );
    }

    console.log("  ✅ Completed RedeemerWithFees admin role transfers");
  } else {
    console.log(
      "\n📝 Note: Admin role transfer skipped for non-mainnet network",
    );
  }

  // After processing, print any manual steps that are required.
  if (manualActions.length > 0) {
    console.log(
      "\n⚠️  Manual actions required to finalize RedeemerWithFees deployment:",
    );
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
