import { HardhatRuntimeEnvironment } from "hardhat/types";
import { DeployFunction } from "hardhat-deploy/types";

import { getConfig } from "../../config/config";
import {
  DETH_COLLATERAL_VAULT_CONTRACT_ID,
  DETH_REDEEMER_CONTRACT_ID,
  DETH_TOKEN_ID,
  ETH_ORACLE_AGGREGATOR_ID,
} from "../../typescript/deploy-ids";
import { GovernanceExecutor } from "../../typescript/hardhat/governance";

/**
 *
 * @param contractAddress
 * @param role
 * @param grantee
 * @param contractInterface
 */
function createGrantRoleTransaction(contractAddress: string, role: string, grantee: string, contractInterface: any) {
  return {
    to: contractAddress,
    value: "0",
    data: contractInterface.encodeFunctionData("grantRole", [role, grantee]),
  };
}

/**
 *
 * @param contractAddress
 * @param role
 * @param account
 * @param contractInterface
 */
function createRevokeRoleTransaction(contractAddress: string, role: string, account: string, contractInterface: any) {
  return {
    to: contractAddress,
    value: "0",
    data: contractInterface.encodeFunctionData("revokeRole", [role, account]),
  };
}

const ZERO_BYTES_32 = "0x0000000000000000000000000000000000000000000000000000000000000000";

/**
 *
 * @param hre
 * @param redeemerAddress
 * @param deployerAddress
 * @param governanceMultisig
 * @param executor
 */
async function migrateRedeemerRolesIdempotent(
  hre: HardhatRuntimeEnvironment,
  redeemerAddress: string,
  deployerAddress: string,
  governanceMultisig: string,
  executor: GovernanceExecutor
): Promise<boolean> {
  const redeemer = await hre.ethers.getContractAt("RedeemerV2", redeemerAddress);
  const DEFAULT_ADMIN_ROLE = ZERO_BYTES_32;
  const REDEMPTION_MANAGER_ROLE = await redeemer.REDEMPTION_MANAGER_ROLE();
  const PAUSER_ROLE = await redeemer.PAUSER_ROLE();

  const roles = [
    { name: "DEFAULT_ADMIN_ROLE", hash: DEFAULT_ADMIN_ROLE },
    { name: "REDEMPTION_MANAGER_ROLE", hash: REDEMPTION_MANAGER_ROLE },
    { name: "PAUSER_ROLE", hash: PAUSER_ROLE },
  ];

  let allComplete = true;

  for (const role of roles) {
    if (!(await redeemer.hasRole(role.hash, governanceMultisig))) {
      const complete = await executor.tryOrQueue(
        async () => {
          await redeemer.grantRole(role.hash, governanceMultisig);
          console.log(`    ➕ Granted ${role.name} to ${governanceMultisig}`);
        },
        () => createGrantRoleTransaction(redeemerAddress, role.hash, governanceMultisig, redeemer.interface)
      );
      if (!complete) allComplete = false;
    } else {
      console.log(`    ✓ ${role.name} already granted to governance`);
    }
  }

  console.log(`  🔄 Revoking roles from deployer ${deployerAddress}...`);

  for (const role of roles) {
    if (role.hash === DEFAULT_ADMIN_ROLE) continue;
    const deployerHasRole = await redeemer.hasRole(role.hash, deployerAddress);
    const governanceHasRole = await redeemer.hasRole(role.hash, governanceMultisig);

    if (deployerHasRole && governanceHasRole) {
      const complete = await executor.tryOrQueue(
        async () => {
          await redeemer.revokeRole(role.hash, deployerAddress);
          console.log(`    ➖ Revoked ${role.name} from deployer`);
        },
        () => createRevokeRoleTransaction(redeemerAddress, role.hash, deployerAddress, redeemer.interface)
      );
      if (!complete) allComplete = false;
    }
  }

  return allComplete;
}

const func: DeployFunction = async function (hre: HardhatRuntimeEnvironment) {
  const { deployments, ethers } = hre;
  const { deployer } = await hre.getNamedAccounts();
  const deployerSigner = await ethers.getSigner(deployer);
  const config = await getConfig(hre);

  const executor = new GovernanceExecutor(hre, deployerSigner, config.safeConfig);
  await executor.initialize();

  // Get deployed addresses
  const { address: oracleAggregatorAddress } = await deployments.get(ETH_ORACLE_AGGREGATOR_ID);
  const { address: collateralVaultAddress } = await deployments.get(DETH_COLLATERAL_VAULT_CONTRACT_ID);

  const collateralVault = await hre.ethers.getContractAt(
    "CollateralHolderVault",
    collateralVaultAddress,
    await hre.ethers.getSigner(deployer)
  );
  const { tokenAddresses, dStables } = await getConfig(hre);

  const deployment = await deployments.deploy(DETH_REDEEMER_CONTRACT_ID, {
    from: deployer,
    args: [
      collateralVaultAddress,
      tokenAddresses.dETH,
      oracleAggregatorAddress,
      dStables.dETH.initialFeeReceiver,
      dStables.dETH.initialRedemptionFeeBps,
    ],
    contract: "RedeemerV2",
    autoMine: true,
    log: true,
  });

  console.log("Allowing Redeemer to withdraw collateral");
  const COLLATERAL_WITHDRAWER_ROLE = await collateralVault.COLLATERAL_WITHDRAWER_ROLE();

  if (!(await collateralVault.hasRole(COLLATERAL_WITHDRAWER_ROLE, deployment.address))) {
    const complete = await executor.tryOrQueue(
      async () => {
        await collateralVault.grantRole(COLLATERAL_WITHDRAWER_ROLE, deployment.address);
        console.log(`    ➕ Granted COLLATERAL_WITHDRAWER_ROLE to ${deployment.address}`);
      },
      () => createGrantRoleTransaction(collateralVaultAddress, COLLATERAL_WITHDRAWER_ROLE, deployment.address, collateralVault.interface)
    );

    if (!complete && executor.useSafe) {
      console.log(`    🔄 Pending governance to grant COLLATERAL_WITHDRAWER_ROLE to ${deployment.address}`);
    }
  } else {
    console.log(`    ✓ COLLATERAL_WITHDRAWER_ROLE already granted to ${deployment.address}`);
  }

  console.log(`  🔐 Migrating RedeemerV2 roles to governance...`);
  await migrateRedeemerRolesIdempotent(hre, deployment.address, deployer, config.walletAddresses.governanceMultisig, executor);

  console.log(`≻ ${__filename.split("/").slice(-2).join("/")}: ✅`);

  return true;
};

func.id = DETH_REDEEMER_CONTRACT_ID;
func.tags = ["deth"];
func.dependencies = [DETH_COLLATERAL_VAULT_CONTRACT_ID, DETH_TOKEN_ID, "dETH_setup"];

export default func;
