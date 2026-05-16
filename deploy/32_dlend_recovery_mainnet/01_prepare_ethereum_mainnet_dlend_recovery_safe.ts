import { HardhatRuntimeEnvironment } from "hardhat/types";
import { DeployFunction } from "hardhat-deploy/types";

import { getConfig } from "../../config/config";
import { DUSD_TOKEN_ID, POOL_ADDRESSES_PROVIDER_ID } from "../../typescript/deploy-ids";
import { isLocalNetwork } from "../../typescript/hardhat/deploy";
import { GovernanceExecutor } from "../../typescript/hardhat/governance";
import {
  DEFAULT_CBBTC,
  getPoolReserves,
  getReserveConfig,
  normalizeAddress,
  parseAddressListEnv,
  parseBooleanEnv,
  queueReserveIntoFrozenState,
  queueSafeCall,
} from "./common";

const func: DeployFunction = async function (hre: HardhatRuntimeEnvironment): Promise<boolean> {
  if (isLocalNetwork(hre.network.name)) {
    console.log("🔁 setup-ethereum-mainnet-dlend-recovery-safe: local network detected - skipping");
    return true;
  }

  const config = await getConfig(hre);
  const { deployments, ethers } = hre;
  const { deployer } = await hre.getNamedAccounts();
  const signer = await ethers.getSigner(deployer);
  const executor = new GovernanceExecutor(hre, signer, config.safeConfig);

  if (!executor.useSafe || !config.safeConfig?.safeAddress) {
    throw new Error("Safe config is required for dLEND recovery batch generation. Provide config.safeConfig and enable Safe mode.");
  }

  await executor.initialize();

  const subsetOverride = parseAddressListEnv("PHASE1_RESERVES_JSON", "RECOVERY_RESERVES_JSON");
  const allowSubset = parseBooleanEnv("PHASE1_ALLOW_SUBSET", false);
  const dUSDAddress = process.env.RECOVERY_DUSD_ADDRESS || config.tokenAddresses.dUSD || (await deployments.get(DUSD_TOKEN_ID)).address;
  const cbBtcAddress = process.env.RECOVERY_CBBTC_ADDRESS || config.tokenAddresses.cbBTC || DEFAULT_CBBTC;
  const setCbBtcLtvZero = parseBooleanEnv("RECOVERY_SET_CBBTC_LTV_ZERO", true);

  const addressProviderDeployment = await deployments.get(POOL_ADDRESSES_PROVIDER_ID);
  const addressProvider = await ethers.getContractAt("PoolAddressesProvider", addressProviderDeployment.address, signer);
  const [poolAddress, poolConfiguratorAddress] = await Promise.all([addressProvider.getPool(), addressProvider.getPoolConfigurator()]);
  const [pool, poolConfigurator] = await Promise.all([
    ethers.getContractAt("Pool", poolAddress, signer),
    ethers.getContractAt("PoolConfigurator", poolConfiguratorAddress, signer),
  ]);

  const allReserves = await getPoolReserves(pool);
  const phase1Targets = subsetOverride.length > 0 ? subsetOverride : allReserves;

  if (!phase1Targets.some((asset) => normalizeAddress(asset) === normalizeAddress(dUSDAddress))) {
    throw new Error("Phase 1 target set must include dUSD.");
  }

  if (!phase1Targets.some((asset) => normalizeAddress(asset) === normalizeAddress(cbBtcAddress))) {
    throw new Error("Phase 1 target set must include cbBTC.");
  }

  if (subsetOverride.length > 0 && !allowSubset) {
    throw new Error(
      "PHASE1_RESERVES_JSON / RECOVERY_RESERVES_JSON was provided, but Phase 1 is intended to freeze the full reserve list. Set PHASE1_ALLOW_SUBSET=true only for rehearsal runs.",
    );
  }

  for (const asset of phase1Targets) {
    const current = await getReserveConfig(pool, asset);
    const normalized = normalizeAddress(asset);

    if (normalized === normalizeAddress(dUSDAddress)) {
      await queueReserveIntoFrozenState(executor, poolConfigurator, poolConfiguratorAddress, asset, current, false);
      continue;
    }

    await queueReserveIntoFrozenState(executor, poolConfigurator, poolConfiguratorAddress, asset, current, true);

    if (normalized === normalizeAddress(cbBtcAddress) && setCbBtcLtvZero && current.ltv !== 0n) {
      await queueSafeCall(
        executor,
        poolConfiguratorAddress,
        poolConfigurator.interface.encodeFunctionData("configureReserveAsCollateral", [
          cbBtcAddress,
          0,
          current.liquidationThreshold,
          current.liquidationBonus,
        ]),
      );
    }
  }

  const success = await executor.flush("Ethereum mainnet dLEND recovery phase 1: freeze all reserves, unpause only dUSD");

  if (!success) {
    throw new Error("Failed to flush dLEND recovery Phase 1 Safe batch");
  }

  console.log(`🔁 setup-ethereum-mainnet-dlend-recovery-safe: ✅ (${phase1Targets.length} reserves)`);
  return true;
};

func.tags = [
  "post-deploy",
  "safe",
  "dlend",
  "recovery",
  "phase1",
  "setup-ethereum-mainnet-dlend-recovery-safe",
  "setup-ethereum-mainnet-dlend-recovery-phase1-safe",
];
func.dependencies = ["setup-ethereum-mainnet-dlend-recovery-preflight"];
func.id = "setup-ethereum-mainnet-dlend-recovery-safe";

export default func;
