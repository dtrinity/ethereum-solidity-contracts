import { HardhatRuntimeEnvironment } from "hardhat/types";
import { DeployFunction } from "hardhat-deploy/types";

import { getConfig } from "../../config/config";
import { deployRedeemerV2ForAsset } from "../../typescript/deploy-helpers/dstable-redeemer-v2";
import {
  DETH_COLLATERAL_VAULT_CONTRACT_ID,
  DETH_REDEEMER_V2_CONTRACT_ID,
  DETH_TOKEN_ID,
  ETH_ORACLE_AGGREGATOR_ID,
} from "../../typescript/deploy-ids";

const func: DeployFunction = async function (hre: HardhatRuntimeEnvironment) {
  const config = await getConfig(hre);
  const dETHConfig = config.dStables.dETH;

  const { skipped, manualActions } = await deployRedeemerV2ForAsset(hre, {
    label: "dETH",
    redeemerV2Id: DETH_REDEEMER_V2_CONTRACT_ID,
    collateralVaultId: DETH_COLLATERAL_VAULT_CONTRACT_ID,
    tokenId: DETH_TOKEN_ID,
    oracleAggregatorId: ETH_ORACLE_AGGREGATOR_ID,
    initialFeeReceiver: dETHConfig?.initialFeeReceiver,
    initialRedemptionFeeBps: dETHConfig?.initialRedemptionFeeBps,
  });

  if (skipped) {
    return false;
  }

  if (manualActions.length > 0) {
    console.log("\n⚠️  Manual actions required to finalize dETH RedeemerV2:");
    manualActions.forEach((a) => console.log(`   - ${a}`));
  }

  console.log(`☯️  ${__filename.split("/").slice(-2).join("/")}: ✅`);
  return true;
};

func.id = "deploy_redeemer_v2_deth";
func.tags = ["deth", "redeemerV2"];
func.dependencies = [DETH_TOKEN_ID, DETH_COLLATERAL_VAULT_CONTRACT_ID, ETH_ORACLE_AGGREGATOR_ID];

export default func;
