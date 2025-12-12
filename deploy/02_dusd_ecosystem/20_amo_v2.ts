import { HardhatRuntimeEnvironment } from "hardhat/types";
import { DeployFunction } from "hardhat-deploy/types";

import { deployAmoV2ForAsset } from "../../typescript/deploy-helpers/dstable-amo-v2";
import {
  DUSD_AMO_DEBT_TOKEN_ID,
  DUSD_AMO_MANAGER_V2_ID,
  DUSD_COLLATERAL_VAULT_CONTRACT_ID,
  DUSD_HARD_PEG_ORACLE_WRAPPER_ID,
  DUSD_TOKEN_ID,
  USD_ORACLE_AGGREGATOR_ID,
} from "../../typescript/deploy-ids";

const func: DeployFunction = async function (hre: HardhatRuntimeEnvironment) {
  const { manualActions } = await deployAmoV2ForAsset(hre, {
    label: "dUSD",
    tokenId: DUSD_TOKEN_ID,
    oracleAggregatorId: USD_ORACLE_AGGREGATOR_ID,
    collateralVaultId: DUSD_COLLATERAL_VAULT_CONTRACT_ID,
    hardPegOracleWrapperId: DUSD_HARD_PEG_ORACLE_WRAPPER_ID,
    amoDebtTokenId: DUSD_AMO_DEBT_TOKEN_ID,
    amoManagerV2Id: DUSD_AMO_MANAGER_V2_ID,
  });

  if (manualActions.length > 0) {
    console.log("\n⚠️  Manual actions required to finalize dUSD AMO V2 deploy:");
    manualActions.forEach((a) => console.log(`   - ${a}`));
  }

  console.log(`☯️  ${__filename.split("/").slice(-2).join("/")}: ✅`);
  return true;
};

func.id = "deploy_amo_v2_dusd";
func.tags = ["dusd", "amo-v2"];
func.dependencies = [DUSD_TOKEN_ID, DUSD_COLLATERAL_VAULT_CONTRACT_ID, "deploy-usd-oracle-aggregator", DUSD_HARD_PEG_ORACLE_WRAPPER_ID];

export default func;
