import { HardhatRuntimeEnvironment } from "hardhat/types";
import { DeployFunction } from "hardhat-deploy/types";

import { getConfig } from "../../config/config";
import { DUSD_TOKEN_ID, POOL_ADDRESSES_PROVIDER_ID, POOL_CONFIGURATOR_PROXY_ID } from "../../typescript/deploy-ids";
import { isLocalNetwork } from "../../typescript/hardhat/deploy";
import { GovernanceExecutor } from "../../typescript/hardhat/governance";
import { addBlocker, DEFAULT_CBBTC, getPoolReserves, isSubset, normalizeAddress, parseAddressListEnv, parseBooleanEnv } from "./common";

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

  const safeAddress = config.safeConfig.safeAddress;
  const subsetOverride = parseAddressListEnv("PHASE1_RESERVES_JSON", "RECOVERY_RESERVES_JSON");
  const allowSubset = parseBooleanEnv("PHASE1_ALLOW_SUBSET", false);
  const dUSDAddress = process.env.RECOVERY_DUSD_ADDRESS || config.tokenAddresses.dUSD || (await deployments.get(DUSD_TOKEN_ID)).address;
  const cbBtcAddress = process.env.RECOVERY_CBBTC_ADDRESS || config.tokenAddresses.cbBTC || DEFAULT_CBBTC;

  if (!dUSDAddress) {
    addBlocker(blockers, "Unable to resolve the dUSD reserve address.");
  }

  if (!cbBtcAddress) {
    addBlocker(blockers, "Unable to resolve the cbBTC reserve address.");
  }

  const [providerDeployment, configuratorDeployment] = await Promise.all([
    deployments.get(POOL_ADDRESSES_PROVIDER_ID),
    deployments.get(POOL_CONFIGURATOR_PROXY_ID),
  ]);

  const addressProvider = await ethers.getContractAt("PoolAddressesProvider", providerDeployment.address, signer);
  const [poolAddress, poolConfiguratorAddress, aclManagerAddress] = await Promise.all([
    addressProvider.getPool(),
    addressProvider.getPoolConfigurator(),
    addressProvider.getACLManager(),
  ]);

  if (normalizeAddress(poolConfiguratorAddress) !== normalizeAddress(configuratorDeployment.address)) {
    addBlocker(
      blockers,
      `PoolConfiguratorProxy mismatch: provider=${poolConfiguratorAddress}, deployment=${configuratorDeployment.address}.`,
    );
  }

  const [pool, aclManager] = await Promise.all([
    ethers.getContractAt("Pool", poolAddress, signer),
    ethers.getContractAt("ACLManager", aclManagerAddress, signer),
  ]);

  const allReserves = await getPoolReserves(pool);
  const phase1Targets = subsetOverride.length > 0 ? subsetOverride : allReserves;
  const allReserveSet = new Set(allReserves.map((asset) => normalizeAddress(asset)));

  if (subsetOverride.length > 0 && !allowSubset) {
    addBlocker(
      blockers,
      "PHASE1_RESERVES_JSON / RECOVERY_RESERVES_JSON was provided, but Phase 1 is intended to freeze every live reserve. Set PHASE1_ALLOW_SUBSET=true only for explicit rehearsal runs.",
    );
  }

  if (!isSubset(phase1Targets, allReserves)) {
    for (const asset of phase1Targets) {
      if (!allReserveSet.has(normalizeAddress(asset))) {
        addBlocker(blockers, `Phase 1 target reserve ${asset} is not active in pool ${poolAddress}.`);
      }
    }
  }

  if (phase1Targets.length !== allReserves.length && !allowSubset) {
    addBlocker(
      blockers,
      `Phase 1 target set has ${phase1Targets.length} reserves but pool ${poolAddress} has ${allReserves.length}. Phase 1 should cover the full reserve list.`,
    );
  }

  for (const [label, asset] of [
    ["dUSD", dUSDAddress],
    ["cbBTC", cbBtcAddress],
  ] as const) {
    if (asset && !allReserveSet.has(normalizeAddress(asset))) {
      addBlocker(blockers, `${label} reserve ${asset} is not active in pool ${poolAddress}.`);
    }
  }

  if (!phase1Targets.some((asset) => normalizeAddress(asset) === normalizeAddress(dUSDAddress))) {
    addBlocker(blockers, "Phase 1 target set must include dUSD so it can be unpaused into frozen mode.");
  }

  if (!phase1Targets.some((asset) => normalizeAddress(asset) === normalizeAddress(cbBtcAddress))) {
    addBlocker(blockers, "Phase 1 target set must include cbBTC so it can be quarantined in-place.");
  }

  const [isPoolAdmin, isRiskAdmin, isEmergencyAdmin] = await Promise.all([
    aclManager.isPoolAdmin(safeAddress),
    aclManager.isRiskAdmin(safeAddress),
    aclManager.isEmergencyAdmin(safeAddress),
  ]);

  if (!isPoolAdmin && !isRiskAdmin) {
    addBlocker(
      blockers,
      `Safe ${safeAddress} must be a pool admin or risk admin to disable borrowing, stable borrowing, flash loans, and to freeze reserves.`,
    );
  }

  if (!isPoolAdmin && !isEmergencyAdmin) {
    addBlocker(blockers, `Safe ${safeAddress} must be a pool admin or emergency admin to pause/unpause reserves.`);
  }

  if (blockers.length > 0) {
    throw new Error(`dLEND recovery phase 1 preflight failed:\n- ${blockers.join("\n- ")}`);
  }

  console.log(`🔁 setup-ethereum-mainnet-dlend-recovery-preflight: ✅ (${phase1Targets.length} reserves)`);
  return true;
};

func.tags = [
  "post-deploy",
  "safe",
  "dlend",
  "recovery",
  "phase1",
  "setup-ethereum-mainnet-dlend-recovery-preflight",
  "setup-ethereum-mainnet-dlend-recovery-phase1-preflight",
];
func.id = "setup-ethereum-mainnet-dlend-recovery-preflight";

export default func;
