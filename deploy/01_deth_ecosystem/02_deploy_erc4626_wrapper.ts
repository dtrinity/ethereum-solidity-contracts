import { HardhatRuntimeEnvironment } from "hardhat/types";
import { DeployFunction } from "hardhat-deploy/types";

import { getConfig } from "../../config/config";
import { DETH_TOKEN_ID, ETH_ERC4626_ORACLE_WRAPPER_ID } from "../../typescript/deploy-ids";

const func: DeployFunction = async function (hre: HardhatRuntimeEnvironment): Promise<boolean> {
  const { deployer } = await hre.getNamedAccounts();
  const config = await getConfig(hre);
  const oracleConfig = config.oracleAggregators.ETH;
  const assets = oracleConfig.erc4626OracleAssets;

  if (!assets || Object.keys(assets).length === 0) {
    console.log("  ⏭️  No ETH ERC4626 oracle assets configured – skipping");
    return true;
  }

  const baseCurrencyUnit = 10n ** BigInt(oracleConfig.priceDecimals);
  const baseCurrency = oracleConfig.baseCurrency;

  const deployment = await hre.deployments.deploy(ETH_ERC4626_ORACLE_WRAPPER_ID, {
    from: deployer,
    args: [baseCurrency, baseCurrencyUnit],
    contract: "ERC4626OracleWrapperV1_1",
    autoMine: true,
    log: true,
  });

  const wrapper = await hre.ethers.getContractAt("ERC4626OracleWrapperV1_1", deployment.address);

  for (const [asset, vault] of Object.entries(assets)) {
    await (await wrapper.setVault(asset, vault)).wait();
    console.log(`   ✅ Wired ERC4626 vault ${vault} for asset ${asset}`);
  }

  console.log(`🔮 ${__filename.split("/").slice(-2).join("/")}: ✅`);
  return true;
};

func.tags = ["local-setup", "dlend", "eth-oracle", "oracle-wrappers"];
func.dependencies = [DETH_TOKEN_ID];
func.id = "deploy-eth-erc4626-wrapper";

export default func;
