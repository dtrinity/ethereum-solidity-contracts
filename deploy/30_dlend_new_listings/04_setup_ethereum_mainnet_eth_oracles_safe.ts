import { ZeroAddress } from "ethers";
import { HardhatRuntimeEnvironment } from "hardhat/types";
import { DeployFunction } from "hardhat-deploy/types";

import { getConfig } from "../../config/config";
import {
  ETH_ERC4626_ORACLE_WRAPPER_ID,
  ETH_FRXETH_FUNDAMENTAL_ORACLE_WRAPPER_ID,
  ETH_ORACLE_AGGREGATOR_ID,
  ETH_REDSTONE_ORACLE_WRAPPER_ID,
} from "../../typescript/deploy-ids";
import { isLocalNetwork } from "../../typescript/hardhat/deploy";
import { GovernanceExecutor } from "../../typescript/hardhat/governance";
import {
  assertDirectWrapperPriceWithinBounds,
  assertErc4626PriceWithinBounds,
  assertPlainFeedPriceWithinBounds,
  getEthOraclePriceBounds,
} from "../_shared/oracle-price-sanity";
import { assertRoleGrantedToManager } from "../_shared/safe-role";

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

const func: DeployFunction = async function (hre: HardhatRuntimeEnvironment): Promise<boolean> {
  if (isLocalNetwork(hre.network.name)) {
    console.log("🔁 setup-ethereum-mainnet-eth-oracles-safe: local network detected – skipping");
    return true;
  }

  const { deployments, ethers } = hre;
  const { deployer } = await hre.getNamedAccounts();
  const signer = await ethers.getSigner(deployer);
  const config = await getConfig(hre);

  const executor = new GovernanceExecutor(hre, signer, config.safeConfig);

  if (!executor.useSafe) {
    throw new Error("Safe config is required for ETH oracle rollout. Provide config.safeConfig and enable Safe mode.");
  }

  await executor.initialize();

  const { address: aggregatorAddress } = await deployments.get(ETH_ORACLE_AGGREGATOR_ID);
  const { address: redstoneWrapperAddress } = await deployments.get(ETH_REDSTONE_ORACLE_WRAPPER_ID);
  const { address: erc4626WrapperAddress } = await deployments.get(ETH_ERC4626_ORACLE_WRAPPER_ID);
  const { address: frxEthWrapperAddress } = await deployments.get(ETH_FRXETH_FUNDAMENTAL_ORACLE_WRAPPER_ID);

  const aggregator = await ethers.getContractAt("OracleAggregatorV1_1", aggregatorAddress, signer);
  const redstoneWrapper = await ethers.getContractAt("RedstoneChainlinkWrapperV1_1", redstoneWrapperAddress, signer);
  const erc4626Wrapper = await ethers.getContractAt("ERC4626OracleWrapperV1_1", erc4626WrapperAddress, signer);
  const frxEthWrapper = await ethers.getContractAt("FrxEthFundamentalOracleWrapperV1_1", frxEthWrapperAddress, signer);
  const managerAddress = config.safeConfig!.safeAddress;

  const [aggregatorRole, redstoneWrapperRole, erc4626WrapperRole] = await Promise.all([
    aggregator.ORACLE_MANAGER_ROLE(),
    redstoneWrapper.ORACLE_MANAGER_ROLE(),
    erc4626Wrapper.ORACLE_MANAGER_ROLE(),
  ]);

  await assertRoleGrantedToManager({
    contract: aggregator,
    contractAddress: aggregatorAddress,
    managerAddress,
    role: aggregatorRole,
    roleLabel: "ORACLE_MANAGER_ROLE",
    contractLabel: ETH_ORACLE_AGGREGATOR_ID,
  });

  await assertRoleGrantedToManager({
    contract: redstoneWrapper,
    contractAddress: redstoneWrapperAddress,
    managerAddress,
    role: redstoneWrapperRole,
    roleLabel: "ORACLE_MANAGER_ROLE",
    contractLabel: ETH_REDSTONE_ORACLE_WRAPPER_ID,
  });

  await assertRoleGrantedToManager({
    contract: erc4626Wrapper,
    contractAddress: erc4626WrapperAddress,
    managerAddress,
    role: erc4626WrapperRole,
    roleLabel: "ORACLE_MANAGER_ROLE",
    contractLabel: ETH_ERC4626_ORACLE_WRAPPER_ID,
  });

  const ethOracleConfig = config.oracleAggregators.ETH;
  const redstoneFeeds = ethOracleConfig.redstoneOracleAssets.plainRedstoneOracleWrappers ?? {};
  const erc4626Vaults = ethOracleConfig.erc4626OracleAssets ?? {};
  const frxEthConfig = ethOracleConfig.frxEthFundamentalOracle;
  const [redstoneBounds, erc4626Bounds, frxWrapperBounds] = await Promise.all([
    redstoneWrapper.BASE_CURRENCY_UNIT().then(getEthOraclePriceBounds),
    erc4626Wrapper.BASE_CURRENCY_UNIT().then(getEthOraclePriceBounds),
    frxEthWrapper.BASE_CURRENCY_UNIT().then(getEthOraclePriceBounds),
  ]);

  for (const [asset, feed] of Object.entries(redstoneFeeds)) {
    if (isZeroAddress(asset) || isZeroAddress(feed)) {
      continue;
    }

    const currentFeed = await redstoneWrapper.assetToFeed(asset);

    if (normalize(currentFeed) !== normalize(feed)) {
      const data = redstoneWrapper.interface.encodeFunctionData("setFeed", [asset, feed]);
      await executor.tryOrQueue(
        async () => {
          throw new Error("Direct execution disabled: queue Safe transaction instead.");
        },
        () => ({ to: redstoneWrapperAddress, value: "0", data }),
      );
    }

    const currentOracle = await aggregator.assetOracles(asset);

    if (normalize(currentOracle) !== normalize(redstoneWrapperAddress)) {
      await assertPlainFeedPriceWithinBounds({
        hre,
        signer,
        wrapper: redstoneWrapper,
        feed,
        bounds: redstoneBounds,
        label: `ETH plain wrapper ${asset}`,
      });

      const data = aggregator.interface.encodeFunctionData("setOracle", [asset, redstoneWrapperAddress]);
      await executor.tryOrQueue(
        async () => {
          throw new Error("Direct execution disabled: queue Safe transaction instead.");
        },
        () => ({ to: aggregatorAddress, value: "0", data }),
      );
    }
  }

  for (const [asset, vault] of Object.entries(erc4626Vaults)) {
    if (isZeroAddress(asset) || isZeroAddress(vault)) {
      continue;
    }

    const currentVaultConfig = await erc4626Wrapper.assetToVault(asset);
    const currentVault = currentVaultConfig.vault;

    if (normalize(currentVault) !== normalize(vault)) {
      const data = erc4626Wrapper.interface.encodeFunctionData("setVault", [asset, vault]);
      await executor.tryOrQueue(
        async () => {
          throw new Error("Direct execution disabled: queue Safe transaction instead.");
        },
        () => ({ to: erc4626WrapperAddress, value: "0", data }),
      );
    }

    const currentOracle = await aggregator.assetOracles(asset);

    if (normalize(currentOracle) !== normalize(erc4626WrapperAddress)) {
      await assertErc4626PriceWithinBounds({
        hre,
        signer,
        wrapper: erc4626Wrapper,
        vault,
        bounds: erc4626Bounds,
        label: `ETH ERC4626 wrapper ${asset}`,
      });

      const data = aggregator.interface.encodeFunctionData("setOracle", [asset, erc4626WrapperAddress]);
      await executor.tryOrQueue(
        async () => {
          throw new Error("Direct execution disabled: queue Safe transaction instead.");
        },
        () => ({ to: aggregatorAddress, value: "0", data }),
      );
    }
  }

  if (frxEthConfig && !isZeroAddress(frxEthConfig.asset)) {
    const currentOracle = await aggregator.assetOracles(frxEthConfig.asset);

    if (normalize(currentOracle) !== normalize(frxEthWrapperAddress)) {
      await assertDirectWrapperPriceWithinBounds({
        wrapper: frxEthWrapper,
        asset: frxEthConfig.asset,
        bounds: frxWrapperBounds,
        label: `ETH fundamental wrapper ${frxEthConfig.asset}`,
      });

      const data = aggregator.interface.encodeFunctionData("setOracle", [frxEthConfig.asset, frxEthWrapperAddress]);
      await executor.tryOrQueue(
        async () => {
          throw new Error("Direct execution disabled: queue Safe transaction instead.");
        },
        () => ({ to: aggregatorAddress, value: "0", data }),
      );
    }
  }

  await executor.flush("Ethereum mainnet dLEND ETH oracle rollout");
  console.log("🔁 setup-ethereum-mainnet-eth-oracles-safe: ✅");
  return true;
};

func.tags = ["post-deploy", "oracle-rollout", "eth-oracle", "safe", "setup-ethereum-mainnet-eth-oracles-safe"];
func.dependencies = [
  "setup-ethereum-mainnet-new-listings-preflight",
  "setup-ethereum-mainnet-new-listings-role-grants-safe",
  "deploy-frxeth-fundamental-oracle-wrapper",
  ETH_ORACLE_AGGREGATOR_ID,
  ETH_REDSTONE_ORACLE_WRAPPER_ID,
  ETH_ERC4626_ORACLE_WRAPPER_ID,
  ETH_FRXETH_FUNDAMENTAL_ORACLE_WRAPPER_ID,
];
func.id = "setup-ethereum-mainnet-eth-oracles-safe-v2";

export default func;
