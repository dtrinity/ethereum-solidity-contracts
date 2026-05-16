import { HardhatRuntimeEnvironment } from "hardhat/types";
import { DeployFunction } from "hardhat-deploy/types";

import { getConfig } from "../../../config/config";
import {
  ATOMIC_MARKET_LISTING_HELPER_ID,
  CONFIGURATOR_LOGIC_ID,
  POOL_ADDRESSES_PROVIDER_ID,
  POOL_CONFIGURATOR_ID,
  RESERVES_SETUP_HELPER_ID,
} from "../../../typescript/deploy-ids";
import { isLocalNetwork } from "../../../typescript/hardhat/deploy";

/**
 * Normalizes an address value for case-insensitive comparisons.
 *
 * @param value Address to normalize.
 */
function normalize(value: string): string {
  return value.toLowerCase();
}

/**
 * Transfers helper ownership to the governance Safe when the network config requires it.
 *
 * @param hre Hardhat runtime.
 * @param deployer Deployer EOA.
 * @param contractName Contract name for ethers.getContractAt.
 * @param helperAddress Helper deployment address.
 * @param expectedOwner Governance Safe address.
 */
async function ensureHelperOwner(
  hre: HardhatRuntimeEnvironment,
  deployer: string,
  contractName: string,
  helperAddress: string,
  expectedOwner: string,
): Promise<void> {
  const signer = await hre.ethers.getSigner(deployer);
  const helper = await hre.ethers.getContractAt(contractName, helperAddress, signer);
  const currentOwner = await helper.owner();

  if (normalize(currentOwner) === normalize(expectedOwner)) {
    return;
  }

  if (normalize(currentOwner) !== normalize(deployer)) {
    throw new Error(
      [
        `[ownership-check] ${contractName} owner mismatch.`,
        `helper=${helperAddress}`,
        `currentOwner=${currentOwner}`,
        `expectedOwner=${expectedOwner}`,
        `deployer=${deployer}`,
      ].join(" "),
    );
  }

  const tx = await helper.transferOwnership(expectedOwner);
  await tx.wait();
  console.log(`  - ${contractName} ownership transferred to ${expectedOwner}`);
}

const func: DeployFunction = async function (hre: HardhatRuntimeEnvironment) {
  const { deployer } = await hre.getNamedAccounts();

  // Get addresses provider address
  const { address: addressesProviderAddress } = await hre.deployments.get(POOL_ADDRESSES_PROVIDER_ID);

  // Get configurator logic library
  const configuratorLogicDeployment = await hre.deployments.get(CONFIGURATOR_LOGIC_ID);

  // Deploy pool configurator implementation
  const poolConfiguratorDeployment = await hre.deployments.deploy(POOL_CONFIGURATOR_ID, {
    from: deployer,
    args: [],
    contract: "PoolConfigurator",
    libraries: {
      ConfiguratorLogic: configuratorLogicDeployment.address,
    },
    autoMine: true,
    log: false,
  });

  // Initialize implementation (only if not already initialized)
  const poolConfig = await hre.ethers.getContractAt("PoolConfigurator", poolConfiguratorDeployment.address);

  // Try to initialize - will fail if already initialized
  try {
    await poolConfig.initialize(addressesProviderAddress);
    console.log(`  - PoolConfigurator initialized`);
  } catch (error: unknown) {
    const errorMessage = error instanceof Error ? error.message : String(error);

    if (errorMessage.includes("already been initialized")) {
      console.log(`  - PoolConfigurator already initialized, skipping`);
    } else {
      throw error;
    }
  }

  // Deploy legacy reserves setup helper (kept for backwards compatibility of existing flows)
  const reservesSetupHelperDeployment = await hre.deployments.deploy(RESERVES_SETUP_HELPER_ID, {
    from: deployer,
    args: [],
    contract: "ReservesSetupHelper",
    autoMine: true,
    log: false,
  });

  // Deploy atomic listing helper for all future market listings.
  const atomicMarketListingHelperDeployment = await hre.deployments.deploy(ATOMIC_MARKET_LISTING_HELPER_ID, {
    from: deployer,
    args: [],
    contract: "AtomicMarketListingHelper",
    autoMine: true,
    log: false,
  });

  const config = await getConfig(hre);
  const safeAddress = config.safeConfig?.safeAddress;

  if (!isLocalNetwork(hre.network.name) && safeAddress) {
    await ensureHelperOwner(hre, deployer, "ReservesSetupHelper", reservesSetupHelperDeployment.address, safeAddress);
    await ensureHelperOwner(hre, deployer, "AtomicMarketListingHelper", atomicMarketListingHelperDeployment.address, safeAddress);
  }

  console.log(`🏦 ${__filename.split("/").slice(-2).join("/")}: ✅`);

  // Return true to indicate deployment success
  return true;
};

func.id = "dLend:PoolConfigurator:v2";
func.tags = ["dlend", "dlend-market", RESERVES_SETUP_HELPER_ID, ATOMIC_MARKET_LISTING_HELPER_ID, "PoolConfigurator"];
func.dependencies = ["dlend-core", "dlend-periphery-pre"];

export default func;
