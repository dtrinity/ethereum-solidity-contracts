import { getAddress } from "ethers";
import { HardhatRuntimeEnvironment } from "hardhat/types";
import { DeployFunction } from "hardhat-deploy/types";

import { DLEND_FREEZE_GUARDIAN_ID, POOL_ADDRESSES_PROVIDER_ID } from "../../typescript/deploy-ids";

const DLEND_FREEZE_GUARDIAN_OWNER = "0x43b1BccFF0e4BfEf2C32774E53a69a762006C118";

const func: DeployFunction = async function (hre: HardhatRuntimeEnvironment): Promise<boolean> {
  const { deployments, ethers } = hre;
  const { deployer } = await hre.getNamedAccounts();
  const signer = await ethers.getSigner(deployer);
  const owner = getAddress(DLEND_FREEZE_GUARDIAN_OWNER);
  const addressProviderDeployment = await deployments.get(POOL_ADDRESSES_PROVIDER_ID);

  const deployment = await deployments.deploy(DLEND_FREEZE_GUARDIAN_ID, {
    from: deployer,
    contract: "DlendFreezeGuardian",
    args: [addressProviderDeployment.address, owner],
    autoMine: true,
    log: true,
    skipIfAlreadyDeployed: true,
  });

  const guardian = await ethers.getContractAt("DlendFreezeGuardian", deployment.address, signer);
  const currentOwner = await guardian.owner();
  const currentProvider = await guardian.ADDRESSES_PROVIDER();

  if (getAddress(currentOwner) !== owner) {
    throw new Error(`DlendFreezeGuardian owner mismatch: current=${currentOwner} expected=${owner}`);
  }

  if (getAddress(currentProvider) !== getAddress(addressProviderDeployment.address)) {
    throw new Error(`DlendFreezeGuardian provider mismatch: current=${currentProvider} expected=${addressProviderDeployment.address}`);
  }

  console.log(`dlend-freeze-guardian: deployed=${deployment.address} owner=${owner}`);
  return true;
};

func.tags = ["post-deploy", "dlend", "freeze-guardian", DLEND_FREEZE_GUARDIAN_ID];
func.dependencies = [POOL_ADDRESSES_PROVIDER_ID];
func.id = "dlend-freeze-guardian";

export default func;
