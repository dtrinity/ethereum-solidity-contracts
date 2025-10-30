import { ZeroAddress } from "ethers";
import { HardhatRuntimeEnvironment } from "hardhat/types";
import { DeployFunction } from "hardhat-deploy/types";

import { getConfig } from "../../config/config";
import { ETH_ORACLE_AGGREGATOR_ID, USD_ORACLE_AGGREGATOR_ID, WETH_HARD_PEG_ORACLE_WRAPPER_ID } from "../../typescript/deploy-ids";
import { ORACLE_AGGREGATOR_BASE_CURRENCY_UNIT } from "../../typescript/oracle_aggregator/constants";

const func: DeployFunction = async function (hre: HardhatRuntimeEnvironment): Promise<boolean> {
  const { deployments, ethers, getNamedAccounts } = hre;
  const { deployer } = await getNamedAccounts();
  const signer = await ethers.getSigner(deployer);

  const config = await getConfig(hre);
  const wethAddress = config.tokenAddresses.WETH;
  const ethBaseCurrency = config.oracleAggregators.ETH.baseCurrency;

  if (!isUsableAddress(wethAddress)) {
    throw new Error(`WETH address missing from configuration: ${wethAddress ?? "undefined"}`);
  }

  if (!isUsableAddress(ethBaseCurrency)) {
    throw new Error(`ETH oracle base currency is invalid: ${ethBaseCurrency ?? "undefined"}`);
  }

  const usdOracleDeployment = await deployments.getOrNull(USD_ORACLE_AGGREGATOR_ID);

  if (!usdOracleDeployment) {
    console.log(`🔁 ${__filename.split("/").slice(-2).join("/")}: ⏭️  (skipping – USD oracle aggregator not deployed in current fixture)`);
    return true;
  }

  const hardPegDeployment = await deployments.deploy(WETH_HARD_PEG_ORACLE_WRAPPER_ID, {
    from: deployer,
    contract: "HardPegOracleWrapperV1_1",
    args: [ethBaseCurrency, ORACLE_AGGREGATOR_BASE_CURRENCY_UNIT, ORACLE_AGGREGATOR_BASE_CURRENCY_UNIT],
    log: true,
    autoMine: true,
  });

  const ethOracleDeployment = await deployments.get(ETH_ORACLE_AGGREGATOR_ID);
  const ethOracle = await ethers.getContractAt("OracleAggregatorV1_1", ethOracleDeployment.address, signer);
  const oracleManagerRole = await ethOracle.ORACLE_MANAGER_ROLE();

  if (!(await ethOracle.hasRole(oracleManagerRole, deployer))) {
    throw new Error(`Deployer lacks ORACLE_MANAGER_ROLE on ETH oracle aggregator ${ethOracleDeployment.address}`);
  }

  const currentOracle = await ethOracle.assetOracles(wethAddress);

  if (currentOracle.toLowerCase() !== hardPegDeployment.address.toLowerCase()) {
    const tx = await ethOracle.setOracle(wethAddress, hardPegDeployment.address);
    await tx.wait();
    console.log(`  ✅ Routed WETH oracle to HardPeg wrapper ${hardPegDeployment.address}`);
  } else {
    console.log(`  ✅ WETH oracle already points to HardPeg wrapper ${hardPegDeployment.address}`);
  }

  const usdOracle = await ethers.getContractAt("OracleAggregatorV1_1", usdOracleDeployment.address, signer);
  const usdOracleAddress = await usdOracle.assetOracles(wethAddress);
  if (usdOracleAddress === ZeroAddress) {
    throw new Error(
      `WETH is not configured on the USD oracle aggregator ${usdOracleDeployment.address}. Ensure the wrapper setup scripts ran successfully.`,
    );
  }

  console.log(`🔁 ${__filename.split("/").slice(-2).join("/")}: ✅`);
  return true;
};

/**
 *
 * @param value
 */
/**
 * Determines whether the provided value is a usable non-zero Ethereum address.
 *
 * @param value Value under test
 * @returns True when the value resembles a non-zero address, false otherwise
 */
function isUsableAddress(value: string | undefined): value is string {
  if (!value) {
    return false;
  }
  const normalized = value.toLowerCase();
  return normalized.startsWith("0x") && normalized.length === 42 && normalized !== ZeroAddress.toLowerCase();
}

func.tags = ["deth", "weth-oracle"];
func.dependencies = [
  USD_ORACLE_AGGREGATOR_ID,
  ETH_ORACLE_AGGREGATOR_ID,
  "setup-eth-oracle-wrappers-v1_1",
  "point-eth-aggregator-to-wrappers-v1_1",
];
func.id = WETH_HARD_PEG_ORACLE_WRAPPER_ID;

export default func;
