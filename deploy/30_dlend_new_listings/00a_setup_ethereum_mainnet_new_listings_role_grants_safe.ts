import { HardhatRuntimeEnvironment } from "hardhat/types";
import { DeployFunction } from "hardhat-deploy/types";

import { getConfig } from "../../config/config";
import {
  DETH_COLLATERAL_VAULT_CONTRACT_ID,
  DETH_REDEEMER_V2_CONTRACT_ID,
  DUSD_COLLATERAL_VAULT_CONTRACT_ID,
  DUSD_REDEEMER_V2_CONTRACT_ID,
  ETH_ERC4626_ORACLE_WRAPPER_ID,
  ETH_ORACLE_AGGREGATOR_ID,
  ETH_REDSTONE_ORACLE_WRAPPER_ID,
  POOL_ADDRESSES_PROVIDER_ID,
  USD_CHAINLINK_ERC4626_WRAPPER_ID,
  USD_ORACLE_AGGREGATOR_ID,
  USD_REDSTONE_COMPOSITE_WRAPPER_WITH_THRESHOLDING_ID,
  USD_REDSTONE_ORACLE_WRAPPER_ID,
} from "../../typescript/deploy-ids";
import { isLocalNetwork } from "../../typescript/hardhat/deploy";
import { GovernanceExecutor } from "../../typescript/hardhat/governance";
import { ensureRoleGrantedToManager, getRoleAccess } from "../_shared/safe-role";

const func: DeployFunction = async function (hre: HardhatRuntimeEnvironment): Promise<boolean> {
  if (isLocalNetwork(hre.network.name)) {
    console.log("🔁 setup-ethereum-mainnet-new-listings-role-grants-safe: local network detected – skipping");
    return true;
  }

  const { deployments, ethers } = hre;
  const { deployer } = await hre.getNamedAccounts();
  const signer = await ethers.getSigner(deployer);
  const config = await getConfig(hre);

  const executor = new GovernanceExecutor(hre, signer, config.safeConfig);

  if (!executor.useSafe || !config.safeConfig?.safeAddress) {
    throw new Error("Safe config is required for role grants. Provide config.safeConfig and enable Safe mode.");
  }

  await executor.initialize();
  const managerAddress = config.safeConfig.safeAddress;

  const { address: usdAggregatorAddress } = await deployments.get(USD_ORACLE_AGGREGATOR_ID);
  const { address: usdPlainWrapperAddress } = await deployments.get(USD_REDSTONE_ORACLE_WRAPPER_ID);
  const { address: usdCompositeWrapperAddress } = await deployments.get(USD_REDSTONE_COMPOSITE_WRAPPER_WITH_THRESHOLDING_ID);
  const { address: usdErc4626WrapperAddress } = await deployments.get(USD_CHAINLINK_ERC4626_WRAPPER_ID);
  const { address: ethAggregatorAddress } = await deployments.get(ETH_ORACLE_AGGREGATOR_ID);
  const { address: ethRedstoneWrapperAddress } = await deployments.get(ETH_REDSTONE_ORACLE_WRAPPER_ID);
  const { address: ethErc4626WrapperAddress } = await deployments.get(ETH_ERC4626_ORACLE_WRAPPER_ID);
  const { address: dUSDVaultAddress } = await deployments.get(DUSD_COLLATERAL_VAULT_CONTRACT_ID);
  const { address: dETHVaultAddress } = await deployments.get(DETH_COLLATERAL_VAULT_CONTRACT_ID);
  const { address: dUSDRedeemerV2Address } = await deployments.get(DUSD_REDEEMER_V2_CONTRACT_ID);
  const { address: dETHRedeemerV2Address } = await deployments.get(DETH_REDEEMER_V2_CONTRACT_ID);
  const { address: addressProviderAddress } = await deployments.get(POOL_ADDRESSES_PROVIDER_ID);

  const usdAggregator = await ethers.getContractAt("OracleAggregatorV1_1", usdAggregatorAddress, signer);
  const usdPlainWrapper = await ethers.getContractAt("RedstoneChainlinkWrapperV1_1", usdPlainWrapperAddress, signer);
  const usdCompositeWrapper = await ethers.getContractAt(
    "RedstoneChainlinkCompositeWrapperWithThresholdingV1_1",
    usdCompositeWrapperAddress,
    signer,
  );
  const usdErc4626Wrapper = await ethers.getContractAt("ChainlinkERC4626WrapperV1_1", usdErc4626WrapperAddress, signer);

  const ethAggregator = await ethers.getContractAt("OracleAggregatorV1_1", ethAggregatorAddress, signer);
  const ethRedstoneWrapper = await ethers.getContractAt("RedstoneChainlinkWrapperV1_1", ethRedstoneWrapperAddress, signer);
  const ethErc4626Wrapper = await ethers.getContractAt("ERC4626OracleWrapperV1_1", ethErc4626WrapperAddress, signer);

  const dUSDVault = await ethers.getContractAt("CollateralHolderVault", dUSDVaultAddress, signer);
  const dETHVault = await ethers.getContractAt("CollateralHolderVault", dETHVaultAddress, signer);
  const dUSDRedeemerV2 = await ethers.getContractAt("RedeemerV2", dUSDRedeemerV2Address, signer);
  const dETHRedeemerV2 = await ethers.getContractAt("RedeemerV2", dETHRedeemerV2Address, signer);

  const addressProvider = await ethers.getContractAt("PoolAddressesProvider", addressProviderAddress, signer);
  const aclManagerAddress = await addressProvider.getACLManager();
  const aclManager = await ethers.getContractAt("ACLManager", aclManagerAddress, signer);

  const [
    usdAggRole,
    usdPlainRole,
    usdCompositeRole,
    usdErc4626Role,
    ethAggRole,
    ethRedstoneRole,
    ethErc4626Role,
    dUSDCollateralManagerRole,
    dETHCollateralManagerRole,
    dUSDRedeemerAdminRole,
    dETHRedeemerAdminRole,
    poolAdminRole,
    assetListingAdminRole,
  ] = await Promise.all([
    usdAggregator.ORACLE_MANAGER_ROLE(),
    usdPlainWrapper.ORACLE_MANAGER_ROLE(),
    usdCompositeWrapper.ORACLE_MANAGER_ROLE(),
    usdErc4626Wrapper.ORACLE_MANAGER_ROLE(),
    ethAggregator.ORACLE_MANAGER_ROLE(),
    ethRedstoneWrapper.ORACLE_MANAGER_ROLE(),
    ethErc4626Wrapper.ORACLE_MANAGER_ROLE(),
    dUSDVault.COLLATERAL_MANAGER_ROLE(),
    dETHVault.COLLATERAL_MANAGER_ROLE(),
    dUSDRedeemerV2.DEFAULT_ADMIN_ROLE(),
    dETHRedeemerV2.DEFAULT_ADMIN_ROLE(),
    aclManager.POOL_ADMIN_ROLE(),
    aclManager.ASSET_LISTING_ADMIN_ROLE(),
  ]);

  await ensureRoleGrantedToManager({
    executor,
    contract: usdAggregator,
    contractAddress: usdAggregatorAddress,
    managerAddress,
    role: usdAggRole,
    roleLabel: "ORACLE_MANAGER_ROLE",
    contractLabel: USD_ORACLE_AGGREGATOR_ID,
  });
  await ensureRoleGrantedToManager({
    executor,
    contract: usdPlainWrapper,
    contractAddress: usdPlainWrapperAddress,
    managerAddress,
    role: usdPlainRole,
    roleLabel: "ORACLE_MANAGER_ROLE",
    contractLabel: USD_REDSTONE_ORACLE_WRAPPER_ID,
  });
  await ensureRoleGrantedToManager({
    executor,
    contract: usdCompositeWrapper,
    contractAddress: usdCompositeWrapperAddress,
    managerAddress,
    role: usdCompositeRole,
    roleLabel: "ORACLE_MANAGER_ROLE",
    contractLabel: USD_REDSTONE_COMPOSITE_WRAPPER_WITH_THRESHOLDING_ID,
  });
  await ensureRoleGrantedToManager({
    executor,
    contract: usdErc4626Wrapper,
    contractAddress: usdErc4626WrapperAddress,
    managerAddress,
    role: usdErc4626Role,
    roleLabel: "ORACLE_MANAGER_ROLE",
    contractLabel: USD_CHAINLINK_ERC4626_WRAPPER_ID,
  });
  await ensureRoleGrantedToManager({
    executor,
    contract: ethAggregator,
    contractAddress: ethAggregatorAddress,
    managerAddress,
    role: ethAggRole,
    roleLabel: "ORACLE_MANAGER_ROLE",
    contractLabel: ETH_ORACLE_AGGREGATOR_ID,
  });
  await ensureRoleGrantedToManager({
    executor,
    contract: ethRedstoneWrapper,
    contractAddress: ethRedstoneWrapperAddress,
    managerAddress,
    role: ethRedstoneRole,
    roleLabel: "ORACLE_MANAGER_ROLE",
    contractLabel: ETH_REDSTONE_ORACLE_WRAPPER_ID,
  });
  await ensureRoleGrantedToManager({
    executor,
    contract: ethErc4626Wrapper,
    contractAddress: ethErc4626WrapperAddress,
    managerAddress,
    role: ethErc4626Role,
    roleLabel: "ORACLE_MANAGER_ROLE",
    contractLabel: ETH_ERC4626_ORACLE_WRAPPER_ID,
  });
  await ensureRoleGrantedToManager({
    executor,
    contract: dUSDVault,
    contractAddress: dUSDVaultAddress,
    managerAddress,
    role: dUSDCollateralManagerRole,
    roleLabel: "COLLATERAL_MANAGER_ROLE",
    contractLabel: DUSD_COLLATERAL_VAULT_CONTRACT_ID,
  });
  await ensureRoleGrantedToManager({
    executor,
    contract: dETHVault,
    contractAddress: dETHVaultAddress,
    managerAddress,
    role: dETHCollateralManagerRole,
    roleLabel: "COLLATERAL_MANAGER_ROLE",
    contractLabel: DETH_COLLATERAL_VAULT_CONTRACT_ID,
  });
  await ensureRoleGrantedToManager({
    executor,
    contract: dUSDRedeemerV2,
    contractAddress: dUSDRedeemerV2Address,
    managerAddress,
    role: dUSDRedeemerAdminRole,
    roleLabel: "DEFAULT_ADMIN_ROLE",
    contractLabel: DUSD_REDEEMER_V2_CONTRACT_ID,
  });
  await ensureRoleGrantedToManager({
    executor,
    contract: dETHRedeemerV2,
    contractAddress: dETHRedeemerV2Address,
    managerAddress,
    role: dETHRedeemerAdminRole,
    roleLabel: "DEFAULT_ADMIN_ROLE",
    contractLabel: DETH_REDEEMER_V2_CONTRACT_ID,
  });

  const [poolAdminAccess, hasAssetListingAdmin] = await Promise.all([
    getRoleAccess(aclManager, poolAdminRole, managerAddress),
    aclManager.hasRole(assetListingAdminRole, managerAddress),
  ]);

  if (!poolAdminAccess.hasRole && !hasAssetListingAdmin) {
    await ensureRoleGrantedToManager({
      executor,
      contract: aclManager,
      contractAddress: aclManagerAddress,
      managerAddress,
      role: poolAdminRole,
      roleLabel: "POOL_ADMIN_ROLE",
      contractLabel: "ACLManager",
    });
  }

  await executor.flush("Ethereum mainnet new listings role grants");
  console.log("🔁 setup-ethereum-mainnet-new-listings-role-grants-safe: ✅");
  return true;
};

func.tags = ["post-deploy", "safe", "setup-ethereum-mainnet-new-listings-role-grants-safe"];
func.dependencies = ["setup-ethereum-mainnet-new-listings-preflight"];
func.id = "setup-ethereum-mainnet-new-listings-role-grants-safe";

export default func;
