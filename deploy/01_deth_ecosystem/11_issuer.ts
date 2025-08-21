import { HardhatRuntimeEnvironment } from "hardhat/types";
import { DeployFunction } from "hardhat-deploy/types";

import { getConfig } from "../../config/config";
import {
  DETH_AMO_MANAGER_ID,
  DETH_COLLATERAL_VAULT_CONTRACT_ID,
  DETH_ISSUER_CONTRACT_ID,
  DETH_TOKEN_ID,
  S_ORACLE_AGGREGATOR_ID,
} from "../../typescript/deploy-ids";

const func: DeployFunction = async function (hre: HardhatRuntimeEnvironment) {
  const { deployer } = await hre.getNamedAccounts();

  // Get deployed addresses
  const { address: oracleAggregatorAddress } = await hre.deployments.get(
    S_ORACLE_AGGREGATOR_ID,
  );

  const { address: collateralVaultAddress } = await hre.deployments.get(
    DETH_COLLATERAL_VAULT_CONTRACT_ID,
  );
  const { tokenAddresses } = await getConfig(hre);
  const { address: amoManagerAddress } =
    await hre.deployments.get(DETH_AMO_MANAGER_ID);

  await hre.deployments.deploy(DETH_ISSUER_CONTRACT_ID, {
    from: deployer,
    args: [
      collateralVaultAddress,
      tokenAddresses.dETH,
      oracleAggregatorAddress,
      amoManagerAddress,
    ],
    contract: "IssuerV2",
    autoMine: true,
    log: false,
  });

  // Get the deployed Issuer contract address
  const { address: issuerAddress } = await hre.deployments.get(
    DETH_ISSUER_CONTRACT_ID,
  );

  // Grant MINTER_ROLE to the Issuer contract so it can mint dETH
  const dethContract = await hre.ethers.getContractAt(
    "ERC20StablecoinUpgradeable",
    tokenAddresses.dETH,
  );

  const MINTER_ROLE = await dethContract.MINTER_ROLE();

  await dethContract.grantRole(MINTER_ROLE, issuerAddress);
  console.log(`Granted MINTER_ROLE to Issuer contract at ${issuerAddress}`);

  console.log(`≻ ${__filename.split("/").slice(-2).join("/")}: ✅`);

  return true;
};

func.id = DETH_ISSUER_CONTRACT_ID;
func.tags = ["deth"];
func.dependencies = [
  DETH_COLLATERAL_VAULT_CONTRACT_ID,
  DETH_TOKEN_ID,
  "s-oracle",
  DETH_AMO_MANAGER_ID,
];

export default func;
