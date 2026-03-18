import { HardhatRuntimeEnvironment } from "hardhat/types";
import { DeployFunction } from "hardhat-deploy/types";

import { getConfig } from "../../config/config";
import { DETH_TOKEN_ID, DUSD_TOKEN_ID, POOL_ADDRESSES_PROVIDER_ID, POOL_CONFIGURATOR_PROXY_ID } from "../../typescript/deploy-ids";
import { isLocalNetwork } from "../../typescript/hardhat/deploy";
import { GovernanceExecutor } from "../../typescript/hardhat/governance";

const DEFAULT_CBBTC = "0xcbB7C0000aB88B473b1f5aFd9ef808440eed33Bf";

/**
 * Adds a formatted blocker to the mutable blocker list.
 *
 * @param blockers Mutable blocker array.
 * @param message Message to append.
 */
function addBlocker(blockers: string[], message: string): void {
  blockers.push(message);
}

/**
 * Parses the recovery reserve list from env.
 */
function parseRecoveryReserves(): string[] {
  return JSON.parse(process.env.RECOVERY_RESERVES_JSON || "[]") as string[];
}

const func: DeployFunction = async function (hre: HardhatRuntimeEnvironment): Promise<boolean> {
  if (isLocalNetwork(hre.network.name)) {
    console.log("🔁 setup-ethereum-mainnet-dlend-recovery-preflight: local network detected - skipping");
    return true;
  }

  const config = await getConfig(hre);
  const { deployments, ethers } = hre;
  const { deployer } = await hre.getNamedAccounts();
  const signer = await ethers.getSigner(deployer);
  const executor = new GovernanceExecutor(hre, signer, config.safeConfig);
  const blockers: string[] = [];

  if (!executor.useSafe || !config.safeConfig?.safeAddress) {
    throw new Error("Safe config is required for dLEND recovery rollout. Provide config.safeConfig and enable Safe mode.");
  }

  const recoveryReserves = parseRecoveryReserves();
  const dUSDAddress = process.env.RECOVERY_DUSD_ADDRESS || config.tokenAddresses.dUSD || (await deployments.get(DUSD_TOKEN_ID)).address;
  const dETHAddress = process.env.RECOVERY_DETH_ADDRESS || config.tokenAddresses.dETH || (await deployments.get(DETH_TOKEN_ID)).address;
  const cbBtcAddress = process.env.RECOVERY_CBBTC_ADDRESS || config.tokenAddresses.cbBTC || DEFAULT_CBBTC;

  if (recoveryReserves.length === 0) {
    addBlocker(blockers, "RECOVERY_RESERVES_JSON must list the reserves that will end in recovery-safe mode.");
  }

  if (dUSDAddress && !recoveryReserves.some((asset) => asset.toLowerCase() === dUSDAddress.toLowerCase())) {
    addBlocker(blockers, "RECOVERY_RESERVES_JSON must include dUSD so the recovery batch can unpause it into frozen mode.");
  }

  if (!dUSDAddress) {
    addBlocker(blockers, "Unable to resolve the dUSD reserve address.");
  }

  if (!dETHAddress) {
    addBlocker(blockers, "Unable to resolve the dETH reserve address.");
  }

  if (!cbBtcAddress) {
    addBlocker(blockers, "Unable to resolve the cbBTC reserve address.");
  }

  const [providerDeployment, configuratorDeployment] = await Promise.all([
    deployments.get(POOL_ADDRESSES_PROVIDER_ID),
    deployments.get(POOL_CONFIGURATOR_PROXY_ID),
  ]);

  const addressProvider = await ethers.getContractAt("PoolAddressesProvider", providerDeployment.address, signer);
  const [poolAddress, poolConfiguratorAddress] = await Promise.all([addressProvider.getPool(), addressProvider.getPoolConfigurator()]);

  if (poolConfiguratorAddress.toLowerCase() !== configuratorDeployment.address.toLowerCase()) {
    addBlocker(
      blockers,
      `PoolConfiguratorProxy mismatch: provider=${poolConfiguratorAddress}, deployment=${configuratorDeployment.address}.`,
    );
  }

  const pool = await ethers.getContractAt("Pool", poolAddress, signer);
  const reservesList = new Set((await pool.getReservesList()).map((asset: string) => asset.toLowerCase()));

  for (const asset of recoveryReserves) {
    if (!reservesList.has(asset.toLowerCase())) {
      addBlocker(blockers, `Recovery reserve ${asset} is not active in pool ${poolAddress}.`);
    }
  }

  for (const [label, asset] of [
    ["dUSD", dUSDAddress],
    ["dETH", dETHAddress],
    ["cbBTC", cbBtcAddress],
  ] as const) {
    if (asset && !reservesList.has(asset.toLowerCase())) {
      addBlocker(blockers, `${label} reserve ${asset} is not active in pool ${poolAddress}.`);
    }
  }

  if (recoveryReserves.some((asset) => asset.toLowerCase() === cbBtcAddress.toLowerCase())) {
    addBlocker(blockers, "cbBTC must not be included in RECOVERY_RESERVES_JSON; it stays paused in the recovery batch.");
  }

  if (blockers.length > 0) {
    throw new Error(`dLEND recovery preflight failed:\n- ${blockers.join("\n- ")}`);
  }

  console.log("🔁 setup-ethereum-mainnet-dlend-recovery-preflight: ✅");
  return true;
};

func.tags = ["post-deploy", "safe", "dlend", "recovery", "setup-ethereum-mainnet-dlend-recovery-preflight"];
func.id = "setup-ethereum-mainnet-dlend-recovery-preflight";

export default func;
