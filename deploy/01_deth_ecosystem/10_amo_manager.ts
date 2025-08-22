import { HardhatRuntimeEnvironment } from "hardhat/types";
import { DeployFunction } from "hardhat-deploy/types";

import { getConfig } from "../../config/config";
import {
  DETH_AMO_MANAGER_ID,
  DETH_COLLATERAL_VAULT_CONTRACT_ID,
  DETH_TOKEN_ID,
  ETH_ORACLE_AGGREGATOR_ID,
} from "../../typescript/deploy-ids";

const func: DeployFunction = async function (hre: HardhatRuntimeEnvironment) {
  const { deployer } = await hre.getNamedAccounts();
  const { tokenAddresses } = await getConfig(hre);

  const { address: collateralVaultAddress } = await hre.deployments.get(DETH_COLLATERAL_VAULT_CONTRACT_ID);

  const { address: oracleAddress } = await hre.deployments.get(ETH_ORACLE_AGGREGATOR_ID);

  await hre.deployments.deploy(DETH_AMO_MANAGER_ID, {
    from: deployer,
    args: [tokenAddresses.dETH, collateralVaultAddress, oracleAddress],
    contract: "AmoManager",
    autoMine: true,
    log: false,
  });

  console.log(`≻ ${__filename.split("/").slice(-2).join("/")}: ✅`);

  return true;
};

func.id = DETH_AMO_MANAGER_ID;
func.tags = ["deth"];
func.dependencies = [DETH_TOKEN_ID, DETH_COLLATERAL_VAULT_CONTRACT_ID, ETH_ORACLE_AGGREGATOR_ID];

export default func;
