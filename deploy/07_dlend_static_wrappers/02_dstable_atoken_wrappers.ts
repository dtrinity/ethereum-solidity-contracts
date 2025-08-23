import { ethers } from "hardhat";
import { HardhatRuntimeEnvironment } from "hardhat/types";
import { DeployFunction } from "hardhat-deploy/types";

import { getConfig } from "../../config/config";
import {
  DETH_A_TOKEN_WRAPPER_ID,
  DUSD_A_TOKEN_WRAPPER_ID,
  INCENTIVES_PROXY_ID,
  POOL_ADDRESSES_PROVIDER_ID,
} from "../../typescript/deploy-ids";

const func: DeployFunction = async function (hre: HardhatRuntimeEnvironment) {
  const { deployments, getNamedAccounts } = hre;
  const { deploy } = deployments;
  const { deployer } = await getNamedAccounts();

  // Get config and token addresses
  const config = await getConfig(hre);
  const { tokenAddresses } = config;

  // Get dLend contracts
  const poolAddressesProvider = await deployments.getOrNull(POOL_ADDRESSES_PROVIDER_ID);

  if (!poolAddressesProvider) {
    console.log("PoolAddressesProvider not found, skipping aToken wrapper deployment");
    return;
  }

  const poolAddressesProviderContract = await ethers.getContractAt(
    "contracts/dlend/core/interfaces/IPoolAddressesProvider.sol:IPoolAddressesProvider",
    poolAddressesProvider.address
  );

  const poolAddress = await poolAddressesProviderContract.getPool();
  const poolContract = await ethers.getContractAt("contracts/dlend/core/interfaces/IPool.sol:IPool", poolAddress);

  // Get rewards controller if available
  let rewardsControllerAddress = ethers.ZeroAddress;
  const rewardsController = await deployments.getOrNull(INCENTIVES_PROXY_ID);

  if (rewardsController) {
    rewardsControllerAddress = rewardsController.address;
  }

  // Get dUSD and dETH aToken addresses
  let dUSDAToken, dETHAToken;

  try {
    const dUSDReserveData = await poolContract.getReserveData(tokenAddresses.dUSD);
    dUSDAToken = dUSDReserveData.aTokenAddress;
  } catch (error: any) {
    console.log(`Error getting dUSD aToken: ${error.message}`);
    return;
  }

  try {
    const dETHReserveData = await poolContract.getReserveData(tokenAddresses.dETH);
    dETHAToken = dETHReserveData.aTokenAddress;
  } catch (error: any) {
    console.log(`Error getting dETH aToken: ${error.message}`);
    return;
  }

  // Deploy StaticATokenLM for dUSD
  if (dUSDAToken && dUSDAToken !== ethers.ZeroAddress) {
    const dUSDATokenContract = await ethers.getContractAt("IERC20Detailed", dUSDAToken);
    const dUSDATokenSymbol = await dUSDATokenContract.symbol();

    // console.log(`Deploying StaticATokenLM wrapper for ${dUSDATokenSymbol}...`);

    await deploy(DUSD_A_TOKEN_WRAPPER_ID, {
      from: deployer,
      contract: "StaticATokenLM",
      args: [poolAddress, rewardsControllerAddress, dUSDAToken, `Static ${dUSDATokenSymbol}`, `stk${dUSDATokenSymbol}`],
    });
  } else {
    console.log("dUSD aToken not found or invalid, skipping wrapper deployment");
  }

  // Deploy StaticATokenLM for dETH
  if (dETHAToken && dETHAToken !== ethers.ZeroAddress) {
    const dETHATokenContract = await ethers.getContractAt("IERC20Detailed", dETHAToken);
    const dETHATokenSymbol = await dETHATokenContract.symbol();

    await deploy(DETH_A_TOKEN_WRAPPER_ID, {
      from: deployer,
      contract: "StaticATokenLM",
      args: [poolAddress, rewardsControllerAddress, dETHAToken, `Static ${dETHATokenSymbol}`, `stk${dETHATokenSymbol}`],
    });
  } else {
    console.log("dETH aToken not found or invalid, skipping wrapper deployment");
  }

  console.log(`🧧 ${__filename.split("/").slice(-2).join("/")}: ✅`);

  return true;
};

func.id = "dStableATokenWrappers";
func.tags = ["dUSD-aTokenWrapper", "dETH-aTokenWrapper"];
func.dependencies = ["dlend-static-wrapper-factory"];

export default func;
