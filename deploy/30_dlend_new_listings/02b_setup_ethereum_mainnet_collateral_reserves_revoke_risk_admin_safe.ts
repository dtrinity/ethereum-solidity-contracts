import { HardhatRuntimeEnvironment } from "hardhat/types";
import { DeployFunction } from "hardhat-deploy/types";

import { getConfig } from "../../config/config";
import { ATOMIC_MARKET_LISTING_HELPER_ID, POOL_ADDRESSES_PROVIDER_ID, RESERVES_SETUP_HELPER_ID } from "../../typescript/deploy-ids";
import { isLocalNetwork } from "../../typescript/hardhat/deploy";
import { GovernanceExecutor } from "../../typescript/hardhat/governance";
import { getRoleAccess } from "../_shared/safe-role";

const func: DeployFunction = async function (hre: HardhatRuntimeEnvironment): Promise<boolean> {
  if (isLocalNetwork(hre.network.name)) {
    console.log("🔁 setup-ethereum-mainnet-collateral-reserves-revoke-risk-admin-safe: local network detected – skipping");
    return true;
  }

  const { deployments, ethers } = hre;
  const { deployer } = await hre.getNamedAccounts();
  const signer = await ethers.getSigner(deployer);
  const config = await getConfig(hre);

  const executor = new GovernanceExecutor(hre, signer, config.safeConfig);

  if (!executor.useSafe) {
    throw new Error("Safe config is required for collateral reserve rollout role revoke. Provide config.safeConfig and enable Safe mode.");
  }

  await executor.initialize();

  const managerAddress = config.safeConfig!.safeAddress;
  const addressProviderDeployment = await deployments.get(POOL_ADDRESSES_PROVIDER_ID);
  const addressProvider = await ethers.getContractAt("PoolAddressesProvider", addressProviderDeployment.address, signer);
  const aclManagerAddress = await addressProvider.getACLManager();
  const aclManager = await ethers.getContractAt("ACLManager", aclManagerAddress, signer);
  const atomicHelperDeployment = await deployments.get(ATOMIC_MARKET_LISTING_HELPER_ID);
  const atomicHelperAddress = atomicHelperDeployment.address;
  const legacyHelperDeployment = await deployments.get(RESERVES_SETUP_HELPER_ID);
  const legacyHelperAddress = legacyHelperDeployment.address;

  const [riskAdminRole, assetListingAdminRole] = await Promise.all([aclManager.RISK_ADMIN_ROLE(), aclManager.ASSET_LISTING_ADMIN_ROLE()]);
  const [
    riskAdminAccess,
    assetListingAdminAccess,
    atomicHasRiskAdmin,
    atomicHasAssetListingAdmin,
    legacyHasRiskAdmin,
    legacyHasAssetListingAdmin,
  ] = await Promise.all([
    getRoleAccess(aclManager, riskAdminRole, managerAddress),
    getRoleAccess(aclManager, assetListingAdminRole, managerAddress),
    aclManager.hasRole(riskAdminRole, atomicHelperAddress),
    aclManager.hasRole(assetListingAdminRole, atomicHelperAddress),
    aclManager.hasRole(riskAdminRole, legacyHelperAddress),
    aclManager.hasRole(assetListingAdminRole, legacyHelperAddress),
  ]);

  if (!riskAdminAccess.canGrantRole) {
    throw new Error(
      [
        `[role-check] ${managerAddress} cannot revoke RISK_ADMIN_ROLE via ACLManager (${aclManagerAddress}).`,
        `Missing admin role ${riskAdminAccess.adminRole}.`,
      ].join(" "),
    );
  }

  if (!assetListingAdminAccess.canGrantRole) {
    throw new Error(
      [
        `[role-check] ${managerAddress} cannot revoke ASSET_LISTING_ADMIN_ROLE via ACLManager (${aclManagerAddress}).`,
        `Missing admin role ${assetListingAdminAccess.adminRole}.`,
      ].join(" "),
    );
  }

  if (!atomicHasRiskAdmin && !atomicHasAssetListingAdmin && !legacyHasRiskAdmin && !legacyHasAssetListingAdmin) {
    console.log("🔁 setup-ethereum-mainnet-collateral-reserves-revoke-risk-admin-safe: helper roles already revoked");
    return true;
  }

  if (atomicHasRiskAdmin) {
    const revokeRiskAdminData = aclManager.interface.encodeFunctionData("removeRiskAdmin", [atomicHelperAddress]);
    await executor.tryOrQueue(
      async () => {
        throw new Error("Direct execution disabled: queue Safe transaction instead.");
      },
      () => ({ to: aclManagerAddress, value: "0", data: revokeRiskAdminData }),
    );
  }

  if (atomicHasAssetListingAdmin) {
    const revokeAssetListingAdminData = aclManager.interface.encodeFunctionData("removeAssetListingAdmin", [atomicHelperAddress]);
    await executor.tryOrQueue(
      async () => {
        throw new Error("Direct execution disabled: queue Safe transaction instead.");
      },
      () => ({ to: aclManagerAddress, value: "0", data: revokeAssetListingAdminData }),
    );
  }

  if (legacyHasRiskAdmin) {
    const revokeLegacyRiskAdminData = aclManager.interface.encodeFunctionData("removeRiskAdmin", [legacyHelperAddress]);
    await executor.tryOrQueue(
      async () => {
        throw new Error("Direct execution disabled: queue Safe transaction instead.");
      },
      () => ({ to: aclManagerAddress, value: "0", data: revokeLegacyRiskAdminData }),
    );
  }

  if (legacyHasAssetListingAdmin) {
    const revokeLegacyAssetListingAdminData = aclManager.interface.encodeFunctionData("removeAssetListingAdmin", [legacyHelperAddress]);
    await executor.tryOrQueue(
      async () => {
        throw new Error("Direct execution disabled: queue Safe transaction instead.");
      },
      () => ({ to: aclManagerAddress, value: "0", data: revokeLegacyAssetListingAdminData }),
    );
  }

  const success = await executor.flush("Ethereum mainnet dLEND listing helper role revokes");

  if (!success) {
    throw new Error("Failed to create Safe batch for listing helper role revokes.");
  }
  console.log("🔁 setup-ethereum-mainnet-collateral-reserves-revoke-risk-admin-safe: ✅");
  return true;
};

func.tags = ["post-deploy", "dlend", "reserve-rollout", "safe", "setup-ethereum-mainnet-collateral-reserves-revoke-risk-admin-safe"];
func.dependencies = [
  "setup-ethereum-mainnet-new-listings-preflight",
  "setup-ethereum-mainnet-new-listings-role-grants-safe",
  "setup-ethereum-mainnet-collateral-reserves-config-safe",
  POOL_ADDRESSES_PROVIDER_ID,
  ATOMIC_MARKET_LISTING_HELPER_ID,
  RESERVES_SETUP_HELPER_ID,
];
func.id = "setup-ethereum-mainnet-collateral-reserves-revoke-risk-admin-safe-v5";

export default func;
