import { isAddress } from "ethers";
import { HardhatRuntimeEnvironment } from "hardhat/types";
import { DeployFunction } from "hardhat-deploy/types";

import { getConfig } from "../../config/config";
import { configureAmoV2ForAsset } from "../../typescript/deploy-helpers/dstable-amo-v2";
import {
  DETH_AMO_DEBT_TOKEN_ID,
  DETH_AMO_MANAGER_V2_ID,
  DETH_COLLATERAL_VAULT_CONTRACT_ID,
  DETH_HARD_PEG_ORACLE_WRAPPER_ID,
  DETH_TOKEN_ID,
  ETH_ORACLE_AGGREGATOR_ID,
} from "../../typescript/deploy-ids";

const func: DeployFunction = async function (hre: HardhatRuntimeEnvironment) {
  const config = await getConfig(hre);
  const governanceMultisig = config.walletAddresses.governanceMultisig;

  if (!governanceMultisig || !isAddress(governanceMultisig)) {
    console.log("⚠️  Skipping dETH AMO V2 configure - governance multisig not configured");
    console.log(`☯️  ${__filename.split("/").slice(-2).join("/")}: ⏭️  (skipped)`);
    return true;
  }

  const { manualActions } = await configureAmoV2ForAsset(hre, {
    label: "dETH",
    tokenId: DETH_TOKEN_ID,
    oracleAggregatorId: ETH_ORACLE_AGGREGATOR_ID,
    collateralVaultId: DETH_COLLATERAL_VAULT_CONTRACT_ID,
    hardPegOracleWrapperId: DETH_HARD_PEG_ORACLE_WRAPPER_ID,
    amoDebtTokenId: DETH_AMO_DEBT_TOKEN_ID,
    amoManagerV2Id: DETH_AMO_MANAGER_V2_ID,
    governanceMultisig,
  });

  if (manualActions.length > 0) {
    console.log("\n⚠️  Manual actions required to finalize dETH AMO V2 configuration:");
    manualActions.forEach((a) => console.log(`   - ${a}`));
  }

  console.log(`☯️  ${__filename.split("/").slice(-2).join("/")}: ✅`);
  return true;
};

func.id = "configure_amo_v2_deth";
func.tags = ["deth", "amo-v2"];
func.dependencies = ["deploy_amo_v2_deth", DETH_HARD_PEG_ORACLE_WRAPPER_ID];

export default func;
