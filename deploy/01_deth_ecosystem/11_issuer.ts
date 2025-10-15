import { Signer } from "ethers";
import { HardhatRuntimeEnvironment } from "hardhat/types";
import { DeployFunction } from "hardhat-deploy/types";

import {
  DETH_AMO_MANAGER_ID,
  DETH_COLLATERAL_VAULT_CONTRACT_ID,
  DETH_ISSUER_V2_CONTRACT_ID,
  DETH_TOKEN_ID,
  ETH_ORACLE_AGGREGATOR_ID,
} from "../../typescript/deploy-ids";

const func: DeployFunction = async function (hre: HardhatRuntimeEnvironment) {
  const { deployments, ethers } = hre;
  const { deployer } = await hre.getNamedAccounts();
  const deployerSigner = await ethers.getSigner(deployer);

  console.log(`\n≻ ${__filename.split("/").slice(-2).join("/")}: executing...`);

  const oracleAggregatorAddress = (await deployments.get(ETH_ORACLE_AGGREGATOR_ID)).address;
  const collateralVaultAddress = (await deployments.get(DETH_COLLATERAL_VAULT_CONTRACT_ID)).address;
  const amoManagerAddress = (await deployments.get(DETH_AMO_MANAGER_ID)).address;
  const dEthTokenAddress = (await deployments.get(DETH_TOKEN_ID)).address;

  const deployResult = await deployments.deploy(DETH_ISSUER_V2_CONTRACT_ID, {
    from: deployer,
    contract: "IssuerV2",
    args: [collateralVaultAddress, dEthTokenAddress, oracleAggregatorAddress, amoManagerAddress],
    log: true,
    autoMine: true,
  });

  const issuerAddress = deployResult.address;

  console.log(`  🪙 Ensuring MINTER_ROLE for ${DETH_ISSUER_V2_CONTRACT_ID} on dETH...`);
  await ensureMinterRole(hre, dEthTokenAddress, issuerAddress, deployerSigner);

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

func.id = DETH_ISSUER_V2_CONTRACT_ID;
func.tags = ["deth"];
func.dependencies = [DETH_COLLATERAL_VAULT_CONTRACT_ID, DETH_TOKEN_ID, "dETH_setup", DETH_AMO_MANAGER_ID];

export default func;
