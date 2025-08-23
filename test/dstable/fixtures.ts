import hre, { deployments } from "hardhat";

import {
  DETH_AMO_MANAGER_ID,
  DETH_COLLATERAL_VAULT_CONTRACT_ID,
  DETH_ISSUER_V2_CONTRACT_ID,
  DETH_REDEEMER_CONTRACT_ID,
  DUSD_AMO_MANAGER_ID,
  DUSD_COLLATERAL_VAULT_CONTRACT_ID,
  DUSD_ISSUER_V2_CONTRACT_ID,
  DUSD_REDEEMER_CONTRACT_ID,
  ETH_ORACLE_AGGREGATOR_ID,
  USD_ORACLE_AGGREGATOR_ID,
} from "../../typescript/deploy-ids";
import { getTokenContractForSymbol } from "../../typescript/token/utils";

export interface DStableFixtureConfig {
  symbol: "dUSD" | "dETH";
  issuerContractId: string;
  redeemerContractId: string;
  collateralVaultContractId: string;
  amoManagerId: string;
  oracleAggregatorId: string;
  peggedCollaterals: string[];
  yieldBearingCollaterals: string[];
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
export const createDStableAmoFixture = (config: DStableFixtureConfig) => {
  return deployments.createFixture(async ({ deployments }) => {
    const standaloneMinimalFixture = createDStableFixture(config);
    await standaloneMinimalFixture(deployments);

    const { deployer } = await hre.getNamedAccounts();
    const { address: amoManagerAddress } = await deployments.get(
      config.amoManagerId
    );

    const { tokenInfo: dstableInfo } = await getTokenContractForSymbol(
      hre,
      deployer,
      config.symbol
    );

    const { address: oracleAggregatorAddress } = await deployments.get(
      config.oracleAggregatorId
    );

    // Deploy MockAmoVault using standard deployment
    await hre.deployments.deploy("MockAmoVault", {
      from: deployer,
      args: [
        dstableInfo.address,
        amoManagerAddress,
        deployer,
        deployer,
        deployer,
        oracleAggregatorAddress,
      ],
      autoMine: true,
      log: false,
    });
  });
};

// Predefined configurations
export const DUSD_CONFIG: DStableFixtureConfig = {
  symbol: "dUSD",
  issuerContractId: DUSD_ISSUER_V2_CONTRACT_ID,
  redeemerContractId: DUSD_REDEEMER_CONTRACT_ID,
  collateralVaultContractId: DUSD_COLLATERAL_VAULT_CONTRACT_ID,
  amoManagerId: DUSD_AMO_MANAGER_ID,
  oracleAggregatorId: USD_ORACLE_AGGREGATOR_ID,
  peggedCollaterals: ["frxUSD", "USDC", "USDS"], // USDC is interesting due to 6 decimals
  yieldBearingCollaterals: ["sfrxUSD", "sUSDS"],
};

export const DETH_CONFIG: DStableFixtureConfig = {
  symbol: "dETH",
  issuerContractId: DETH_ISSUER_V2_CONTRACT_ID,
  redeemerContractId: DETH_REDEEMER_CONTRACT_ID,
  collateralVaultContractId: DETH_COLLATERAL_VAULT_CONTRACT_ID,
  amoManagerId: DETH_AMO_MANAGER_ID,
  oracleAggregatorId: ETH_ORACLE_AGGREGATOR_ID,
  peggedCollaterals: ["WETH"],
  yieldBearingCollaterals: ["stETH"],
};
