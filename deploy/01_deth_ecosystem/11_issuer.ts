import { Signer } from "ethers";
import { HardhatRuntimeEnvironment } from "hardhat/types";
import { DeployFunction } from "hardhat-deploy/types";

import { getConfig } from "../../config/config";
import {
  DETH_AMO_MANAGER_ID,
  DETH_COLLATERAL_VAULT_CONTRACT_ID,
  DETH_ISSUER_V2_CONTRACT_ID,
  DETH_TOKEN_ID,
  ETH_ORACLE_AGGREGATOR_ID,
} from "../../typescript/deploy-ids";

/**
 * Ensures the Issuer contract can mint the dETH token.
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

const func: DeployFunction = async function (hre: HardhatRuntimeEnvironment) {
  const { deployments } = hre;
  const { deployer } = await hre.getNamedAccounts();
  const deployerSigner = await hre.ethers.getSigner(deployer);

  const { tokenAddresses } = await getConfig(hre);
  const { address: oracleAggregatorAddress } = await deployments.get(ETH_ORACLE_AGGREGATOR_ID);
  const { address: collateralVaultAddress } = await deployments.get(DETH_COLLATERAL_VAULT_CONTRACT_ID);
  const { address: amoManagerAddress } = await deployments.get(DETH_AMO_MANAGER_ID);

  const deployResult = await deployments.deploy(DETH_ISSUER_V2_CONTRACT_ID, {
    from: deployer,
    contract: "IssuerV2",
    args: [collateralVaultAddress, tokenAddresses.dETH, oracleAggregatorAddress, amoManagerAddress],
    log: true,
    autoMine: true,
  });

  console.log(`  🪙 Ensuring MINTER_ROLE for ${DETH_ISSUER_V2_CONTRACT_ID} on dETH...`);
  await ensureMinterRole(hre, tokenAddresses.dETH, deployResult.address, deployerSigner);

  console.log(`\n≻ ${__filename.split("/").slice(-2).join("/")}: ✅`);
  return true;
};

func.id = DETH_ISSUER_V2_CONTRACT_ID;
func.tags = ["deth"];
func.dependencies = [DETH_COLLATERAL_VAULT_CONTRACT_ID, DETH_TOKEN_ID, "dETH_setup", DETH_AMO_MANAGER_ID];

export default func;
