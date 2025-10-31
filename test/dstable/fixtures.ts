import hre, { deployments } from "hardhat";

import {
  DETH_AMO_DEBT_TOKEN_ID,
  DETH_AMO_MANAGER_V2_ID,
  DETH_COLLATERAL_VAULT_CONTRACT_ID,
  DETH_ISSUER_V2_CONTRACT_ID,
  DETH_REDEEMER_CONTRACT_ID,
  DUSD_AMO_DEBT_TOKEN_ID,
  DUSD_AMO_MANAGER_V2_ID,
  DUSD_COLLATERAL_VAULT_CONTRACT_ID,
  DUSD_ISSUER_V2_CONTRACT_ID,
  DUSD_REDEEMER_CONTRACT_ID,
  ETH_ORACLE_AGGREGATOR_ID,
  USD_ORACLE_AGGREGATOR_ID,
} from "../../typescript/deploy-ids";
import { getTokenContractForSymbol } from "../../typescript/token/utils";
import { getConfig } from "../../config/config";

export interface DStableFixtureConfig {
  symbol: "dUSD" | "dETH";
  issuerContractId: string;
  redeemerContractId: string;
  collateralVaultContractId: string;
  oracleAggregatorId: string;
  peggedCollaterals: string[];
  yieldBearingCollaterals: string[];
  amoManagerV2Id?: string;
  amoDebtTokenId?: string;
}

// Create a fixture factory for any dstable based on its configuration
export const createDStableFixture = (config: DStableFixtureConfig) => {
  return deployments.createFixture(async ({ deployments }) => {
    await deployments.fixture(); // Start from a fresh deployment
    await deployments.fixture(["local-setup", config.symbol.toLowerCase()]); // Include local-setup to use the mock Oracle
    // IssuerV2 and RedeemerV2 are now deployed as part of the standard ecosystem tags
  });
};

// Create an AMO fixture factory for any dstable based on its configuration
// Create an AMO V2 fixture factory that provisions the debt AMO stack in addition to base setup
export const createDStableAmoV2Fixture = (config: DStableFixtureConfig) => {
  return deployments.createFixture(async ({ deployments }) => {
    const baseFixture = createDStableFixture(config);
    await baseFixture(deployments);

    if (!config.amoManagerV2Id || !config.amoDebtTokenId) {
      throw new Error(`AMO V2 configuration missing for ${config.symbol}`);
    }

    await deployments.fixture(["amo-v2"]);
  });
};

// Predefined configurations
export const DUSD_CONFIG: DStableFixtureConfig = {
  symbol: "dUSD",
  issuerContractId: DUSD_ISSUER_V2_CONTRACT_ID,
  redeemerContractId: DUSD_REDEEMER_CONTRACT_ID,
  collateralVaultContractId: DUSD_COLLATERAL_VAULT_CONTRACT_ID,
  amoManagerV2Id: DUSD_AMO_MANAGER_V2_ID,
  amoDebtTokenId: DUSD_AMO_DEBT_TOKEN_ID,
  oracleAggregatorId: USD_ORACLE_AGGREGATOR_ID,
  peggedCollaterals: ["frxUSD", "USDC", "USDT"], // Include a 6-decimal asset for coverage
  yieldBearingCollaterals: ["sfrxUSD", "yUSD"],
};

export const DETH_CONFIG: DStableFixtureConfig = {
  symbol: "dETH",
  issuerContractId: DETH_ISSUER_V2_CONTRACT_ID,
  redeemerContractId: DETH_REDEEMER_CONTRACT_ID,
  collateralVaultContractId: DETH_COLLATERAL_VAULT_CONTRACT_ID,
  amoManagerV2Id: DETH_AMO_MANAGER_V2_ID,
  amoDebtTokenId: DETH_AMO_DEBT_TOKEN_ID,
  oracleAggregatorId: ETH_ORACLE_AGGREGATOR_ID,
  peggedCollaterals: ["WETH"],
  yieldBearingCollaterals: ["stETH"],
};
