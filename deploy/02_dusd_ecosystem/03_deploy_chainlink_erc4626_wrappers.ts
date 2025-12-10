import { HardhatRuntimeEnvironment } from "hardhat/types";
import { DeployFunction } from "hardhat-deploy/types";

import { getConfig } from "../../config/config";
import { USD_CHAINLINK_ERC4626_WRAPPER_ID } from "../../typescript/deploy-ids";

const func: DeployFunction = async function (hre: HardhatRuntimeEnvironment): Promise<boolean> {
  const { deployer } = await hre.getNamedAccounts();
  const config = await getConfig(hre);
  const oracleConfig = config.oracleAggregators.USD;
  const assets = oracleConfig.chainlinkErc4626OracleAssets;

  if (!assets || Object.keys(assets).length === 0) {
    console.log("  ⏭️  No Chainlink ERC4626 oracle assets configured – skipping");
    return true;
  }

  const baseCurrencyUnit = 10n ** BigInt(oracleConfig.priceDecimals);
  const baseCurrency = oracleConfig.baseCurrency;

  const deployment = await hre.deployments.deploy(USD_CHAINLINK_ERC4626_WRAPPER_ID, {
    from: deployer,
    args: [baseCurrency, baseCurrencyUnit],
    contract: "ChainlinkERC4626WrapperV1_1",
    autoMine: true,
    log: true,
  });

  const wrapper = await hre.ethers.getContractAt("ChainlinkERC4626WrapperV1_1", deployment.address);

  for (const [asset, cfg] of Object.entries(assets)) {
    await (await wrapper.setERC4626Feed(asset, cfg.vault, cfg.feed)).wait();
    console.log(`   ✅ Wired Chainlink ERC4626 feed ${cfg.feed} for asset ${asset} (vault ${cfg.vault})`);
  }

  console.log(`🔮 ${__filename.split("/").slice(-2).join("/")}: ✅`);
  return true;
};

func.tags = ["local-setup", "dlend", "usd-oracle", "oracle-wrappers"];
func.dependencies = ["local_oracle_setup", "local_token_setup"];

export default func;
