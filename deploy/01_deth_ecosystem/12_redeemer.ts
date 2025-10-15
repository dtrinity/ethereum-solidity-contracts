import { Signer } from "ethers";
import { HardhatRuntimeEnvironment } from "hardhat/types";
import { DeployFunction } from "hardhat-deploy/types";

import { getConfig } from "../../config/config";
import {
  DETH_COLLATERAL_VAULT_CONTRACT_ID,
  DETH_REDEEMER_CONTRACT_ID,
  DETH_TOKEN_ID,
  ETH_ORACLE_AGGREGATOR_ID,
} from "../../typescript/deploy-ids";

const func: DeployFunction = async function (hre: HardhatRuntimeEnvironment) {
  const { deployments, ethers } = hre;
  const { deployer } = await hre.getNamedAccounts();
  const deployerSigner = await ethers.getSigner(deployer);
  const config = await getConfig(hre);

  const oracleAggregatorAddress = (await deployments.get(ETH_ORACLE_AGGREGATOR_ID)).address;
  const collateralVaultAddress = (await deployments.get(DETH_COLLATERAL_VAULT_CONTRACT_ID)).address;
  const dEthTokenAddress = (await deployments.get(DETH_TOKEN_ID)).address;

  const redeemerConfig = config.dStables.dETH;
  const feeReceiver = redeemerConfig.initialFeeReceiver ?? deployer;
  const redemptionFeeBps = redeemerConfig.initialRedemptionFeeBps ?? 0;

  const deployment = await deployments.deploy(DETH_REDEEMER_CONTRACT_ID, {
    from: deployer,
    args: [collateralVaultAddress, dEthTokenAddress, oracleAggregatorAddress, feeReceiver, redemptionFeeBps],
    contract: "RedeemerV2",
    autoMine: true,
    log: true,
  });

  await ensureCollateralWithdrawerRole(hre, collateralVaultAddress, deployment.address, deployerSigner);

  console.log(`≻ ${__filename.split("/").slice(-2).join("/")}: ✅`);
  return true;
};

/**
 *
 * @param hre
 * @param collateralVaultAddress
 * @param redeemerAddress
 * @param signer
 */
/**
 * Grants the redeemer contract permission to withdraw collateral from the vault when required.
 *
 * @param hre Hardhat runtime environment
 * @param collateralVaultAddress Collateral vault contract address
 * @param redeemerAddress Redeemer contract address
 * @param signer Deployer signer used to grant permissions
 */
async function ensureCollateralWithdrawerRole(
  hre: HardhatRuntimeEnvironment,
  collateralVaultAddress: string,
  redeemerAddress: string,
  signer: Signer
): Promise<void> {
  const collateralVault = await hre.ethers.getContractAt("CollateralHolderVault", collateralVaultAddress, signer);
  const COLLATERAL_WITHDRAWER_ROLE = await collateralVault.COLLATERAL_WITHDRAWER_ROLE();

  if (await collateralVault.hasRole(COLLATERAL_WITHDRAWER_ROLE, redeemerAddress)) {
    console.log(`    ✓ COLLATERAL_WITHDRAWER_ROLE already granted to ${redeemerAddress}`);
    return;
  }

  await (await collateralVault.grantRole(COLLATERAL_WITHDRAWER_ROLE, redeemerAddress)).wait();
  console.log(`    ➕ Granted COLLATERAL_WITHDRAWER_ROLE to ${redeemerAddress}`);
}

func.id = DETH_REDEEMER_CONTRACT_ID;
func.tags = ["deth"];
func.dependencies = [DETH_COLLATERAL_VAULT_CONTRACT_ID, DETH_TOKEN_ID, "dETH_setup"];

export default func;
