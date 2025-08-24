import { ZeroAddress } from "ethers";
import { HardhatRuntimeEnvironment } from "hardhat/types";
import { DeployFunction } from "hardhat-deploy/types";

import {
  ATOKEN_IMPL_ID,
  POOL_ADDRESSES_PROVIDER_ID,
  STABLE_DEBT_TOKEN_IMPL_ID,
  VARIABLE_DEBT_TOKEN_IMPL_ID,
} from "../../../typescript/deploy-ids";

const func: DeployFunction = async function (hre: HardhatRuntimeEnvironment) {
  const { deployer } = await hre.getNamedAccounts();

  const { address: addressesProviderAddress } = await hre.deployments.get(POOL_ADDRESSES_PROVIDER_ID);

  const addressesProviderContract = await hre.ethers.getContractAt("PoolAddressesProvider", addressesProviderAddress);

  const poolAddress = await addressesProviderContract.getPool();
  console.log(`  - Pool address from provider: ${poolAddress}`);

  // Verify the pool address is not zero
  if (poolAddress === ZeroAddress) {
    throw new Error("Pool address is zero - ensure init_pool deployment step completed successfully");
  }

  // Deploy AToken implementation
  const aTokenDeployment = await hre.deployments.deploy(ATOKEN_IMPL_ID, {
    contract: "AToken",
    from: deployer,
    args: [poolAddress],
    log: true,
  });

  const aTokenContract = await hre.ethers.getContractAt("AToken", aTokenDeployment.address);

  // Verify the pool address again before initialization
  const poolAddressAtInit = await addressesProviderContract.getPool();
  console.log(`  - Pool address at initialization: ${poolAddressAtInit}`);
  console.log(`  - Pool addresses match: ${poolAddress === poolAddressAtInit}`);

  // Also check what the AToken thinks the pool address is
  const aTokenPoolAddress = await aTokenContract.POOL();
  console.log(`  - AToken's POOL address: ${aTokenPoolAddress}`);
  console.log(`  - AToken vs Provider match: ${aTokenPoolAddress === poolAddressAtInit}`);

  // Check if already initialized by checking the name
  let isInitialized = false;
  try {
    const tokenName = await aTokenContract.name();
    if (tokenName && tokenName !== "") {
      isInitialized = true;
      console.log(`  - AToken already initialized with name: ${tokenName}`);
    }
  } catch (e) {
    // Not initialized yet
  }

  if (!isInitialized) {
    try {
      const initATokenResponse = await aTokenContract.initialize(
        poolAddressAtInit, // initializingPool - use fresh address
        ZeroAddress, // treasury
        ZeroAddress, // underlyingAsset
        ZeroAddress, // incentivesController
        0, // aTokenDecimals
        "ATOKEN_IMPL", // aTokenName
        "ATOKEN_IMPL", // aTokenSymbol
        "0x00" // params
      );
      const initATokenReceipt = await initATokenResponse.wait();
      console.log(`  - TxHash  : ${initATokenReceipt?.hash}`);
      console.log(`  - From    : ${initATokenReceipt?.from}`);
      console.log(`  - GasUsed : ${initATokenReceipt?.gasUsed.toString()}`);
    } catch (error: any) {
      console.log(`  - Failed to initialize AToken implementation`);
      console.log(`  - Error: ${error?.message || error}`);
      throw Error(`Failed to initialize AToken implementation: ${error}`);
    }
  } else {
    console.log(`  - Skipping AToken initialization (already initialized)`);
  }

  // Deploy StableDebtToken implementation
  const stableDebtTokenDeployment = await hre.deployments.deploy(STABLE_DEBT_TOKEN_IMPL_ID, {
    contract: "StableDebtToken",
    from: deployer,
    args: [poolAddress],
    log: true,
  });

  const stableDebtTokenContract = await hre.ethers.getContractAt("StableDebtToken", stableDebtTokenDeployment.address);

  // Check if already initialized by checking the name
  let isStableDebtInitialized = false;
  try {
    const tokenName = await stableDebtTokenContract.name();
    if (tokenName && tokenName !== "") {
      isStableDebtInitialized = true;
      console.log(`  - StableDebtToken already initialized with name: ${tokenName}`);
    }
  } catch (e) {
    // Not initialized yet
  }

  if (!isStableDebtInitialized) {
    try {
      const _initStableDebtTokenResponse = await stableDebtTokenContract.initialize(
        poolAddress, // initializingPool
        ZeroAddress, // underlyingAsset
        ZeroAddress, // incentivesController
        0, // debtTokenDecimals
        "STABLE_DEBT_TOKEN_IMPL", // debtTokenName
        "STABLE_DEBT_TOKEN_IMPL", // debtTokenSymbol
        "0x00" // params
      );
      console.log(`  - StableDebtToken initialized`);
    } catch (error: any) {
      console.log(`  - Failed to initialize StableDebtToken implementation`);
      console.log(`  - Error: ${error?.message || error}`);
      throw Error(`Failed to initialize StableDebtToken implementation: ${error}`);
    }
  } else {
    console.log(`  - Skipping StableDebtToken initialization (already initialized)`);
  }

  // Deploy VariableDebtToken implementation
  const variableDebtTokenDeployment = await hre.deployments.deploy(VARIABLE_DEBT_TOKEN_IMPL_ID, {
    contract: "VariableDebtToken",
    from: deployer,
    args: [poolAddress],
    log: true,
  });

  const variableDebtTokenContract = await hre.ethers.getContractAt("VariableDebtToken", variableDebtTokenDeployment.address);

  // Check if already initialized by checking the name
  let isVariableDebtInitialized = false;
  try {
    const tokenName = await variableDebtTokenContract.name();
    if (tokenName && tokenName !== "") {
      isVariableDebtInitialized = true;
      console.log(`  - VariableDebtToken already initialized with name: ${tokenName}`);
    }
  } catch (e) {
    // Not initialized yet
  }

  if (!isVariableDebtInitialized) {
    try {
      const _initVariableDebtTokenResponse = await variableDebtTokenContract.initialize(
        poolAddress, // initializingPool
        ZeroAddress, // underlyingAsset
        ZeroAddress, // incentivesController
        0, // debtTokenDecimals
        "VARIABLE_DEBT_TOKEN_IMPL", // debtTokenName
        "VARIABLE_DEBT_TOKEN_IMPL", // debtTokenSymbol
        "0x00" // params
      );
      console.log(`  - VariableDebtToken initialized`);
    } catch (error: any) {
      console.log(`  - Failed to initialize VariableDebtToken implementation`);
      console.log(`  - Error: ${error?.message || error}`);
      throw Error(`Failed to initialize VariableDebtToken implementation: ${error}`);
    }
  } else {
    console.log(`  - Skipping VariableDebtToken initialization (already initialized)`);
  }

  console.log(`🏦 ${__filename.split("/").slice(-2).join("/")}: ✅`);

  return true;
};

func.id = "dLend:tokens_implementations";
func.tags = ["dlend", "dlend-market"];
func.dependencies = ["dlend-core", "dlend-periphery-pre", "PoolAddressesProvider", "init_pool"];

export default func;
