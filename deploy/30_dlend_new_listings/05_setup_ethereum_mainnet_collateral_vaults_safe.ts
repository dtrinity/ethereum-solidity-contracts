import { ZeroAddress } from "ethers";
import { HardhatRuntimeEnvironment } from "hardhat/types";
import { DeployFunction } from "hardhat-deploy/types";

import { getConfig } from "../../config/config";
import {
  DETH_COLLATERAL_VAULT_CONTRACT_ID,
  DETH_REDEEMER_V2_CONTRACT_ID,
  DUSD_COLLATERAL_VAULT_CONTRACT_ID,
  DUSD_REDEEMER_V2_CONTRACT_ID,
} from "../../typescript/deploy-ids";
import { isLocalNetwork } from "../../typescript/hardhat/deploy";
import { GovernanceExecutor } from "../../typescript/hardhat/governance";
import { assertRoleGrantedToManager } from "../_shared/safe-role";

type RolloutConfig = {
  label: string;
  collateralVaultId: string;
  redeemerId: string;
  expectedFeeReceiver: string;
  collaterals: string[];
  customFees: Map<string, bigint>;
};

/**
 * Normalizes an address value for case-insensitive comparisons.
 *
 * @param address Address to normalize.
 */
function normalize(address: string): string {
  return address.toLowerCase();
}

/**
 * Returns true when the address equals the canonical zero address.
 *
 * @param address Address to compare.
 */
function isZeroAddress(address: string): boolean {
  return normalize(address) === normalize(ZeroAddress);
}

/**
 * Converts collateral fee config into a normalized address->fee map.
 *
 * @param fees Optional collateral fee overrides from config.
 */
function toFeeMap(fees: Record<string, number> | undefined): Map<string, bigint> {
  const result = new Map<string, bigint>();

  for (const [asset, fee] of Object.entries(fees ?? {})) {
    result.set(normalize(asset), BigInt(fee));
  }

  return result;
}

const func: DeployFunction = async function (hre: HardhatRuntimeEnvironment): Promise<boolean> {
  if (isLocalNetwork(hre.network.name)) {
    console.log("🔁 setup-ethereum-mainnet-collateral-vaults-safe: local network detected – skipping");
    return true;
  }

  const { deployments, ethers } = hre;
  const { deployer } = await hre.getNamedAccounts();
  const signer = await ethers.getSigner(deployer);
  const config = await getConfig(hre);

  const executor = new GovernanceExecutor(hre, signer, config.safeConfig);

  if (!executor.useSafe) {
    throw new Error("Safe config is required for collateral vault rollout. Provide config.safeConfig and enable Safe mode.");
  }

  await executor.initialize();
  const managerAddress = config.safeConfig!.safeAddress;

  const rolloutConfigs: RolloutConfig[] = [
    {
      label: "dUSD",
      collateralVaultId: DUSD_COLLATERAL_VAULT_CONTRACT_ID,
      redeemerId: DUSD_REDEEMER_V2_CONTRACT_ID,
      expectedFeeReceiver: config.dStables.dUSD?.initialFeeReceiver ?? "",
      collaterals: config.dStables.dUSD?.collaterals ?? [],
      customFees: toFeeMap(config.dStables.dUSD?.collateralRedemptionFees),
    },
    {
      label: "dETH",
      collateralVaultId: DETH_COLLATERAL_VAULT_CONTRACT_ID,
      redeemerId: DETH_REDEEMER_V2_CONTRACT_ID,
      expectedFeeReceiver: config.dStables.dETH?.initialFeeReceiver ?? "",
      collaterals: config.dStables.dETH?.collaterals ?? [],
      customFees: toFeeMap(config.dStables.dETH?.collateralRedemptionFees),
    },
  ];

  for (const rollout of rolloutConfigs) {
    const { address: vaultAddress } = await deployments.get(rollout.collateralVaultId);
    const { address: redeemerAddress } = await deployments.get(rollout.redeemerId);

    const collateralVault = await ethers.getContractAt("CollateralHolderVault", vaultAddress, signer);
    const redeemer = await ethers.getContractAt("RedeemerV2", redeemerAddress, signer);
    const [collateralManagerRole, collateralWithdrawerRole, configuredVaultAddress, currentFeeReceiver] = await Promise.all([
      collateralVault.COLLATERAL_MANAGER_ROLE(),
      collateralVault.COLLATERAL_WITHDRAWER_ROLE(),
      redeemer.collateralVault(),
      redeemer.feeReceiver(),
    ]);

    if (isZeroAddress(rollout.expectedFeeReceiver)) {
      throw new Error(`[sanity-check] Missing expected feeReceiver in config for ${rollout.label}.`);
    }

    if (normalize(configuredVaultAddress) !== normalize(vaultAddress)) {
      throw new Error(
        [
          `[sanity-check] Redeemer collateral vault mismatch for ${rollout.label}.`,
          `redeemer=${redeemerAddress}`,
          `configuredVault=${configuredVaultAddress}`,
          `expectedVault=${vaultAddress}`,
        ].join(" "),
      );
    }

    if (normalize(currentFeeReceiver) !== normalize(rollout.expectedFeeReceiver)) {
      throw new Error(
        [
          `[sanity-check] Fee receiver mismatch for ${rollout.label}.`,
          `redeemer=${redeemerAddress}`,
          `currentFeeReceiver=${currentFeeReceiver}`,
          `expectedFeeReceiver=${rollout.expectedFeeReceiver}`,
        ].join(" "),
      );
    }

    const redeemerHasWithdrawRole = await collateralVault.hasRole(collateralWithdrawerRole, redeemerAddress);

    if (!redeemerHasWithdrawRole) {
      throw new Error(
        [
          `[sanity-check] Redeemer is missing COLLATERAL_WITHDRAWER_ROLE for ${rollout.label}.`,
          `vault=${vaultAddress}`,
          `redeemer=${redeemerAddress}`,
        ].join(" "),
      );
    }

    await assertRoleGrantedToManager({
      contract: collateralVault,
      contractAddress: vaultAddress,
      managerAddress,
      role: collateralManagerRole,
      roleLabel: "COLLATERAL_MANAGER_ROLE",
      contractLabel: rollout.collateralVaultId,
    });

    if (rollout.customFees.size > 0) {
      const redeemerDefaultAdminRole = await redeemer.DEFAULT_ADMIN_ROLE();

      await assertRoleGrantedToManager({
        contract: redeemer,
        contractAddress: redeemerAddress,
        managerAddress,
        role: redeemerDefaultAdminRole,
        roleLabel: "DEFAULT_ADMIN_ROLE",
        contractLabel: rollout.redeemerId,
      });
    }

    const processedAssets = new Set<string>();

    for (const asset of rollout.collaterals) {
      if (!asset || isZeroAddress(asset)) {
        continue;
      }

      const normalizedAsset = normalize(asset);

      if (processedAssets.has(normalizedAsset)) {
        continue;
      }
      processedAssets.add(normalizedAsset);

      const isSupported = await collateralVault.isCollateralSupported(asset);

      if (!isSupported) {
        const data = collateralVault.interface.encodeFunctionData("allowCollateral", [asset]);
        await executor.tryOrQueue(
          async () => {
            throw new Error("Direct execution disabled: queue Safe transaction instead.");
          },
          () => ({ to: vaultAddress, value: "0", data }),
        );
      }

      const configuredFee = rollout.customFees.get(normalizedAsset);

      if (configuredFee === undefined) {
        continue;
      }

      const [currentFee, feeIsOverridden] = await Promise.all([
        redeemer.collateralRedemptionFeeBps(asset),
        redeemer.isCollateralFeeOverridden(asset),
      ]);

      if (currentFee !== configuredFee || !feeIsOverridden) {
        const data = redeemer.interface.encodeFunctionData("setCollateralRedemptionFee", [asset, configuredFee]);
        await executor.tryOrQueue(
          async () => {
            throw new Error("Direct execution disabled: queue Safe transaction instead.");
          },
          () => ({ to: redeemerAddress, value: "0", data }),
        );
      }
    }

    console.log(`🔁 setup-ethereum-mainnet-collateral-vaults-safe: processed ${rollout.label}`);
  }

  await executor.flush("Ethereum mainnet dStable collateral vault rollout");
  console.log("🔁 setup-ethereum-mainnet-collateral-vaults-safe: ✅");
  return true;
};

func.tags = ["post-deploy", "dstable", "collateral-rollout", "safe", "setup-ethereum-mainnet-collateral-vaults-safe"];
func.dependencies = [
  "setup-ethereum-mainnet-new-listings-preflight",
  "setup-ethereum-mainnet-new-listings-role-grants-safe",
  "setup-ethereum-mainnet-collateral-oracles-safe",
  "setup-ethereum-mainnet-eth-oracles-safe",
  DUSD_COLLATERAL_VAULT_CONTRACT_ID,
  DETH_COLLATERAL_VAULT_CONTRACT_ID,
  DUSD_REDEEMER_V2_CONTRACT_ID,
  DETH_REDEEMER_V2_CONTRACT_ID,
];
func.id = "setup-ethereum-mainnet-collateral-vaults-safe-v3";

export default func;
