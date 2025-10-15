import { Signer } from "ethers";
import { HardhatRuntimeEnvironment } from "hardhat/types";
import { DeployFunction } from "hardhat-deploy/types";

import {
  DUSD_AMO_MANAGER_ID,
  DUSD_COLLATERAL_VAULT_CONTRACT_ID,
  DUSD_ISSUER_V2_CONTRACT_ID,
  DUSD_TOKEN_ID,
  USD_ORACLE_AGGREGATOR_ID,
} from "../../typescript/deploy-ids";

const func: DeployFunction = async function (hre: HardhatRuntimeEnvironment) {
  const { deployments, ethers } = hre;
  const { deployer } = await hre.getNamedAccounts();
  const deployerSigner = await ethers.getSigner(deployer);

  console.log(`\n≻ ${__filename.split("/").slice(-2).join("/")}: executing...`);

  const oracleAggregatorAddress = (await deployments.get(USD_ORACLE_AGGREGATOR_ID)).address;
  const collateralVaultAddress = (await deployments.get(DUSD_COLLATERAL_VAULT_CONTRACT_ID)).address;
  const amoManagerAddress = (await deployments.get(DUSD_AMO_MANAGER_ID)).address;
  const dUsdTokenAddress = (await deployments.get(DUSD_TOKEN_ID)).address;

  const deployResult = await deployments.deploy(DUSD_ISSUER_V2_CONTRACT_ID, {
    from: deployer,
    contract: "IssuerV2",
    args: [collateralVaultAddress, dUsdTokenAddress, oracleAggregatorAddress, amoManagerAddress],
    log: true,
    autoMine: true,
  });

  const issuerAddress = deployResult.address;

  console.log(`  🪙 Ensuring MINTER_ROLE for ${DUSD_ISSUER_V2_CONTRACT_ID} on dUSD...`);
  await ensureMinterRole(hre, dUsdTokenAddress, issuerAddress, deployerSigner);

  console.log(`\n≻ ${__filename.split("/").slice(-2).join("/")}: ✅`);
  return true;
};

/**
 *
 * @param hre
 * @param stableAddress
 * @param grantee
 * @param signer
 */
/**
 * Grants the Issuer contract the minter role on the associated stablecoin if needed.
 *
 * @param hre Hardhat runtime environment
 * @param stableAddress Stablecoin contract address
 * @param grantee Issuer contract address
 * @param signer Deployer signer used to grant permissions
 */
async function ensureMinterRole(hre: HardhatRuntimeEnvironment, stableAddress: string, grantee: string, signer: Signer): Promise<void> {
  const stable = await hre.ethers.getContractAt("ERC20StablecoinUpgradeable", stableAddress, signer);
  const MINTER_ROLE = await stable.MINTER_ROLE();

  if (await stable.hasRole(MINTER_ROLE, grantee)) {
    console.log(`    ✓ MINTER_ROLE already granted to ${grantee}`);
    return;
  }

  await (await stable.grantRole(MINTER_ROLE, grantee)).wait();
  console.log(`    ➕ Granted MINTER_ROLE to ${grantee}`);
}

func.id = DUSD_ISSUER_V2_CONTRACT_ID;
func.tags = ["dusd"];
func.dependencies = [DUSD_COLLATERAL_VAULT_CONTRACT_ID, DUSD_TOKEN_ID, "dUSD_setup", DUSD_AMO_MANAGER_ID];

export default func;
