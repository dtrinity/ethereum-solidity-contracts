import { HardhatRuntimeEnvironment } from "hardhat/types";
import { DeployFunction } from "hardhat-deploy/types";

import {
  DETH_COLLATERAL_VAULT_CONTRACT_ID,
  DETH_REDEEMER_CONTRACT_ID,
  DETH_REDEEMER_V2_CONTRACT_ID,
  DUSD_COLLATERAL_VAULT_CONTRACT_ID,
  DUSD_REDEEMER_CONTRACT_ID,
  DUSD_REDEEMER_V2_CONTRACT_ID,
} from "../../typescript/deploy-ids";

type RedeemerCleanupConfig = {
  label: string;
  collateralVaultId: string;
  legacyRedeemerId: string;
  redeemerV2Id: string;
};

const CONFIGS: RedeemerCleanupConfig[] = [
  {
    label: "dUSD",
    collateralVaultId: DUSD_COLLATERAL_VAULT_CONTRACT_ID,
    legacyRedeemerId: DUSD_REDEEMER_CONTRACT_ID,
    redeemerV2Id: DUSD_REDEEMER_V2_CONTRACT_ID,
  },
  {
    label: "dETH",
    collateralVaultId: DETH_COLLATERAL_VAULT_CONTRACT_ID,
    legacyRedeemerId: DETH_REDEEMER_CONTRACT_ID,
    redeemerV2Id: DETH_REDEEMER_V2_CONTRACT_ID,
  },
];

const func: DeployFunction = async function (hre: HardhatRuntimeEnvironment) {
  const { deployer } = await hre.getNamedAccounts();
  const { getOrNull } = hre.deployments;
  const signer = await hre.ethers.getSigner(deployer);

  const manualActions: string[] = [];

  for (const cfg of CONFIGS) {
    console.log(`\n🔁 Checking legacy Redeemer permissions for ${cfg.label}...`);

    const [vaultDeployment, legacyRedeemerDeployment, redeemerV2Deployment] = await Promise.all([
      getOrNull(cfg.collateralVaultId),
      getOrNull(cfg.legacyRedeemerId),
      getOrNull(cfg.redeemerV2Id),
    ]);

    if (!vaultDeployment) {
      console.log(`  ↷ Missing collateral vault deployment (${cfg.collateralVaultId}); skipping.`);
      continue;
    }

    if (!legacyRedeemerDeployment) {
      console.log(`  ✅ No legacy redeemer deployment (${cfg.legacyRedeemerId}); nothing to revoke.`);
      continue;
    }

    if (!redeemerV2Deployment) {
      throw new Error(
        `Refusing to revoke legacy redeemer for ${cfg.label}: missing RedeemerV2 deployment (${cfg.redeemerV2Id}). Deploy V2 first.`,
      );
    }

    if (legacyRedeemerDeployment.address.toLowerCase() === redeemerV2Deployment.address.toLowerCase()) {
      throw new Error(
        `Unexpected: legacy redeemer and RedeemerV2 share the same address for ${cfg.label} (${legacyRedeemerDeployment.address}). Aborting.`,
      );
    }

    const vault = await hre.ethers.getContractAt("CollateralHolderVault", vaultDeployment.address, signer);
    const withdrawerRole = await vault.COLLATERAL_WITHDRAWER_ROLE();

    const [legacyHasRole, v2HasRole, deployerCanRevoke] = await Promise.all([
      vault.hasRole(withdrawerRole, legacyRedeemerDeployment.address),
      vault.hasRole(withdrawerRole, redeemerV2Deployment.address),
      // revokeRole requires role admin of withdrawerRole (by default DEFAULT_ADMIN_ROLE)
      vault.hasRole(await vault.getRoleAdmin(withdrawerRole), deployer),
    ]);

    if (!v2HasRole) {
      throw new Error(
        `Refusing to revoke legacy redeemer for ${cfg.label}: RedeemerV2 (${redeemerV2Deployment.address}) does not have COLLATERAL_WITHDRAWER_ROLE on vault (${vaultDeployment.address}).`,
      );
    }

    if (!legacyHasRole) {
      console.log(`  ✅ Legacy redeemer already lacks COLLATERAL_WITHDRAWER_ROLE (${legacyRedeemerDeployment.address}).`);
      continue;
    }

    if (deployerCanRevoke) {
      console.log(`  🔐 Revoking COLLATERAL_WITHDRAWER_ROLE from legacy redeemer ${legacyRedeemerDeployment.address}...`);
      const tx = await vault.revokeRole(withdrawerRole, legacyRedeemerDeployment.address);
      await tx.wait();
      console.log("  ✅ Revoked.");
    } else {
      manualActions.push(
        `CollateralHolderVault (${vaultDeployment.address}).revokeRole(COLLATERAL_WITHDRAWER_ROLE, ${legacyRedeemerDeployment.address})`,
      );
    }
  }

  if (manualActions.length > 0) {
    console.log("\n⚠️  Manual actions required to revoke legacy Redeemer permissions:");
    manualActions.forEach((a: string) => console.log(`   - ${a}`));
  }

  console.log(`☯️  ${__filename.split("/").slice(-2).join("/")}: ✅`);
  return true;
};

func.id = "revoke_legacy_redeemers";
// Intentionally only runnable via explicit tag to avoid accidental revocation during routine deploys.
func.tags = ["redeemer:cleanup"];
func.dependencies = ["deploy_redeemer_v2_dusd", "deploy_redeemer_v2_deth"];

export default func;


