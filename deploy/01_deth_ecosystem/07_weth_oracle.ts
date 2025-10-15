import { HardhatRuntimeEnvironment } from "hardhat/types";
import { DeployFunction } from "hardhat-deploy/types";

import { getConfig } from "../../config/config";
import { ETH_ORACLE_AGGREGATOR_ID, WETH_HARD_PEG_ORACLE_WRAPPER_ID } from "../../typescript/deploy-ids";

const func: DeployFunction = async function (hre: HardhatRuntimeEnvironment) {
  const { deployer } = await hre.getNamedAccounts();

  const config = await getConfig(hre);

  // Deploy a hard peg oracle wrapper for WETH with a peg of 1
  await hre.deployments.deploy(WETH_HARD_PEG_ORACLE_WRAPPER_ID, {
    from: deployer,
    args: [
      config.oracleAggregators.ETH.baseCurrency, // Technically this is WETH, so WETH points to itself, but that's ok since we treat the counterparty risk of WETH as negligible
      BigInt(10) ** BigInt(config.oracleAggregators.ETH.priceDecimals), // 1 unit of WETH
      BigInt(10) ** BigInt(config.oracleAggregators.ETH.priceDecimals), // Hard peg of 1 ETH per WETH
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
    await hre.ethers.getSigner(deployer),
  );

  // Get HardPegOracleWrapper contract
  const { address: hardPegOracleWrapperAddress } = await hre.deployments.get(WETH_HARD_PEG_ORACLE_WRAPPER_ID);

  // Set the HardPegOracleWrapper as the oracle for WETH
  console.log(`Setting HardPegOracleWrapper for WETH (${config.tokenAddresses.WETH}) to`, hardPegOracleWrapperAddress);
  await oracleAggregatorContract.setOracle(config.tokenAddresses.WETH, hardPegOracleWrapperAddress);

  console.log(`🔮 ${__filename.split("/").slice(-2).join("/")}: ✅`);
  // Return true to indicate deployment success
  return true;
};

func.tags = ["deth", "weth-oracle"];
func.dependencies = ["eth-oracle"];
func.id = WETH_HARD_PEG_ORACLE_WRAPPER_ID;

export default func;
