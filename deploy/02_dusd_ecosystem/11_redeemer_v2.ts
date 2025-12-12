import { HardhatRuntimeEnvironment } from "hardhat/types";
import { DeployFunction } from "hardhat-deploy/types";

import { getConfig } from "../../config/config";
import { deployRedeemerV2ForAsset } from "../../typescript/deploy-helpers/dstable-redeemer-v2";
import {
  DUSD_COLLATERAL_VAULT_CONTRACT_ID,
  DUSD_REDEEMER_V2_CONTRACT_ID,
  DUSD_TOKEN_ID,
  USD_ORACLE_AGGREGATOR_ID,
} from "../../typescript/deploy-ids";

const func: DeployFunction = async function (hre: HardhatRuntimeEnvironment) {
  const config = await getConfig(hre);
  const dUSDConfig = config.dStables.dUSD;

  const { manualActions } = await deployRedeemerV2ForAsset(hre, {
    label: "dUSD",
    redeemerV2Id: DUSD_REDEEMER_V2_CONTRACT_ID,
    collateralVaultId: DUSD_COLLATERAL_VAULT_CONTRACT_ID,
    tokenId: DUSD_TOKEN_ID,
    oracleAggregatorId: USD_ORACLE_AGGREGATOR_ID,
    initialFeeReceiver: dUSDConfig?.initialFeeReceiver,
    initialRedemptionFeeBps: dUSDConfig?.initialRedemptionFeeBps,
  });

  if (manualActions.length > 0) {
    console.log("\n⚠️  Manual actions required to finalize dUSD RedeemerV2:");
    manualActions.forEach((a) => console.log(`   - ${a}`));
  }

  console.log(`☯️  ${__filename.split("/").slice(-2).join("/")}: ✅`);
  return true;
};

func.id = "deploy_redeemer_v2_dusd";
func.tags = ["dusd", "redeemerV2"];
func.dependencies = [DUSD_TOKEN_ID, DUSD_COLLATERAL_VAULT_CONTRACT_ID, "deploy-usd-oracle-aggregator"];

export default func;
