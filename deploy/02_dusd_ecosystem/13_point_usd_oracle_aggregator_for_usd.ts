import { ZeroAddress } from "ethers";
import { HardhatRuntimeEnvironment } from "hardhat/types";
import { DeployFunction } from "hardhat-deploy/types";

import { getConfig } from "../../config/config";
import { USD_HARD_PEG_ORACLE_WRAPPER_ID, USD_ORACLE_AGGREGATOR_ID } from "../../typescript/deploy-ids";
import { GovernanceExecutor } from "../../typescript/hardhat/governance";
import { ORACLE_AGGREGATOR_BASE_CURRENCY_UNIT } from "../../typescript/oracle_aggregator/constants";
import { assertRoleGrantedToManager } from "../_shared/safe-role";

/**
 * Type guard: returns true if the given value is a valid hex Ethereum address (0x-prefixed, 42 chars).
 *
 * @param value - String or undefined to check.
 */
function isHexAddress(value: string | undefined): value is string {
  if (!value) {
    return false;
  }

  const normalized = value.toLowerCase();
  return normalized.startsWith("0x") && normalized.length === 42;
}

const func: DeployFunction = async function (hre: HardhatRuntimeEnvironment) {
  const { deployments, ethers, getNamedAccounts } = hre;
  const { deploy } = deployments;
  const { deployer } = await getNamedAccounts();
  const signer = await ethers.getSigner(deployer);
  const config = await getConfig(hre);

  const baseCurrency = config.oracleAggregators.USD.baseCurrency ?? ZeroAddress;
  const pegValue = config.oracleAggregators.USD.hardDStablePeg ?? ORACLE_AGGREGATOR_BASE_CURRENCY_UNIT;

  if (!isHexAddress(baseCurrency)) {
    throw new Error(`USD oracle base currency is invalid: ${baseCurrency ?? "undefined"}`);
  }

  const hardPegDeployment = await deploy(USD_HARD_PEG_ORACLE_WRAPPER_ID, {
    from: deployer,
    contract: "HardPegOracleWrapperV1_1",
    args: [baseCurrency, ORACLE_AGGREGATOR_BASE_CURRENCY_UNIT, pegValue],
    log: true,
    autoMine: true,
  });

  const oracleDeployment = await deployments.get(USD_ORACLE_AGGREGATOR_ID);
  const oracleAggregator = await ethers.getContractAt("OracleAggregatorV1_1", oracleDeployment.address, signer);
  const currentOracle = await oracleAggregator.assetOracles(baseCurrency);

  if (currentOracle.toLowerCase() === hardPegDeployment.address.toLowerCase()) {
    console.log(`  ✅ USD base currency oracle already points to HardPeg wrapper ${hardPegDeployment.address}`);
    console.log(`🔮 ${__filename.split("/").slice(-2).join("/")}: ✅`);
    return true;
  }

  const executor = new GovernanceExecutor(hre, signer, config.safeConfig);
  await executor.initialize();

  if (executor.useSafe) {
    const managerAddress = config.safeConfig?.safeAddress;

    if (!managerAddress) {
      throw new Error("Safe config is required for USD base currency oracle rollout.");
    }

    const oracleManagerRole = await oracleAggregator.ORACLE_MANAGER_ROLE();
    await assertRoleGrantedToManager({
      contract: oracleAggregator,
      contractAddress: oracleDeployment.address,
      managerAddress,
      role: oracleManagerRole,
      roleLabel: "ORACLE_MANAGER_ROLE",
      contractLabel: USD_ORACLE_AGGREGATOR_ID,
    });

    const data = oracleAggregator.interface.encodeFunctionData("setOracle", [baseCurrency, hardPegDeployment.address]);
    await executor.tryOrQueue(
      async () => {
        throw new Error("Direct execution disabled: queue Safe transaction instead.");
      },
      () => ({ to: oracleDeployment.address, value: "0", data }),
    );
    await executor.flush("Configure USD base currency oracle");
  } else {
    const oracleManagerRole = await oracleAggregator.ORACLE_MANAGER_ROLE();

    if (!(await oracleAggregator.hasRole(oracleManagerRole, deployer))) {
      throw new Error(
        `Deployer lacks ORACLE_MANAGER_ROLE on USD oracle aggregator ${oracleDeployment.address}. ` +
          `Use Safe mode or grant the role before rerunning.`,
      );
    }

    const tx = await oracleAggregator.setOracle(baseCurrency, hardPegDeployment.address);
    await tx.wait();
  }

  console.log(`  ✅ Routed USD base currency ${baseCurrency} to HardPeg wrapper ${hardPegDeployment.address}`);
  console.log(`🔮 ${__filename.split("/").slice(-2).join("/")}: ✅`);
  return true;
};

func.tags = ["dusd", "usd-oracle", "oracle-hard-peg", "point-usd-oracle-aggregator-for-usd"];
func.dependencies = [USD_ORACLE_AGGREGATOR_ID];
func.id = "point-usd-oracle-aggregator-for-usd";

export default func;
