import { ZeroAddress } from "ethers";
import { HardhatRuntimeEnvironment } from "hardhat/types";
import { DeployFunction } from "hardhat-deploy/types";

import { getConfig } from "../../config/config";
import { DETH_HARD_PEG_ORACLE_WRAPPER_ID, DETH_TOKEN_ID, ETH_ORACLE_AGGREGATOR_ID } from "../../typescript/deploy-ids";
import { ORACLE_AGGREGATOR_BASE_CURRENCY_UNIT } from "../../typescript/oracle_aggregator/constants";

const func: DeployFunction = async function (hre: HardhatRuntimeEnvironment): Promise<boolean> {
  const { deployments, ethers, getNamedAccounts } = hre;
  const { deploy } = deployments;
  const { deployer } = await getNamedAccounts();
  const signer = await ethers.getSigner(deployer);

  const config = await getConfig(hre);
  const dethAddress = config.tokenAddresses.dETH;
  const baseCurrency = config.oracleAggregators.ETH.baseCurrency;
  const pegValue = config.oracleAggregators.ETH.hardDStablePeg ?? ORACLE_AGGREGATOR_BASE_CURRENCY_UNIT;

  if (!isUsableAddress(dethAddress)) {
    console.log(
      `🔁 ${__filename.split("/").slice(-2).join("/")}: skipping – dETH address unavailable in configuration (${dethAddress ?? "undefined"})`,
    );
    return true;
  }

  if (!isUsableAddress(baseCurrency)) {
    console.log(`  ⚠️  ETH oracle base currency is unset – expected WETH-style address, received ${baseCurrency ?? "undefined"}.`);
    return true;
  }

  const hardPegDeployment = await deploy(DETH_HARD_PEG_ORACLE_WRAPPER_ID, {
    from: deployer,
    contract: "HardPegOracleWrapperV1_1",
    args: [baseCurrency, ORACLE_AGGREGATOR_BASE_CURRENCY_UNIT, pegValue],
    log: true,
    autoMine: true,
  });

  const oracleDeployment = await deployments.get(ETH_ORACLE_AGGREGATOR_ID);
  const oracleAggregator = await ethers.getContractAt("OracleAggregatorV1_1", oracleDeployment.address, signer);

  const oracleManagerRole = await oracleAggregator.ORACLE_MANAGER_ROLE();
  const deployerHasRole = await oracleAggregator.hasRole(oracleManagerRole, deployer);

  if (!deployerHasRole) {
    console.log(
      `  ⚠️  Deployer lacks ORACLE_MANAGER_ROLE on ETH oracle aggregator. ` +
        `Grant the role or configure ${dethAddress} manually on ${hardPegDeployment.address}.`,
    );
    return true;
  }

  const currentOracle = await oracleAggregator.assetOracles(dethAddress);

  if (currentOracle.toLowerCase() !== hardPegDeployment.address.toLowerCase()) {
    const tx = await oracleAggregator.setOracle(dethAddress, hardPegDeployment.address);
    await tx.wait();
    console.log(`  ✅ Routed dETH oracle to HardPeg wrapper ${hardPegDeployment.address}`);
  } else {
    console.log(`  ✅ dETH oracle already points to HardPeg wrapper ${hardPegDeployment.address}`);
  }

  console.log(`🔁 ${__filename.split("/").slice(-2).join("/")}: ✅`);
  return true;
};

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

func.tags = ["deth", "oracle-hard-peg"];
func.dependencies = [ETH_ORACLE_AGGREGATOR_ID, "setup-eth-oracle-wrappers-v1_1", "point-eth-aggregator-to-wrappers-v1_1", DETH_TOKEN_ID];
func.id = DETH_HARD_PEG_ORACLE_WRAPPER_ID;

export default func;
