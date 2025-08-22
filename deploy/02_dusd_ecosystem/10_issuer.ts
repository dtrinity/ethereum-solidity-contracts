import { HardhatRuntimeEnvironment } from "hardhat/types";
import { DeployFunction } from "hardhat-deploy/types";

import { getConfig } from "../../config/config";
import {
  DUSD_AMO_MANAGER_ID,
  DUSD_COLLATERAL_VAULT_CONTRACT_ID,
  DUSD_ISSUER_V2_CONTRACT_ID,
  DUSD_TOKEN_ID,
  USD_ORACLE_AGGREGATOR_ID,
} from "../../typescript/deploy-ids";
import { ensureDefaultAdminExistsAndRevokeFrom } from "../../typescript/hardhat/access_control";
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
 * @param stableAddress
 * @param grantee
 * @param executor
 */
async function ensureMinterRole(
  hre: HardhatRuntimeEnvironment,
  stableAddress: string,
  grantee: string,
  executor: GovernanceExecutor
): Promise<boolean> {
  const stable = await hre.ethers.getContractAt("ERC20StablecoinUpgradeable", stableAddress);
  const MINTER_ROLE = await stable.MINTER_ROLE();

  if (!(await stable.hasRole(MINTER_ROLE, grantee))) {
    const complete = await executor.tryOrQueue(
      async () => {
        await stable.grantRole(MINTER_ROLE, grantee);
        console.log(`    ➕ Granted MINTER_ROLE to ${grantee}`);
      },
      () => createGrantRoleTransaction(stableAddress, MINTER_ROLE, grantee, stable.interface)
    );
    return complete;
  }
  console.log(`    ✓ MINTER_ROLE already granted to ${grantee}`);
  return true;
}

/**
 *
 * @param hre
 * @param contractName
 * @param contractAddress
 * @param governanceMultisig
 * @param deployerAddress
 * @param deployerSigner
 * @param executor
 */
async function ensureDefaultAdminExistsAndRevokeFromWithSafe(
  hre: HardhatRuntimeEnvironment,
  contractName: string,
  contractAddress: string,
  governanceMultisig: string,
  deployerAddress: string,
  deployerSigner: any,
  executor: GovernanceExecutor
): Promise<boolean> {
  try {
    const manualActions: string[] = [];
    await ensureDefaultAdminExistsAndRevokeFrom(
      hre,
      contractName,
      contractAddress,
      governanceMultisig,
      deployerAddress,
      deployerSigner,
      manualActions
    );

    if (manualActions.length > 0) {
      if (executor.useSafe) return false;
      console.log(`    ⏭️ Non-Safe mode: manual admin migration actions detected; continuing.`);
    }
    return true;
  } catch (error) {
    if (executor.useSafe) {
      console.warn(`    🔄 Admin role migration likely requires governance action:`, error);
      return false;
    }
    console.log(`    ⏭️ Non-Safe mode: admin migration requires governance; continuing.`);
    return true;
  }
}

/**
 *
 * @param hre
 * @param issuerAddress
 * @param deployerSigner
 * @param governanceMultisig
 * @param executor
 */
async function migrateIssuerRolesIdempotent(
  hre: HardhatRuntimeEnvironment,
  issuerAddress: string,
  deployerSigner: any,
  governanceMultisig: string,
  executor: GovernanceExecutor
): Promise<boolean> {
  const issuer = await hre.ethers.getContractAt("IssuerV2", issuerAddress, deployerSigner);

  const DEFAULT_ADMIN_ROLE = ZERO_BYTES_32;
  const AMO_MANAGER_ROLE = await issuer.AMO_MANAGER_ROLE();
  const INCENTIVES_MANAGER_ROLE = await issuer.INCENTIVES_MANAGER_ROLE();
  const PAUSER_ROLE = await issuer.PAUSER_ROLE();

  const roles = [
    { name: "DEFAULT_ADMIN_ROLE", hash: DEFAULT_ADMIN_ROLE },
    { name: "AMO_MANAGER_ROLE", hash: AMO_MANAGER_ROLE },
    { name: "INCENTIVES_MANAGER_ROLE", hash: INCENTIVES_MANAGER_ROLE },
    { name: "PAUSER_ROLE", hash: PAUSER_ROLE },
  ];

  let noPendingActions = true;

  for (const role of roles) {
    if (!(await issuer.hasRole(role.hash, governanceMultisig))) {
      const complete = await executor.tryOrQueue(
        async () => {
          await issuer.grantRole(role.hash, governanceMultisig);
          console.log(`    ➕ Granted ${role.name} to governance ${governanceMultisig}`);
        },
        () => createGrantRoleTransaction(issuerAddress, role.hash, governanceMultisig, issuer.interface)
      );
      if (!complete) noPendingActions = false;
    } else {
      console.log(`    ✓ ${role.name} already granted to governance`);
    }
  }

  const deployerAddress = await deployerSigner.getAddress();
  console.log(`  🔄 Revoking roles from deployer ${deployerAddress}...`);

  for (const role of roles) {
    if (role.hash === DEFAULT_ADMIN_ROLE) continue;
    const deployerHasRole = await issuer.hasRole(role.hash, deployerAddress);
    const governanceHasRole = await issuer.hasRole(role.hash, governanceMultisig);

    if (deployerHasRole && governanceHasRole) {
      const roleName = role.name;
      const complete = await executor.tryOrQueue(
        async () => {
          await issuer.revokeRole(role.hash, deployerAddress);
          console.log(`    ➖ Revoked ${roleName} from deployer`);
        },
        () => createRevokeRoleTransaction(issuerAddress, role.hash, deployerAddress, issuer.interface)
      );
      if (!complete) noPendingActions = false;
    }
  }

  const adminMigrationComplete = await ensureDefaultAdminExistsAndRevokeFromWithSafe(
    hre,
    "IssuerV2",
    issuerAddress,
    governanceMultisig,
    deployerAddress,
    deployerSigner,
    executor
  );
  if (!adminMigrationComplete) noPendingActions = false;
  return noPendingActions;
}

const func: DeployFunction = async function (hre: HardhatRuntimeEnvironment) {
  const { deployments, ethers } = hre;
  const { deployer } = await hre.getNamedAccounts();
  const deployerSigner = await ethers.getSigner(deployer);
  const config = await getConfig(hre);

  const executor = new GovernanceExecutor(hre, deployerSigner, config.safeConfig);
  await executor.initialize();

  // Get deployed addresses
  const { address: oracleAggregatorAddress } = await deployments.get(USD_ORACLE_AGGREGATOR_ID);
  const { address: collateralVaultAddress } = await deployments.get(DUSD_COLLATERAL_VAULT_CONTRACT_ID);
  const { tokenAddresses } = await getConfig(hre);
  const { address: amoManagerAddress } = await deployments.get(DUSD_AMO_MANAGER_ID);

  const deployResult = await deployments.deploy(DUSD_ISSUER_V2_CONTRACT_ID, {
    from: deployer,
    args: [collateralVaultAddress, tokenAddresses.dUSD, oracleAggregatorAddress, amoManagerAddress],
    contract: "IssuerV2",
    autoMine: true,
    log: true,
  });

  const issuerAddress = deployResult.address;

  console.log(`  🪙 Ensuring MINTER_ROLE for ${DUSD_ISSUER_V2_CONTRACT_ID} on dUSD...`);
  const minterComplete = await ensureMinterRole(hre, tokenAddresses.dUSD, issuerAddress, executor);

  let allOperationsComplete = minterComplete;

  console.log(`  🔐 Migrating IssuerV2 roles to governance...`);
  const rolesComplete = await migrateIssuerRolesIdempotent(
    hre,
    issuerAddress,
    deployerSigner,
    config.walletAddresses.governanceMultisig,
    executor
  );
  if (!rolesComplete) allOperationsComplete = false;

  if (!allOperationsComplete) {
    const flushed = await executor.flush(`Setup IssuerV2 (dUSD): governance operations`);

    if (executor.useSafe) {
      if (!flushed) console.log(`❌ Failed to prepare governance batch`);
      console.log("\n⏳ Some operations require governance signatures to complete.");
      console.log("   The deployment script will exit and can be re-run after governance executes the transactions.");
      console.log(`\n≻ ${__filename.split("/").slice(-2).join("/")}: pending governance ⏳`);
      return false;
    } else {
      console.log("\n⏭️ Non-Safe mode: pending governance operations detected; continuing.");
    }
  }

  console.log(`☯️ ${__filename.split("/").slice(-2).join("/")}: ✅`);

  return true;
};

func.id = DUSD_ISSUER_V2_CONTRACT_ID;
func.tags = ["dusd"];
func.dependencies = [DUSD_COLLATERAL_VAULT_CONTRACT_ID, DUSD_TOKEN_ID, "usd-oracle", DUSD_AMO_MANAGER_ID];

export default func;
