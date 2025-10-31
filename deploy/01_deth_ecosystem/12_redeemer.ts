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
  const { deployments } = hre;
  const { deployer } = await hre.getNamedAccounts();
  const deployerSigner = await hre.ethers.getSigner(deployer);

  const { tokenAddresses, dStables } = await getConfig(hre);
  const { address: oracleAggregatorAddress } = await deployments.get(ETH_ORACLE_AGGREGATOR_ID);
  const { address: collateralVaultAddress } = await deployments.get(DETH_COLLATERAL_VAULT_CONTRACT_ID);

  const collateralVault = await hre.ethers.getContractAt("CollateralHolderVault", collateralVaultAddress, deployerSigner);

  const deployment = await deployments.deploy(DETH_REDEEMER_CONTRACT_ID, {
    from: deployer,
    args: [
      collateralVaultAddress,
      tokenAddresses.dETH,
      oracleAggregatorAddress,
      dStables.dETH.initialFeeReceiver,
      dStables.dETH.initialRedemptionFeeBps,
    ],
    contract: "RedeemerV2",
    autoMine: true,
    log: true,
  });

  console.log("Allowing Redeemer to withdraw collateral");
  const COLLATERAL_WITHDRAWER_ROLE = await collateralVault.COLLATERAL_WITHDRAWER_ROLE();

  if (await collateralVault.hasRole(COLLATERAL_WITHDRAWER_ROLE, deployment.address)) {
    console.log(`    ✓ COLLATERAL_WITHDRAWER_ROLE already granted to ${deployment.address}`);
  } else {
    const tx = await collateralVault.grantRole(COLLATERAL_WITHDRAWER_ROLE, deployment.address);
    await tx.wait();
    console.log(`    ➕ Granted COLLATERAL_WITHDRAWER_ROLE to ${deployment.address}`);
  }

  console.log(`≻ ${__filename.split("/").slice(-2).join("/")}: ✅`);

  return true;
};

func.id = DETH_REDEEMER_CONTRACT_ID;
func.tags = ["deth"];
func.dependencies = [DETH_COLLATERAL_VAULT_CONTRACT_ID, DETH_TOKEN_ID, "dETH_setup"];

export default func;
