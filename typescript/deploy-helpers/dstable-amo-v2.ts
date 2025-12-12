import { HardhatRuntimeEnvironment } from "hardhat/types";

export type DeployAmoV2Params = {
  label: string; // "dUSD" | "dETH" (log-only)
  tokenId: string;
  oracleAggregatorId: string;
  collateralVaultId: string;
  hardPegOracleWrapperId: string;
  amoDebtTokenId: string;
  amoManagerV2Id: string;
};

/**
 * Checks if the deployer account can grant a specific role on a contract.
 *
 * @param contract The contract instance to check role permissions on
 * @param role The role bytes32 identifier to check
 * @param deployer The deployer account address to check permissions for
 * @returns True if the deployer can grant the role, false otherwise
 */
async function canGrantRole(contract: any, role: string, deployer: string): Promise<boolean> {
  const adminRole = await contract.getRoleAdmin(role);
  return await contract.hasRole(adminRole, deployer);
}

/**
 * Deploys AMO V2 contracts for a specific asset, including debt token and manager.
 *
 * @param hre The Hardhat Runtime Environment
 * @param params Configuration parameters for AMO deployment
 * @returns Object containing skip status and any manual actions required
 */
export async function deployAmoV2ForAsset(
  hre: HardhatRuntimeEnvironment,
  params: DeployAmoV2Params,
): Promise<{ skipped: boolean; manualActions: string[] }> {
  const { deployments, ethers } = hre;
  const { deploy, getOrNull } = deployments;
  const { deployer } = await hre.getNamedAccounts();

  const manualActions: string[] = [];
  const { label, tokenId, oracleAggregatorId, collateralVaultId, hardPegOracleWrapperId, amoDebtTokenId, amoManagerV2Id } = params;

  const [token, oracleAgg, vault, hardPegWrapper] = await Promise.all([
    getOrNull(tokenId),
    getOrNull(oracleAggregatorId),
    getOrNull(collateralVaultId),
    getOrNull(hardPegOracleWrapperId),
  ]);

  const missing: string[] = [];
  if (!token) missing.push(tokenId);
  if (!oracleAgg) missing.push(oracleAggregatorId);
  if (!vault) missing.push(collateralVaultId);
  if (!hardPegWrapper) missing.push(hardPegOracleWrapperId);

  if (missing.length > 0) {
    console.log(`⚠️  Skipping AMO V2 deploy(${label}) - missing deployments: ${missing.join(", ")}`);
    return { skipped: true, manualActions };
  }

  const debtTokenName = "dTRINITY AMO Receipt";
  const debtTokenSymbol = `amo-${label}`;

  const debtTokenDeployment = await deploy(amoDebtTokenId, {
    from: deployer,
    contract: "AmoDebtToken",
    args: [debtTokenName, debtTokenSymbol],
    log: true,
    autoMine: true,
    skipIfAlreadyDeployed: true,
  });

  // Ensure oracle entry for debt token (requires ORACLE_MANAGER_ROLE on oracle aggregator).
  const signer = await ethers.getSigner(deployer);
  const oracleAggregator = await ethers.getContractAt("OracleAggregatorV1_1", oracleAgg!.address, signer);
  const oracleManagerRole = await oracleAggregator.ORACLE_MANAGER_ROLE();
  const deployerIsOracleManager = await oracleAggregator.hasRole(oracleManagerRole, deployer);

  const currentOracle = await oracleAggregator.assetOracles(debtTokenDeployment.address);
  const targetOracle = hardPegWrapper!.address;

  if (currentOracle.toLowerCase() !== targetOracle.toLowerCase()) {
    if (deployerIsOracleManager) {
      const tx = await oracleAggregator.setOracle(debtTokenDeployment.address, targetOracle);
      await tx.wait();
      console.log(`  ✅ Set hard peg oracle for ${label} AMO debt token`);
    } else {
      manualActions.push(`OracleAggregatorV1_1 (${oracleAgg!.address}).setOracle(${debtTokenDeployment.address}, ${targetOracle})`);
    }
  }

  await deploy(amoManagerV2Id, {
    from: deployer,
    contract: "AmoManagerV2",
    args: [oracleAgg!.address, debtTokenDeployment.address, token!.address, vault!.address],
    log: true,
    autoMine: true,
    skipIfAlreadyDeployed: true,
  });

  return { skipped: false, manualActions };
}

/**
 * Configures AMO V2 contracts for a specific asset, setting up roles and permissions.
 *
 * @param hre The Hardhat Runtime Environment
 * @param params Configuration parameters for AMO configuration including governance multisig
 * @returns Object containing skip status and any manual actions required
 */
export async function configureAmoV2ForAsset(
  hre: HardhatRuntimeEnvironment,
  params: DeployAmoV2Params & { governanceMultisig: string },
): Promise<{ skipped: boolean; manualActions: string[] }> {
  const { deployments, ethers } = hre;
  const { getOrNull } = deployments;
  const { deployer } = await hre.getNamedAccounts();
  const signer = await ethers.getSigner(deployer);

  const manualActions: string[] = [];
  const { label, tokenId, oracleAggregatorId, collateralVaultId, amoManagerV2Id, amoDebtTokenId, governanceMultisig } = params;

  const [token, oracleAgg, vault, amoManagerDep, debtTokenDep] = await Promise.all([
    getOrNull(tokenId),
    getOrNull(oracleAggregatorId),
    getOrNull(collateralVaultId),
    getOrNull(amoManagerV2Id),
    getOrNull(amoDebtTokenId),
  ]);

  const missing: string[] = [];
  if (!token) missing.push(tokenId);
  if (!oracleAgg) missing.push(oracleAggregatorId);
  if (!vault) missing.push(collateralVaultId);
  if (!amoManagerDep) missing.push(amoManagerV2Id);
  if (!debtTokenDep) missing.push(amoDebtTokenId);

  if (missing.length > 0) {
    console.log(`⚠️  Skipping AMO V2 configure(${label}) - missing deployments: ${missing.join(", ")}`);
    return { skipped: true, manualActions };
  }

  const dstable = await ethers.getContractAt("ERC20StablecoinUpgradeable", token!.address, signer);
  const oracle = await ethers.getContractAt("OracleAggregatorV1_1", oracleAgg!.address, signer);
  const collateralVault = await ethers.getContractAt("CollateralHolderVault", vault!.address, signer);
  const amoManager = await ethers.getContractAt("AmoManagerV2", amoManagerDep!.address, signer);
  const debtToken = await ethers.getContractAt("AmoDebtToken", debtTokenDep!.address, signer);

  // Safety check: hard peg wrapper should yield 1.0 price for debt token.
  const baseCurrencyUnit = await oracle.BASE_CURRENCY_UNIT();
  const expectedPrice = baseCurrencyUnit;
  const currentPrice = await oracle.getAssetPrice(debtTokenDep!.address);

  if (currentPrice !== expectedPrice) {
    throw new Error(
      `Debt token oracle price mismatch for ${label}. Expected ${expectedPrice}, received ${currentPrice}. Ensure hard peg oracle is set first.`,
    );
  }

  // --- Roles ---
  const AMO_MANAGER_ROLE = await debtToken.AMO_MANAGER_ROLE();

  if (!(await debtToken.hasRole(AMO_MANAGER_ROLE, amoManagerDep!.address))) {
    if (await canGrantRole(debtToken, AMO_MANAGER_ROLE, deployer)) {
      const tx = await debtToken.grantRole(AMO_MANAGER_ROLE, amoManagerDep!.address);
      await tx.wait();
      console.log(`  🔑 Granted AMO_MANAGER_ROLE on AmoDebtToken to AmoManagerV2 (${label})`);
    } else {
      manualActions.push(`AmoDebtToken (${debtTokenDep!.address}).grantRole(AMO_MANAGER_ROLE, ${amoManagerDep!.address})`);
    }
  }

  const MINTER_ROLE = await dstable.MINTER_ROLE();

  if (!(await dstable.hasRole(MINTER_ROLE, amoManagerDep!.address))) {
    if (await canGrantRole(dstable, MINTER_ROLE, deployer)) {
      const tx = await dstable.grantRole(MINTER_ROLE, amoManagerDep!.address);
      await tx.wait();
      console.log(`  🔑 Granted MINTER_ROLE on dStable to AmoManagerV2 (${label})`);
    } else {
      manualActions.push(`ERC20StablecoinUpgradeable (${token!.address}).grantRole(MINTER_ROLE, ${amoManagerDep!.address})`);
    }
  }

  const WITHDRAWER_ROLE = await collateralVault.COLLATERAL_WITHDRAWER_ROLE();

  if (!(await collateralVault.hasRole(WITHDRAWER_ROLE, amoManagerDep!.address))) {
    if (await canGrantRole(collateralVault, WITHDRAWER_ROLE, deployer)) {
      const tx = await collateralVault.grantRole(WITHDRAWER_ROLE, amoManagerDep!.address);
      await tx.wait();
      console.log(`  🔑 Granted COLLATERAL_WITHDRAWER_ROLE on vault to AmoManagerV2 (${label})`);
    } else {
      manualActions.push(`CollateralHolderVault (${vault!.address}).grantRole(COLLATERAL_WITHDRAWER_ROLE, ${amoManagerDep!.address})`);
    }
  }

  // --- Allowlists / wiring ---
  const collateralManagerRole = await collateralVault.COLLATERAL_MANAGER_ROLE();

  if (!(await collateralVault.isCollateralSupported(debtTokenDep!.address))) {
    const deployerIsManager = await collateralVault.hasRole(collateralManagerRole, deployer);

    if (deployerIsManager) {
      const tx = await collateralVault.allowCollateral(debtTokenDep!.address);
      await tx.wait();
      console.log(`  ✅ Allowed AMO debt token as collateral (${label})`);
    } else {
      manualActions.push(`CollateralHolderVault (${vault!.address}).allowCollateral(${debtTokenDep!.address})`);
    }
  }

  if (!(await debtToken.isAllowlisted(vault!.address))) {
    const adminRole = await debtToken.DEFAULT_ADMIN_ROLE();
    const deployerIsAdmin = await debtToken.hasRole(adminRole, deployer);

    if (deployerIsAdmin) {
      const tx = await debtToken.setAllowlisted(vault!.address, true);
      await tx.wait();
      console.log(`  ✅ Allowlisted collateral vault on AmoDebtToken (${label})`);
    } else {
      manualActions.push(`AmoDebtToken (${debtTokenDep!.address}).setAllowlisted(${vault!.address}, true)`);
    }
  }

  if (!(await debtToken.isAllowlisted(amoManagerDep!.address))) {
    const adminRole = await debtToken.DEFAULT_ADMIN_ROLE();
    const deployerIsAdmin = await debtToken.hasRole(adminRole, deployer);

    if (deployerIsAdmin) {
      const tx = await debtToken.setAllowlisted(amoManagerDep!.address, true);
      await tx.wait();
      console.log(`  ✅ Allowlisted AmoManagerV2 on AmoDebtToken (${label})`);
    } else {
      manualActions.push(`AmoDebtToken (${debtTokenDep!.address}).setAllowlisted(${amoManagerDep!.address}, true)`);
    }
  }

  if ((await amoManager.collateralVault()) !== vault!.address) {
    const adminRole = await amoManager.DEFAULT_ADMIN_ROLE();
    const deployerIsAdmin = await amoManager.hasRole(adminRole, deployer);

    if (deployerIsAdmin) {
      const tx = await amoManager.setCollateralVault(vault!.address);
      await tx.wait();
      console.log(`  ✅ Set collateral vault on AmoManagerV2 (${label})`);
    } else {
      manualActions.push(`AmoManagerV2 (${amoManagerDep!.address}).setCollateralVault(${vault!.address})`);
    }
  }

  if (governanceMultisig && !(await amoManager.isAmoWalletAllowed(governanceMultisig))) {
    const adminRole = await amoManager.DEFAULT_ADMIN_ROLE();
    const deployerIsAdmin = await amoManager.hasRole(adminRole, deployer);

    if (deployerIsAdmin) {
      const tx = await amoManager.setAmoWalletAllowed(governanceMultisig, true);
      await tx.wait();
      console.log(`  ✅ Allowlisted governance wallet on AmoManagerV2 (${label})`);
    } else {
      manualActions.push(`AmoManagerV2 (${amoManagerDep!.address}).setAmoWalletAllowed(${governanceMultisig}, true)`);
    }
  }

  if (!(await amoManager.isAmoWalletAllowed(deployer))) {
    const adminRole = await amoManager.DEFAULT_ADMIN_ROLE();
    const deployerIsAdmin = await amoManager.hasRole(adminRole, deployer);

    if (deployerIsAdmin) {
      const tx = await amoManager.setAmoWalletAllowed(deployer, true);
      await tx.wait();
      console.log(`  ✅ Allowlisted deployer on AmoManagerV2 (${label})`);
    } else {
      manualActions.push(`AmoManagerV2 (${amoManagerDep!.address}).setAmoWalletAllowed(${deployer}, true)`);
    }
  }

  return { skipped: false, manualActions };
}
