import { HardhatRuntimeEnvironment } from "hardhat/types";
import { DeployFunction } from "hardhat-deploy/types";

import {
  DETH_COLLATERAL_VAULT_CONTRACT_ID,
  S_ORACLE_AGGREGATOR_ID,
} from "../../typescript/deploy-ids";

const func: DeployFunction = async function (hre: HardhatRuntimeEnvironment) {
  const { deployer } = await hre.getNamedAccounts();

  const { address: oracleAggregatorAddress } = await hre.deployments.get(
    S_ORACLE_AGGREGATOR_ID,
  );

  await hre.deployments.deploy(DETH_COLLATERAL_VAULT_CONTRACT_ID, {
    from: deployer,
    args: [oracleAggregatorAddress],
    contract: "CollateralHolderVault",
    autoMine: true,
    log: false,
  });

  console.log(`≻ ${__filename.split("/").slice(-2).join("/")}: ✅`);

  return true;
};

func.id = DETH_COLLATERAL_VAULT_CONTRACT_ID;
func.tags = ["deth"];
func.dependencies = ["s-oracle"];

export default func;
