import { HardhatRuntimeEnvironment } from "hardhat/types";
import { DeployFunction } from "hardhat-deploy/types";

import { getConfig } from "../../config/config";
import { DETH_HARD_PEG_ORACLE_WRAPPER_ID, ETH_ORACLE_AGGREGATOR_ID } from "../../typescript/deploy-ids";

const func: DeployFunction = async function (hre: HardhatRuntimeEnvironment) {
  const { deployer } = await hre.getNamedAccounts();

  const config = await getConfig(hre);

  await hre.deployments.deploy(DETH_HARD_PEG_ORACLE_WRAPPER_ID, {
    from: deployer,
    args: [
      config.oracleAggregators.ETH.baseCurrency,
      BigInt(10) ** BigInt(config.oracleAggregators.ETH.priceDecimals),
      config.oracleAggregators.ETH.hardDStablePeg,
    ],
    contract: "HardPegOracleWrapper",
    autoMine: true,
    log: false,
  });

  // Get OracleAggregator contract
  const { address: oracleAggregatorAddress } = await hre.deployments.get(ETH_ORACLE_AGGREGATOR_ID);
  const oracleAggregatorContract = await hre.ethers.getContractAt(
    "OracleAggregator",
    oracleAggregatorAddress,
    await hre.ethers.getSigner(deployer)
  );

  // Get HardPegOracleWrapper contract
  const { address: hardPegOracleWrapperAddress } = await hre.deployments.get(DETH_HARD_PEG_ORACLE_WRAPPER_ID);

  // Set the HardPegOracleWrapper as the oracle for dETH
  console.log(`Setting HardPegOracleWrapper for dETH (${config.tokenAddresses.dETH}) to`, hardPegOracleWrapperAddress);
  await oracleAggregatorContract.setOracle(config.tokenAddresses.dETH, hardPegOracleWrapperAddress);

  console.log(`🔮 ${__filename.split("/").slice(-2).join("/")}: ✅`);
  // Return true to indicate deployment success
  return true;
};

func.tags = ["deth"];
func.dependencies = ["eth-oracle"];
func.id = DETH_HARD_PEG_ORACLE_WRAPPER_ID;

export default func;
