import { ZeroAddress } from "ethers";
import { HardhatRuntimeEnvironment } from "hardhat/types";
import { DeployFunction } from "hardhat-deploy/types";

import { ACL_MANAGER_ID, POOL_ADDRESSES_PROVIDER_ID } from "../../../typescript/deploy-ids";
import { ZERO_BYTES_32 } from "../../../typescript/dlend/constants";

const func: DeployFunction = async function (hre: HardhatRuntimeEnvironment) {
  const [deployer] = await hre.ethers.getSigners();

  const addressesProviderDeployedResult = await hre.deployments.get(POOL_ADDRESSES_PROVIDER_ID);

  const addressesProviderContract = await hre.ethers.getContractAt(
    "PoolAddressesProvider",
    addressesProviderDeployedResult.address,
    deployer,
  );

  // 1. Set ACL admin on AddressesProvider (only if not already set)
  const currentACLAdmin = await addressesProviderContract.getACLAdmin();
  if (currentACLAdmin === ZeroAddress) {
    await addressesProviderContract.setACLAdmin(deployer.address);
    console.log(`  - ACL Admin set to deployer: ${deployer.address}`);
  } else {
    console.log(`  - ACL Admin already set to: ${currentACLAdmin}`);
  }

  // 2. Deploy ACLManager
  const aclManagerDeployment = await hre.deployments.deploy(ACL_MANAGER_ID, {
    contract: "ACLManager",
    from: deployer.address,
    args: [addressesProviderDeployedResult.address],
    log: true,
  });

  const aclManagerContract = await hre.ethers.getContractAt("ACLManager", aclManagerDeployment.address, deployer);

  // 3. Setup ACLManager for AddressProvider (only if not already set)
  const currentACLManager = await addressesProviderContract.getACLManager();
  if (currentACLManager === ZeroAddress || currentACLManager !== aclManagerDeployment.address) {
    try {
      await addressesProviderContract.setACLManager(aclManagerDeployment.address);
      console.log(`  - ACL Manager set to: ${aclManagerDeployment.address}`);
    } catch (error: unknown) {
      const errorMessage = error instanceof Error ? error.message : String(error);
      console.log(`  - Failed to set ACL Manager (may not be owner): ${errorMessage}`);
    }
  } else {
    console.log(`  - ACL Manager already set to: ${currentACLManager}`);
  }

  // 4. Add PoolAdmin to ACLManager (only if not already set)
  const isAlreadyPoolAdmin = await aclManagerContract.isPoolAdmin(deployer.address);
  if (!isAlreadyPoolAdmin) {
    try {
      await aclManagerContract.addPoolAdmin(deployer.address);
      console.log(`  - Pool Admin role granted to deployer`);
    } catch (error: unknown) {
      const errorMessage = error instanceof Error ? error.message : String(error);
      console.log(`  - Failed to add Pool Admin (may not be ACL admin): ${errorMessage}`);
    }
  } else {
    console.log(`  - Deployer is already Pool Admin`);
  }

  // 5. Add EmergencyAdmin to ACLManager (only if not already set)
  const isAlreadyEmergencyAdmin = await aclManagerContract.isEmergencyAdmin(deployer.address);
  if (!isAlreadyEmergencyAdmin) {
    try {
      await aclManagerContract.addEmergencyAdmin(deployer.address);
      console.log(`  - Emergency Admin role granted to deployer`);
    } catch (error: unknown) {
      const errorMessage = error instanceof Error ? error.message : String(error);
      console.log(`  - Failed to add Emergency Admin (may not be ACL admin): ${errorMessage}`);
    }
  } else {
    console.log(`  - Deployer is already Emergency Admin`);
  }

  // Verify setup - use the actual ACL admin from the addresses provider
  const aclAdmin = await addressesProviderContract.getACLAdmin();
  const isACLAdmin = await aclManagerContract.hasRole(ZERO_BYTES_32, aclAdmin);
  const isPoolAdmin = await aclManagerContract.isPoolAdmin(deployer.address);
  const isEmergencyAdmin = await aclManagerContract.isEmergencyAdmin(deployer.address);

  console.log(`  - ACL Admin (${aclAdmin}): ${isACLAdmin}`);
  console.log(`  - Pool Admin (${deployer.address}): ${isPoolAdmin}`);
  console.log(`  - Emergency Admin (${deployer.address}): ${isEmergencyAdmin}`);

  // Only fail if the ACL admin role itself is not set correctly on the ACLManager
  if (!isACLAdmin) {
    throw "[ACL][ERROR] ACLAdmin is not setup correctly on ACLManager";
  }

  // Warn but don't fail if deployer doesn't have admin roles (may have been transferred)
  if (!isPoolAdmin) {
    console.log(`  - [WARN] Deployer is not Pool Admin - roles may have been transferred`);
  }

  if (!isEmergencyAdmin) {
    console.log(`  - [WARN] Deployer is not Emergency Admin - roles may have been transferred`);
  }

  console.log(`🏦 ${__filename.split("/").slice(-2).join("/")}: ✅`);

  return true;
};

func.id = "dLend:init_acl";
func.tags = ["dlend", "dlend-market"];
func.dependencies = ["dlend-core", "dlend-periphery-pre", "PoolAddressesProvider"];

export default func;
