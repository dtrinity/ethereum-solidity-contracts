import { HardhatRuntimeEnvironment } from "hardhat/types";
import { DeployFunction } from "hardhat-deploy/types";

import { getConfig } from "../../config/config";
import { ETH_FRXETH_FUNDAMENTAL_ORACLE_WRAPPER_ID } from "../../typescript/deploy-ids";

const func: DeployFunction = async function (hre: HardhatRuntimeEnvironment): Promise<boolean> {
  const { deployer } = await hre.getNamedAccounts();
  const config = await getConfig(hre);
  const oracleConfig = config.oracleAggregators.ETH;
  const frxConfig = (oracleConfig as any).frxEthFundamentalOracle as
    | {
        asset: string;
        etherRouter: string;
        redemptionQueue: string;
      }
    | undefined;

  if (!frxConfig || !frxConfig.asset || !frxConfig.etherRouter || !frxConfig.redemptionQueue) {
    console.log("  ⏭️  No frxETH fundamental oracle config found – skipping");
    return true;
  }

  const baseCurrencyUnit = 10n ** BigInt(oracleConfig.priceDecimals);
  const baseCurrency = oracleConfig.baseCurrency;

  await hre.deployments.deploy(ETH_FRXETH_FUNDAMENTAL_ORACLE_WRAPPER_ID, {
    from: deployer,
    contract: "FrxEthFundamentalOracleWrapperV1_1",
    args: [baseCurrency, baseCurrencyUnit, frxConfig.asset, frxConfig.etherRouter, frxConfig.redemptionQueue],
    autoMine: true,
    log: true,
  });

  console.log(`🔮 ${__filename.split("/").slice(-2).join("/")}: ✅`);
  return true;
};

func.tags = ["local-setup", "dlend", "eth-oracle", "oracle-wrappers"];
func.dependencies = [];
func.id = "deploy-frxeth-fundamental-oracle-wrapper";

export default func;
