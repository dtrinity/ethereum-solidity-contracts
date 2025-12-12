import { isAddress } from "ethers";
import { HardhatRuntimeEnvironment } from "hardhat/types";

export type DeployRedeemerV2Params = {
  label: string; // "dUSD" | "dETH" (log-only)
  redeemerV2Id: string;
  collateralVaultId: string;
  tokenId: string;
  oracleAggregatorId: string;
  initialFeeReceiver: string | undefined;
  initialRedemptionFeeBps: number | undefined;
};

/**
 * Deploys RedeemerV2 contract for a specific asset and configures necessary permissions.
 *
 * @param hre The Hardhat Runtime Environment
 * @param params Configuration parameters for RedeemerV2 deployment
 * @returns Object containing skip status and any manual actions required
 */
export async function deployRedeemerV2ForAsset(
  hre: HardhatRuntimeEnvironment,
  params: DeployRedeemerV2Params,
): Promise<{ skipped: boolean; manualActions: string[] }> {
  const { deployer } = await hre.getNamedAccounts();
  const { deploy, getOrNull } = hre.deployments;
  const manualActions: string[] = [];

  const { label, redeemerV2Id, collateralVaultId, tokenId, oracleAggregatorId, initialFeeReceiver, initialRedemptionFeeBps } = params;

  if (!initialFeeReceiver || !isAddress(initialFeeReceiver)) {
    console.log(`⚠️  Skipping RedeemerV2(${label}) - missing/invalid initialFeeReceiver`);
    return { skipped: true, manualActions };
  }

  if (initialRedemptionFeeBps === undefined || initialRedemptionFeeBps === null) {
    console.log(`⚠️  Skipping RedeemerV2(${label}) - missing initialRedemptionFeeBps`);
    return { skipped: true, manualActions };
  }

  const [token, collateralVault, oracleAggregator] = await Promise.all([
    getOrNull(tokenId),
    getOrNull(collateralVaultId),
    getOrNull(oracleAggregatorId),
  ]);

  const missing: string[] = [];
  if (!token) missing.push(tokenId);
  if (!collateralVault) missing.push(collateralVaultId);
  if (!oracleAggregator) missing.push(oracleAggregatorId);

  if (missing.length > 0) {
    console.log(`⚠️  Skipping RedeemerV2(${label}) - missing deployments: ${missing.join(", ")}`);
    return { skipped: true, manualActions };
  }

  const redeemerDeployment = await deploy(redeemerV2Id, {
    from: deployer,
    contract: "RedeemerV2",
    args: [collateralVault!.address, token!.address, oracleAggregator!.address, initialFeeReceiver, initialRedemptionFeeBps],
    log: true,
    autoMine: true,
    skipIfAlreadyDeployed: true,
  });

  // Ensure collateral vault allows RedeemerV2 to withdraw collateral.
  const signer = await hre.ethers.getSigner(deployer);
  const vault = await hre.ethers.getContractAt("CollateralHolderVault", collateralVault!.address, signer);
  const withdrawerRole = await vault.COLLATERAL_WITHDRAWER_ROLE();
  const alreadyHasRole = await vault.hasRole(withdrawerRole, redeemerDeployment.address);

  if (!alreadyHasRole) {
    const adminRole = await vault.getRoleAdmin(withdrawerRole);
    const deployerCanGrant = await vault.hasRole(adminRole, deployer);

    if (deployerCanGrant) {
      const tx = await vault.grantRole(withdrawerRole, redeemerDeployment.address);
      await tx.wait();
      console.log(`  🔑 Granted COLLATERAL_WITHDRAWER_ROLE to RedeemerV2(${label})`);
    } else {
      manualActions.push(
        `CollateralHolderVault (${collateralVault!.address}).grantRole(COLLATERAL_WITHDRAWER_ROLE, ${redeemerDeployment.address})`,
      );
    }
  }

  return { skipped: false, manualActions };
}
