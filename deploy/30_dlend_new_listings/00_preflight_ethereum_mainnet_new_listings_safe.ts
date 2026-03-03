import { HardhatRuntimeEnvironment } from "hardhat/types";
import { DeployFunction } from "hardhat-deploy/types";

import { getConfig } from "../../config/config";
import {
  ATOKEN_IMPL_ID,
  DETH_COLLATERAL_VAULT_CONTRACT_ID,
  DETH_REDEEMER_V2_CONTRACT_ID,
  DUSD_COLLATERAL_VAULT_CONTRACT_ID,
  DUSD_REDEEMER_V2_CONTRACT_ID,
  ETH_ERC4626_ORACLE_WRAPPER_ID,
  ETH_FRXETH_FUNDAMENTAL_ORACLE_WRAPPER_ID,
  ETH_ORACLE_AGGREGATOR_ID,
  ETH_REDSTONE_ORACLE_WRAPPER_ID,
  POOL_ADDRESSES_PROVIDER_ID,
  RESERVES_SETUP_HELPER_ID,
  STABLE_DEBT_TOKEN_IMPL_ID,
  TREASURY_PROXY_ID,
  USD_CHAINLINK_ERC4626_WRAPPER_ID,
  USD_ORACLE_AGGREGATOR_ID,
  USD_REDSTONE_COMPOSITE_WRAPPER_WITH_THRESHOLDING_ID,
  USD_REDSTONE_ORACLE_WRAPPER_ID,
  VARIABLE_DEBT_TOKEN_IMPL_ID,
} from "../../typescript/deploy-ids";
import { isLocalNetwork } from "../../typescript/hardhat/deploy";
import { GovernanceExecutor } from "../../typescript/hardhat/governance";
import { getRoleAccess } from "../_shared/safe-role";

const REQUIRED_DEPLOYMENTS = [
  USD_ORACLE_AGGREGATOR_ID,
  USD_REDSTONE_ORACLE_WRAPPER_ID,
  USD_REDSTONE_COMPOSITE_WRAPPER_WITH_THRESHOLDING_ID,
  USD_CHAINLINK_ERC4626_WRAPPER_ID,
  ETH_ORACLE_AGGREGATOR_ID,
  ETH_REDSTONE_ORACLE_WRAPPER_ID,
  ETH_ERC4626_ORACLE_WRAPPER_ID,
  DUSD_COLLATERAL_VAULT_CONTRACT_ID,
  DETH_COLLATERAL_VAULT_CONTRACT_ID,
  DUSD_REDEEMER_V2_CONTRACT_ID,
  DETH_REDEEMER_V2_CONTRACT_ID,
  POOL_ADDRESSES_PROVIDER_ID,
  RESERVES_SETUP_HELPER_ID,
  TREASURY_PROXY_ID,
  ATOKEN_IMPL_ID,
  STABLE_DEBT_TOKEN_IMPL_ID,
  VARIABLE_DEBT_TOKEN_IMPL_ID,
] as const;

const ROLLOUT_COLLATERAL_SYMBOLS = [
  "WETH",
  "wstETH",
  "rETH",
  "sfrxETH",
  "sUSDe",
  "sUSDS",
  "syrupUSDC",
  "syrupUSDT",
  "sfrxUSD",
  "LBTC",
  "WBTC",
  "cbBTC",
  "PAXG",
] as const;

/**
 * Reports a preflight blocker.
 *
 * @param blockers Mutable blocker list.
 * @param message Blocker message.
 */
function addBlocker(blockers: string[], message: string): void {
  blockers.push(message);
}

const func: DeployFunction = async function (hre: HardhatRuntimeEnvironment): Promise<boolean> {
  if (isLocalNetwork(hre.network.name)) {
    console.log("🔁 setup-ethereum-mainnet-new-listings-preflight: local network detected – skipping");
    return false;
  }

  const { deployments, ethers } = hre;
  const { deployer } = await hre.getNamedAccounts();
  const signer = await ethers.getSigner(deployer);
  const config = await getConfig(hre);
  const blockers: string[] = [];

  const executor = new GovernanceExecutor(hre, signer, config.safeConfig);

  if (!executor.useSafe || !config.safeConfig?.safeAddress) {
    throw new Error("Safe config is required for new listings preflight. Provide config.safeConfig and enable Safe mode.");
  }

  const safeAddress = config.safeConfig.safeAddress;

  const missingDeployments: string[] = [];

  for (const id of REQUIRED_DEPLOYMENTS) {
    const deployment = await deployments.getOrNull(id);

    if (!deployment) {
      missingDeployments.push(id);
    }
  }

  if (missingDeployments.length > 0) {
    throw new Error(
      [
        `New listings preflight failed.`,
        `Missing hardhat-deploy artifacts: ${missingDeployments.join(", ")}`,
        `Expected files under ${hre.config.paths.deployments}/${hre.network.name}.`,
        `NEVER run new listings with --reset on mainnet.`,
      ].join(" "),
    );
  }

  const frxEthConfig = config.oracleAggregators.ETH.frxEthFundamentalOracle;
  const frxWrapperDeployment = await deployments.getOrNull(ETH_FRXETH_FUNDAMENTAL_ORACLE_WRAPPER_ID);

  if (frxEthConfig && !frxWrapperDeployment) {
    console.log(
      `ℹ️ setup-ethereum-mainnet-new-listings-preflight: ${ETH_FRXETH_FUNDAMENTAL_ORACLE_WRAPPER_ID} not deployed yet; ` +
        `it should be created by deploy-frxeth-fundamental-oracle-wrapper in this rollout.`,
    );
  }

  if (!config.dLend) {
    addBlocker(blockers, `dLend config is required on ${hre.network.name}.`);
  } else {
    for (const symbol of ROLLOUT_COLLATERAL_SYMBOLS) {
      const reserveParams = config.dLend.reservesConfig[symbol];

      if (!reserveParams) {
        continue;
      }

      const tokenAddress = config.tokenAddresses[symbol];

      if (!tokenAddress) {
        addBlocker(blockers, `[config-check] Missing token address for rollout symbol ${symbol}.`);
      }

      const strategyDeployment = await deployments.getOrNull(`ReserveStrategy-${reserveParams.strategy.name}`);

      if (!strategyDeployment) {
        addBlocker(blockers, `[artifact-check] Missing ReserveStrategy-${reserveParams.strategy.name} for ${symbol}.`);
      }
    }
  }

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
    riskAdminRole,
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
    aclManager.RISK_ADMIN_ROLE(),
  ]);

  const roleChecks = [
    [usdAggregator, usdAggRole, safeAddress, `${USD_ORACLE_AGGREGATOR_ID}.ORACLE_MANAGER_ROLE`],
    [usdPlainWrapper, usdPlainRole, safeAddress, `${USD_REDSTONE_ORACLE_WRAPPER_ID}.ORACLE_MANAGER_ROLE`],
    [usdCompositeWrapper, usdCompositeRole, safeAddress, `${USD_REDSTONE_COMPOSITE_WRAPPER_WITH_THRESHOLDING_ID}.ORACLE_MANAGER_ROLE`],
    [usdErc4626Wrapper, usdErc4626Role, safeAddress, `${USD_CHAINLINK_ERC4626_WRAPPER_ID}.ORACLE_MANAGER_ROLE`],
    [ethAggregator, ethAggRole, safeAddress, `${ETH_ORACLE_AGGREGATOR_ID}.ORACLE_MANAGER_ROLE`],
    [ethRedstoneWrapper, ethRedstoneRole, safeAddress, `${ETH_REDSTONE_ORACLE_WRAPPER_ID}.ORACLE_MANAGER_ROLE`],
    [ethErc4626Wrapper, ethErc4626Role, safeAddress, `${ETH_ERC4626_ORACLE_WRAPPER_ID}.ORACLE_MANAGER_ROLE`],
    [dUSDVault, dUSDCollateralManagerRole, safeAddress, `${DUSD_COLLATERAL_VAULT_CONTRACT_ID}.COLLATERAL_MANAGER_ROLE`],
    [dETHVault, dETHCollateralManagerRole, safeAddress, `${DETH_COLLATERAL_VAULT_CONTRACT_ID}.COLLATERAL_MANAGER_ROLE`],
    [dUSDRedeemerV2, dUSDRedeemerAdminRole, safeAddress, `${DUSD_REDEEMER_V2_CONTRACT_ID}.DEFAULT_ADMIN_ROLE`],
    [dETHRedeemerV2, dETHRedeemerAdminRole, safeAddress, `${DETH_REDEEMER_V2_CONTRACT_ID}.DEFAULT_ADMIN_ROLE`],
  ] as const;

  for (const [contract, role, account, label] of roleChecks) {
    const access = await getRoleAccess(contract, role, account);

    if (!access.hasRole && !access.canGrantRole) {
      addBlocker(blockers, `[role-check] ${safeAddress} cannot obtain ${label}; missing role and admin role ${access.adminRole}.`);
    }
  }

  const [poolAdminAccess, hasAssetListingAdmin, riskAdminAccess] = await Promise.all([
    getRoleAccess(aclManager, poolAdminRole, safeAddress),
    aclManager.hasRole(assetListingAdminRole, safeAddress),
    getRoleAccess(aclManager, riskAdminRole, safeAddress),
  ]);

  if (!poolAdminAccess.hasRole && !hasAssetListingAdmin && !poolAdminAccess.canGrantRole) {
    addBlocker(
      blockers,
      `[role-check] ${safeAddress} lacks POOL_ADMIN_ROLE / ASSET_LISTING_ADMIN_ROLE and cannot self-grant POOL_ADMIN_ROLE.`,
    );
  }

  if (!riskAdminAccess.canGrantRole) {
    addBlocker(blockers, `[role-check] ${safeAddress} cannot grant RISK_ADMIN_ROLE on ACLManager (${aclManagerAddress}).`);
  }

  if (blockers.length > 0) {
    throw new Error(`New listings preflight failed:\n- ${blockers.join("\n- ")}`);
  }

  console.log("🔁 setup-ethereum-mainnet-new-listings-preflight: ✅");
  return false;
};

func.tags = ["post-deploy", "safe", "setup-ethereum-mainnet-new-listings-preflight"];
func.dependencies = [];

export default func;
