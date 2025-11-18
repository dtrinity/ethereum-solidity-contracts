import { Signer, ZeroAddress } from "ethers";
import { HardhatRuntimeEnvironment } from "hardhat/types";
import { DeployFunction } from "hardhat-deploy/types";

import { getConfig } from "../../config/config";
import {
  DUSD_COLLATERAL_VAULT_CONTRACT_ID,
  DUSD_ISSUER_V2_CONTRACT_ID,
  DUSD_TOKEN_ID,
  USD_ORACLE_AGGREGATOR_ID,
} from "../../typescript/deploy-ids";

/**
 * Ensures the Issuer contract can mint the target dStable.
 *
 * @param hre Hardhat runtime environment.
 * @param stableAddress Stablecoin contract that owns the MINTER_ROLE.
 * @param grantee Issuer contract address that should receive the MINTER_ROLE.
 * @param signer Signer used to execute the grant transaction.
 */
async function ensureMinterRole(hre: HardhatRuntimeEnvironment, stableAddress: string, grantee: string, signer: Signer): Promise<void> {
  const stable = await hre.ethers.getContractAt("ERC20StablecoinUpgradeable", stableAddress, signer);
  const MINTER_ROLE = await stable.MINTER_ROLE();

  if (await stable.hasRole(MINTER_ROLE, grantee)) {
    console.log(`    ✓ MINTER_ROLE already granted to ${grantee}`);
    return;
  }

  const tx = await stable.grantRole(MINTER_ROLE, grantee);
  await tx.wait();
  console.log(`    ➕ Granted MINTER_ROLE to ${grantee}`);
}

/**
 * Applies governance-defined deposit caps to a freshly deployed issuer.
 *
 * @param hre Hardhat runtime environment.
 * @param issuerAddress Issuer contract to configure.
 * @param caps Mapping of collateral addresses to raw-asset caps (0 uncaps).
 * @param signer Account with DEFAULT_ADMIN_ROLE on the issuer.
 */
async function configureDepositCaps(
  hre: HardhatRuntimeEnvironment,
  issuerAddress: string,
  caps: Record<string, bigint> | undefined,
  signer: Signer,
): Promise<void> {
  if (!caps || Object.keys(caps).length === 0) {
    console.log("    ↷ No deposit caps configured for dUSD; skipping setup.");
    return;
  }

  const issuer = await hre.ethers.getContractAt("IssuerV2_2", issuerAddress, signer);

  for (const [asset, cap] of Object.entries(caps)) {
    if (!asset || asset === ZeroAddress) {
      continue;
    }

    const tx = await issuer.setAssetDepositCap(asset, cap);
    await tx.wait();
    console.log(`    ⚖️ Set deposit cap for ${asset} to ${cap.toString()}`);
  }
}

const func: DeployFunction = async function (hre: HardhatRuntimeEnvironment) {
  const { deployments } = hre;
  const { deployer } = await hre.getNamedAccounts();
  const deployerSigner = await hre.ethers.getSigner(deployer);

  const config = await getConfig(hre);
  const { tokenAddresses } = config;
  const { address: oracleAggregatorAddress } = await deployments.get(USD_ORACLE_AGGREGATOR_ID);
  const { address: collateralVaultAddress } = await deployments.get(DUSD_COLLATERAL_VAULT_CONTRACT_ID);
  const deployResult = await deployments.deploy(DUSD_ISSUER_V2_CONTRACT_ID, {
    from: deployer,
    args: [collateralVaultAddress, tokenAddresses.dUSD, oracleAggregatorAddress],
    contract: "IssuerV2_2",
    autoMine: true,
    log: true,
  });

  console.log(`  🪙 Ensuring MINTER_ROLE for ${DUSD_ISSUER_V2_CONTRACT_ID} on dUSD...`);
  await ensureMinterRole(hre, tokenAddresses.dUSD, deployResult.address, deployerSigner);

  await configureDepositCaps(hre, deployResult.address, config.dStables.dUSD.depositCaps, deployerSigner);

  console.log(`☯️ ${__filename.split("/").slice(-2).join("/")}: ✅`);

  return true;
};

func.id = DUSD_ISSUER_V2_CONTRACT_ID;
func.tags = ["dusd"];
func.dependencies = [DUSD_COLLATERAL_VAULT_CONTRACT_ID, DUSD_TOKEN_ID, "usd-oracle"];

export default func;
