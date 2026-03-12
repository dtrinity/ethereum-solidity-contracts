import { ethers } from "hardhat";
import { HardhatRuntimeEnvironment } from "hardhat/types";
import { DeployFunction } from "hardhat-deploy/types";

import { getConfig } from "../../config/config";
import { DStakeInstanceConfig } from "../../config/types";
import { DSTAKE_ROUTER_ID_PREFIX } from "../../typescript/deploy-ids";
import { isLocalNetwork } from "../../typescript/hardhat/deploy";
import { GovernanceExecutor } from "../../typescript/hardhat/governance";

type RouterVaultConfig = {
  strategyVault: string;
  adapter: string;
  targetBps: bigint;
  status: number;
};

/**
 * Normalizes addresses for deterministic comparisons.
 *
 * @param address Address to normalize.
 */
function normalize(address: string): string {
  return address.toLowerCase();
}

/**
 * Compares two router vault configs for exact equality.
 *
 * @param left Current or desired config.
 * @param right Current or desired config.
 */
function sameVaultConfig(left: RouterVaultConfig, right: RouterVaultConfig): boolean {
  return (
    normalize(left.strategyVault) === normalize(right.strategyVault) &&
    normalize(left.adapter) === normalize(right.adapter) &&
    left.targetBps === right.targetBps &&
    left.status === right.status
  );
}

/**
 * Resolves the desired router vault config array from the network config plus deployed adapter addresses.
 *
 * @param params Config resolution inputs.
 * @param params.hre Hardhat runtime environment.
 * @param params.instanceConfig dSTAKE instance configuration to resolve.
 */
async function resolveDesiredVaultConfigs(params: {
  hre: HardhatRuntimeEnvironment;
  instanceConfig: DStakeInstanceConfig;
}): Promise<RouterVaultConfig[]> {
  const { hre, instanceConfig } = params;
  const desiredConfigs: RouterVaultConfig[] = [];

  for (const adapterConfig of instanceConfig.adapters) {
    const strategyShare = adapterConfig.strategyShare;

    if (!strategyShare || strategyShare === ethers.ZeroAddress) {
      throw new Error(`Missing strategyShare for ${instanceConfig.symbol} adapter ${adapterConfig.adapterContract}`);
    }

    const adapterDeploymentName = `${adapterConfig.adapterContract}_${instanceConfig.symbol}`;
    const adapterDeployment = await hre.deployments.get(adapterDeploymentName);

    desiredConfigs.push({
      strategyVault: strategyShare,
      adapter: adapterDeployment.address,
      targetBps: BigInt(adapterConfig.targetBps ?? 0),
      status: 0,
    });
  }

  return desiredConfigs;
}

const func: DeployFunction = async function (hre: HardhatRuntimeEnvironment): Promise<boolean> {
  const runOnLocal = process.env.RUN_ON_LOCAL?.toLowerCase() === "true";

  if (isLocalNetwork(hre.network.name) && !runOnLocal) {
    console.log("🔁 setup-ethereum-mainnet-dstake-dlend-safe: local network detected – skipping");
    return true;
  }

  const { deployments } = hre;
  const { deployer } = await hre.getNamedAccounts();
  const deployerSigner = await ethers.getSigner(deployer);
  const config = await getConfig(hre);

  if (!config.dStake) {
    console.log("🔁 setup-ethereum-mainnet-dstake-dlend-safe: no dSTAKE config – skipping");
    return true;
  }

  const executor = new GovernanceExecutor(hre, deployerSigner, config.safeConfig);
  await executor.initialize();

  for (const instanceKey in config.dStake) {
    const instanceConfig = config.dStake[instanceKey] as DStakeInstanceConfig;
    const symbol = instanceConfig.symbol;

    if (!symbol) {
      throw new Error(`Missing dSTAKE symbol for instance ${instanceKey}`);
    }

    if (!instanceConfig.defaultDepositStrategyShare || instanceConfig.defaultDepositStrategyShare === ethers.ZeroAddress) {
      throw new Error(`Missing defaultDepositStrategyShare for ${instanceKey}`);
    }

    const routerDeploymentName = `${DSTAKE_ROUTER_ID_PREFIX}_${symbol}`;
    const routerDeployment = await deployments.get(routerDeploymentName);
    const router = await ethers.getContractAt("DStakeRouterV2", routerDeployment.address, deployerSigner);

    const [governanceModule, desiredVaultConfigs, currentDefault] = await Promise.all([
      router.governanceModule(),
      resolveDesiredVaultConfigs({ hre, instanceConfig }),
      router.defaultDepositStrategyShare(),
    ]);

    if (governanceModule === ethers.ZeroAddress) {
      throw new Error(`Router ${routerDeploymentName} has governanceModule unset.`);
    }

    const currentVaultCount = Number(await router.getVaultCount());
    const currentVaultConfigs: RouterVaultConfig[] = [];

    for (let i = 0; i < currentVaultCount; i++) {
      const configEntry = await router.getVaultConfigByIndex(i);
      currentVaultConfigs.push({
        strategyVault: configEntry.strategyVault,
        adapter: configEntry.adapter,
        targetBps: BigInt(configEntry.targetBps),
        status: Number(configEntry.status),
      });
    }

    const needsVaultConfigUpdate =
      currentVaultConfigs.length !== desiredVaultConfigs.length ||
      currentVaultConfigs.some((currentConfig, index) => !sameVaultConfig(currentConfig, desiredVaultConfigs[index]));

    if (needsVaultConfigUpdate) {
      const txData = router.interface.encodeFunctionData("setVaultConfigs", [desiredVaultConfigs]);

      if (executor.useSafe) {
        await executor.tryOrQueue(
          async () => {
            throw new Error("Direct execution disabled: queue Safe transaction instead.");
          },
          () => ({ to: routerDeployment.address, value: "0", data: txData }),
        );
      } else {
        const tx = await router.setVaultConfigs(desiredVaultConfigs);
        await tx.wait();
      }
    } else {
      console.log(`   ✓ ${routerDeploymentName} vault configs already match desired dLEND allocation`);
    }

    if (normalize(currentDefault) !== normalize(instanceConfig.defaultDepositStrategyShare)) {
      const txData = router.interface.encodeFunctionData("setDefaultDepositStrategyShare", [instanceConfig.defaultDepositStrategyShare]);

      if (executor.useSafe) {
        await executor.tryOrQueue(
          async () => {
            throw new Error("Direct execution disabled: queue Safe transaction instead.");
          },
          () => ({ to: routerDeployment.address, value: "0", data: txData }),
        );
      } else {
        const tx = await router.setDefaultDepositStrategyShare(instanceConfig.defaultDepositStrategyShare);
        await tx.wait();
      }
    } else {
      console.log(`   ✓ ${routerDeploymentName} default deposit strategy already points to dLEND`);
    }
  }

  const success = await executor.flush("Ethereum mainnet dSTAKE dLEND target allocation setup");

  if (!success) {
    throw new Error("Failed to flush dSTAKE dLEND target allocation Safe batch");
  }

  console.log("🔁 setup-ethereum-mainnet-dstake-dlend-safe: ✅");
  return true;
};

func.tags = ["post-deploy", "safe", "dstake", "dlend", "setup-ethereum-mainnet-dstake-dlend-safe"];
func.dependencies = ["setup-ethereum-mainnet-dstake-dlend-role-grants-safe", "dStakeDLendRewards"];
func.id = "setup-ethereum-mainnet-dstake-dlend-safe";

export default func;
