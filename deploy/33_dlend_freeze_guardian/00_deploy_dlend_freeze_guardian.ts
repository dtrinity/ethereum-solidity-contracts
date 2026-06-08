import { getAddress } from "ethers";
import { HardhatRuntimeEnvironment } from "hardhat/types";
import { DeployFunction } from "hardhat-deploy/types";

import { DLEND_FREEZE_GUARDIAN_ID, POOL_ADDRESSES_PROVIDER_ID } from "../../typescript/deploy-ids";
import { isLocalNetwork } from "../../typescript/hardhat/deploy";

/**
 * Resolves the freeze guardian owner address for the current network.
 *
 * @param hre Hardhat runtime environment.
 * @param deployer Named deployer address.
 */
function resolveFreezeGuardianOwner(hre: HardhatRuntimeEnvironment, deployer: string): string {
  const configuredOwner = process.env.DLEND_FREEZE_GUARDIAN_MULTISIG;

  if (configuredOwner) {
    return getAddress(configuredOwner);
  }

  if (isLocalNetwork(hre.network.name)) {
    return getAddress(deployer);
  }

  throw new Error("Set DLEND_FREEZE_GUARDIAN_MULTISIG to the dedicated freeze-only multisig address.");
}

const func: DeployFunction = async function (hre: HardhatRuntimeEnvironment): Promise<boolean> {
  const { deployments, ethers } = hre;
  const { deployer } = await hre.getNamedAccounts();
  const signer = await ethers.getSigner(deployer);
  const owner = resolveFreezeGuardianOwner(hre, deployer);
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

  if (getAddress(currentOwner) !== owner) {
    throw new Error(`DlendFreezeGuardian owner mismatch: current=${currentOwner} expected=${owner}`);
  }

  console.log(`🔁 dlend-freeze-guardian: deployed=${deployment.address} owner=${owner}`);
  return true;
};

func.tags = ["post-deploy", "dlend", "freeze-guardian", DLEND_FREEZE_GUARDIAN_ID];
func.dependencies = [POOL_ADDRESSES_PROVIDER_ID];
func.id = "dlend-freeze-guardian";

export default func;
