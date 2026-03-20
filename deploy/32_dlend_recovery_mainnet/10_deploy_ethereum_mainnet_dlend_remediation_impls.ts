import { HardhatRuntimeEnvironment } from "hardhat/types";
import { DeployFunction } from "hardhat-deploy/types";

import { BORROW_LOGIC_ID, POOL_ADDRESSES_PROVIDER_ID, POOL_IMPL_ID } from "../../typescript/deploy-ids";
import { REMEDIATION_FLASH_LOAN_LOGIC_ID, REMEDIATION_POOL_IMPL_ID, SANITIZABLE_ATOKEN_IMPL_ID } from "../../typescript/dlend/recovery_remediation_ids";
import { isLocalNetwork } from "../../typescript/hardhat/deploy";

/* Deploy patched FlashLoanLogic, L2Pool implementation (linked to the new library),
 * and SanitizableAToken implementation for the cbBTC reserve wind-down.
 * Run from the deployer EOA before generating the cbBTC sanitize Safe batch. */
const func: DeployFunction = async function (hre: HardhatRuntimeEnvironment): Promise<boolean> {
  if (isLocalNetwork(hre.network.name)) {
    console.log("🔁 ethereum-mainnet-dlend-remediation-impls: local network detected - skipping");
    return true;
  }

  const { deployments, ethers } = hre;
  const { deployer } = await hre.getNamedAccounts();
  const { address: addressesProviderAddress } = await deployments.get(POOL_ADDRESSES_PROVIDER_ID);
  const existingPoolImpl = await deployments.get(POOL_IMPL_ID);

  if (!existingPoolImpl.libraries) {
    throw new Error(`Deployment ${POOL_IMPL_ID} is missing linked libraries; cannot rebuild Pool implementation.`);
  }

  const borrowLogicDeployment = await deployments.get(BORROW_LOGIC_ID);

  const flashLoanRemediation = await deployments.deploy(REMEDIATION_FLASH_LOAN_LOGIC_ID, {
    from: deployer,
    contract: "FlashLoanLogic",
    args: [],
    libraries: {
      BorrowLogic: borrowLogicDeployment.address,
    },
    autoMine: true,
    log: true,
    skipIfAlreadyDeployed: true,
  });

  const poolLibraries = {
    ...existingPoolImpl.libraries,
    FlashLoanLogic: flashLoanRemediation.address,
  };

  const poolRemediation = await deployments.deploy(REMEDIATION_POOL_IMPL_ID, {
    from: deployer,
    contract: "L2Pool",
    args: [addressesProviderAddress],
    libraries: poolLibraries,
    autoMine: true,
    log: true,
    skipIfAlreadyDeployed: true,
  });

  const poolRemediationContract = await ethers.getContractAt("L2Pool", poolRemediation.address);

  if (poolRemediation.newlyDeployed) {
    await (await poolRemediationContract.initialize(addressesProviderAddress)).wait();
  }

  const addressProvider = await ethers.getContractAt("PoolAddressesProvider", addressesProviderAddress);
  const poolProxyAddress = await addressProvider.getPool();

  await deployments.deploy(SANITIZABLE_ATOKEN_IMPL_ID, {
    from: deployer,
    contract: "SanitizableAToken",
    args: [poolProxyAddress],
    autoMine: true,
    log: true,
    skipIfAlreadyDeployed: true,
  });

  console.log("🔁 ethereum-mainnet-dlend-remediation-impls: ✅");
  return true;
};

func.tags = ["post-deploy", "ethereum-mainnet-dlend-remediation-impls", "dlend", "recovery", "remediation-impls"];
func.id = "ethereum-mainnet-dlend-remediation-impls";

export default func;
