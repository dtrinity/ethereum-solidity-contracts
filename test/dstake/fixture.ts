import { BigNumberish, ethers } from "ethers";
import { deployments } from "hardhat";
import { HardhatRuntimeEnvironment } from "hardhat/types";

import { ERC20, IDStableConversionAdapterV2 } from "../../typechain-types";
import { IERC20 } from "../../typechain-types/@openzeppelin/contracts/token/ERC20/IERC20";
import { DStakeRouterV2 } from "../../typechain-types/contracts/vaults/dstake/DStakeRouterV2.sol";
import { DStakeIdleVault } from "../../typechain-types/contracts/vaults/dstake/vaults/DStakeIdleVault";
import { MockControlledERC4626Adapter } from "../../typechain-types/contracts/testing/dstake/MockControlledERC4626Adapter";
import {
  DETH_A_TOKEN_WRAPPER_ID,
  DUSD_A_TOKEN_WRAPPER_ID,
  EMISSION_MANAGER_ID,
  INCENTIVES_PROXY_ID,
  POOL_ADDRESSES_PROVIDER_ID,
  PULL_REWARDS_TRANSFER_STRATEGY_ID,
  SDETH_COLLATERAL_VAULT_ID,
  SDETH_DSTAKE_TOKEN_ID,
  SDETH_ROUTER_ID,
  SDUSD_COLLATERAL_VAULT_ID,
  SDUSD_DSTAKE_TOKEN_ID,
  SDUSD_ROUTER_ID,
} from "../../typescript/deploy-ids";
import { getTokenContractForSymbol } from "../../typescript/token/utils";
import { DETH_CONFIG, DStableFixtureConfig, DUSD_CONFIG } from "../dstable/fixtures";

const VAULT_STATUS = {
  Active: 0,
  Suspended: 1,
  Impaired: 2,
} as const;

const MULTI_VAULT_TARGETS = [500_000n, 300_000n, 200_000n] as const;
const MULTI_VAULT_DEFAULT_INDEX = 1;

export interface DStakeFixtureConfig {
  dStableSymbol: "dUSD" | "dETH";
  DStakeTokenSymbol: string;
  DStakeTokenContractId: string;
  collateralVaultContractId: string;
  routerContractId: string;
  defaultVaultAssetSymbol: string;
  name?: string;
  underlyingDStableConfig: DStableFixtureConfig;
  deploymentTags: string[];
}

export const SDUSD_CONFIG: DStakeFixtureConfig = {
  dStableSymbol: "dUSD",
  DStakeTokenSymbol: "sdUSD",
  DStakeTokenContractId: SDUSD_DSTAKE_TOKEN_ID,
  collateralVaultContractId: SDUSD_COLLATERAL_VAULT_ID,
  routerContractId: SDUSD_ROUTER_ID,
  defaultVaultAssetSymbol: "wddUSD",
  underlyingDStableConfig: DUSD_CONFIG,
  deploymentTags: [
    "local-setup", // mock tokens and oracles
    "oracle", // mock oracle setup uses this tag
    "dusd", // underlying dStable token tag
    "dUSD-aTokenWrapper", // static aToken wrapper for dUSD
    "dlend", // dLend core and periphery
    "dStake", // dStake core, adapters, and configuration
    "ds", // Required by the Redstone plain feed setup
  ],
};

export const SDETH_CONFIG: DStakeFixtureConfig = {
  dStableSymbol: "dETH",
  DStakeTokenSymbol: "sdETH",
  DStakeTokenContractId: SDETH_DSTAKE_TOKEN_ID,
  collateralVaultContractId: SDETH_COLLATERAL_VAULT_ID,
  routerContractId: SDETH_ROUTER_ID,
  defaultVaultAssetSymbol: "wdETH",
  underlyingDStableConfig: DETH_CONFIG,
  deploymentTags: ["local-setup", "oracle", "deth", "dETH-aTokenWrapper", "dlend", "dStake", "dStakeRewards"],
};

// Array of all DStake configurations
export const DSTAKE_CONFIGS: DStakeFixtureConfig[] = [SDUSD_CONFIG, SDETH_CONFIG];

export interface RouterVaultState {
  strategyVault: string;
  adapter: string;
  targetBps: bigint;
  status: number;
}

export interface MultiVaultFixtureState {
  defaultDepositVault: string;
  vaults: RouterVaultState[];
  controllableAdapters?: Record<string, string>;
}

export interface DStakeFixtureOptions {
  multiVault?: boolean;
}

// Core logic for fetching dStake components *after* deployments are done
/**
 *
 * @param hreElements
 * @param hreElements.deployments
 * @param hreElements.getNamedAccounts
 * @param hreElements.ethers
 * @param hreElements.globalHre
 * @param config
 */
async function fetchDStakeComponents(
  hreElements: {
    deployments: HardhatRuntimeEnvironment["deployments"];
    getNamedAccounts: HardhatRuntimeEnvironment["getNamedAccounts"];
    ethers: HardhatRuntimeEnvironment["ethers"];
    globalHre: HardhatRuntimeEnvironment; // For getTokenContractForSymbol
  },
  config: DStakeFixtureConfig,
) {
  const { deployments, getNamedAccounts, ethers, globalHre } = hreElements;
  const { deployer } = await getNamedAccounts();
  const deployerSigner = await ethers.getSigner(deployer);

  const { contract: dStableToken, tokenInfo: dStableInfo } = await getTokenContractForSymbol(globalHre, deployer, config.dStableSymbol);

  const DStakeToken = await ethers.getContractAt("DStakeTokenV2", (await deployments.get(config.DStakeTokenContractId)).address);

  const collateralVault = await ethers.getContractAt(
    "DStakeCollateralVaultV2",
    (await deployments.get(config.collateralVaultContractId)).address,
  );

  const router = (await ethers.getContractAt("DStakeRouterV2", (await deployments.get(config.routerContractId)).address)) as DStakeRouterV2;

  const wrappedATokenAddress = (await deployments.get(config.dStableSymbol === "dUSD" ? DUSD_A_TOKEN_WRAPPER_ID : DETH_A_TOKEN_WRAPPER_ID))
    .address;
  const wrappedAToken = await ethers.getContractAt("@openzeppelin/contracts/token/ERC20/IERC20.sol:IERC20", wrappedATokenAddress);

  const vaultAssetAddress = wrappedATokenAddress;
  const adapterAddress = await router.strategyShareToAdapter(vaultAssetAddress);
  if (adapterAddress === ethers.ZeroAddress) {
    throw new Error(`Adapter not configured for ${config.DStakeTokenSymbol}`);
  }
  const adapter = await ethers.getContractAt("IDStableConversionAdapterV2", adapterAddress);

  return {
    config,
    DStakeToken,
    collateralVault,
    router,
    dStableToken: dStableToken as unknown as ERC20,
    dStableInfo,
    vaultAssetToken: wrappedAToken as unknown as IERC20,
    vaultAssetAddress,
    adapter,
    adapterAddress,
    deployer: deployerSigner,
  };
}

// Main fixture setup function to be called from tests
/**
 *
 * @param hreElements
 * @param hreElements.deployments
 * @param hreElements.ethers
 * @param hreElements.getNamedAccounts
 * @param hreElements.globalHre
 * @param config
 * @param rewardTokenSymbol
 * @param rewardAmount
 * @param emissionPerSecondSetting
 * @param distributionDuration
 */
export async function executeSetupDLendRewards(
  hreElements: {
    deployments: HardhatRuntimeEnvironment["deployments"];
    ethers: HardhatRuntimeEnvironment["ethers"];
    getNamedAccounts: HardhatRuntimeEnvironment["getNamedAccounts"];
    globalHre: HardhatRuntimeEnvironment; // For helpers
  },
  config: DStakeFixtureConfig,
  rewardTokenSymbol: string,
  rewardAmount: BigNumberish,
  emissionPerSecondSetting?: BigNumberish, // Optional, with default below
  distributionDuration: number = 3600,
) {
  const { deployments, ethers, getNamedAccounts, globalHre } = hreElements;

  // Combine all necessary tags for a single deployment run
  const allDeploymentTags = [
    ...config.deploymentTags, // from SDUSD_CONFIG (includes local-setup, oracles, dStable, dlend, dStake)
    "dlend-static-wrapper-factory", // ensure static wrapper factory runs before static wrappers
    "dStakeRewards", // Tag for DStakeRewardManagerDLend deployment script and its dependencies
    // Add "dlend-static-wrapper-factory" if it's not reliably covered by dStake->dStakeAdapters dependency chain
    // However, the current setup should have dStake depend on dStakeAdapters, which depends on StaticATokenFactory
  ];

  // Single fixture execution for all deployments
  await deployments.fixture(allDeploymentTags);

  // Fetch base dStake components (now that all deployments are done)
  const dStakeBase = await fetchDStakeComponents(hreElements, config);
  const { deployer: signer } = dStakeBase; // deployer is an Ethers Signer

  // Get DStakeRewardManagerDLend related contracts
  const rewardManagerDeployment = await deployments.get(`DStakeRewardManagerDLend_${config.DStakeTokenSymbol}`);
  const rewardManager = await ethers.getContractAt("DStakeRewardManagerDLend", rewardManagerDeployment.address);

  const targetStaticATokenWrapper = await rewardManager.targetStaticATokenWrapper();
  const dLendAssetToClaimFor = await rewardManager.dLendAssetToClaimFor();

  const { contract: rewardToken, tokenInfo: rewardTokenInfo } = await getTokenContractForSymbol(
    globalHre,
    signer.address,
    rewardTokenSymbol,
  );

  // Get EmissionManager and RewardsController instances
  const emissionManagerDeployment = await deployments.get(EMISSION_MANAGER_ID);
  const emissionManager = await ethers.getContractAt("EmissionManager", emissionManagerDeployment.address);
  const incentivesProxy = await deployments.get(INCENTIVES_PROXY_ID);
  const rewardsController = await ethers.getContractAt("RewardsController", incentivesProxy.address);

  // For configureAssets, deployer (owner of EmissionManager) must set itself as emission admin for the reward token first
  await emissionManager.connect(signer).setEmissionAdmin(rewardTokenInfo.address, signer.address);

  const transferStrategyAddress = (await deployments.get(PULL_REWARDS_TRANSFER_STRATEGY_ID)).address;
  const block = (await ethers.provider.getBlock("latest"))!;
  const distributionEnd = block.timestamp + distributionDuration;
  const poolAddressesProviderDeployment = await deployments.get(POOL_ADDRESSES_PROVIDER_ID);
  const poolAddressesProvider = await ethers.getContractAt("PoolAddressesProvider", poolAddressesProviderDeployment.address);
  const rewardOracle = await poolAddressesProvider.getPriceOracle();

  const emissionPerSecond = emissionPerSecondSetting ?? ethers.parseUnits("1", rewardTokenInfo.decimals ?? 18);

  // Call configureAssets via EmissionManager, now that signer is emissionAdmin for the rewardToken
  try {
    await emissionManager.connect(signer).configureAssets([
      {
        asset: dLendAssetToClaimFor,
        reward: rewardTokenInfo.address,
        transferStrategy: transferStrategyAddress,
        rewardOracle,
        emissionPerSecond,
        distributionEnd,
        totalSupply: 0, // This is usually fetched or calculated, 0 for new setup
      },
    ]);
  } catch (error: any) {
    console.warn(`⚠️ Skipping configureAssets for ${config.DStakeTokenSymbol}: ${error.message ?? error}`);
  }

  // Cast to ERC20 for token operations
  const rewardTokenERC20 = rewardToken as unknown as ERC20;

  // Fund the rewards vault for PullRewardsTransferStrategy and approve
  const pullStrategy = await ethers.getContractAt("IPullRewardsTransferStrategy", transferStrategyAddress);
  const rewardsVault = await pullStrategy.getRewardsVault();
  // Transfer reward tokens to the vault address
  await rewardTokenERC20.connect(signer).transfer(rewardsVault, rewardAmount);
  // Approve the PullRewardsTransferStrategy to pull rewards from the vault
  const vaultSigner = await ethers.getSigner(rewardsVault);
  await rewardTokenERC20.connect(vaultSigner).approve(transferStrategyAddress, rewardAmount);

  return {
    ...dStakeBase,
    rewardManager,
    rewardsController,
    rewardToken,
    targetStaticATokenWrapper,
    dLendAssetToClaimFor,
  };
}

export type DStakeFixtureResult = Awaited<ReturnType<typeof fetchDStakeComponents>> & {
  multiVault?: MultiVaultFixtureState;
};

async function collectMultiVaultState(
  router: DStakeRouterV2,
  controllableAdapters?: Record<string, string>,
): Promise<MultiVaultFixtureState> {
  const vaultCount = Number(await router.getVaultCount());
  const vaults: RouterVaultState[] = [];
  for (let i = 0; i < vaultCount; i++) {
    const cfg = await router.getVaultConfigByIndex(i);
    vaults.push({
      strategyVault: cfg.strategyVault,
      adapter: cfg.adapter,
      targetBps: cfg.targetBps,
      status: cfg.status,
    });
  }

  const state: MultiVaultFixtureState = {
    defaultDepositVault: await router.defaultDepositStrategyShare(),
    vaults,
  };

  if (controllableAdapters) {
    state.controllableAdapters = controllableAdapters;
  }

  return state;
}

async function ensureMultiVaultRouterState(
  base: Awaited<ReturnType<typeof fetchDStakeComponents>>,
  hre: HardhatRuntimeEnvironment,
): Promise<MultiVaultFixtureState> {
  const router = base.router as DStakeRouterV2;

  const deployer = base.deployer;
  const deployerAddress = await deployer.getAddress();
  const dStableAddress = await base.dStableToken.getAddress();
  const collateralVaultAddress = await base.collateralVault.getAddress();

  const idleVaultFactory = await hre.ethers.getContractFactory("DStakeIdleVault", deployer);
  const adapterFactory = await hre.ethers.getContractFactory("MockControlledERC4626Adapter", deployer);

  const idleLabels = ["Alpha", "Beta"];
  const idleVaults: DStakeIdleVault[] = [];
  for (const label of idleLabels) {
    const vault = (await idleVaultFactory.deploy(
      dStableAddress,
      `${base.config.DStakeTokenSymbol} Idle Vault ${label}`,
      `${base.config.DStakeTokenSymbol}-IDLE-${label[0]}`,
      deployerAddress,
      deployerAddress,
    )) as DStakeIdleVault;
    await vault.waitForDeployment();
    idleVaults.push(vault);
  }

  const adapters: MockControlledERC4626Adapter[] = [];
  for (const vault of idleVaults) {
    const adapter = (await adapterFactory.deploy(
      dStableAddress,
      await vault.getAddress(),
      collateralVaultAddress,
    )) as MockControlledERC4626Adapter;
    await adapter.waitForDeployment();
    adapters.push(adapter);
  }

  const idleVaultAddresses = await Promise.all(idleVaults.map((vault) => vault.getAddress()));
  const adapterAddresses = await Promise.all(adapters.map((adapter) => adapter.getAddress()));

  const controllableAdapters: Record<string, string> = {};
  idleVaultAddresses.forEach((vaultAddr, idx) => {
    controllableAdapters[vaultAddr] = adapterAddresses[idx];
  });

  const vaultConfigs = [
    {
      strategyVault: base.vaultAssetAddress,
      adapter: base.adapterAddress,
      targetBps: MULTI_VAULT_TARGETS[0],
      status: VAULT_STATUS.Active,
    },
    {
      strategyVault: idleVaultAddresses[0],
      adapter: adapterAddresses[0],
      targetBps: MULTI_VAULT_TARGETS[1],
      status: VAULT_STATUS.Active,
    },
    {
      strategyVault: idleVaultAddresses[1],
      adapter: adapterAddresses[1],
      targetBps: MULTI_VAULT_TARGETS[2],
      status: VAULT_STATUS.Active,
    },
  ];

  const routerWithDeployer = router.connect(deployer);
  await routerWithDeployer.setVaultConfigs(vaultConfigs);
  const defaultDepositVault = vaultConfigs[MULTI_VAULT_DEFAULT_INDEX].strategyVault;
  await routerWithDeployer.setDefaultDepositStrategyShare(defaultDepositVault);

  return collectMultiVaultState(router, controllableAdapters);
}

export const createDStakeFixture = (config: DStakeFixtureConfig, options?: DStakeFixtureOptions) => {
  return deployments.createFixture(async (hreFixtureEnv: HardhatRuntimeEnvironment) => {
    await hreFixtureEnv.deployments.fixture();
    await hreFixtureEnv.deployments.fixture(config.deploymentTags);

    const base = (await fetchDStakeComponents(
      {
        deployments: hreFixtureEnv.deployments,
        getNamedAccounts: hreFixtureEnv.getNamedAccounts,
        ethers: hreFixtureEnv.ethers,
        globalHre: hreFixtureEnv,
      },
      config,
    )) as DStakeFixtureResult;

    if (options?.multiVault) {
      base.multiVault = await ensureMultiVaultRouterState(base, hreFixtureEnv);
    }

    return base;
  });
};

export const setupDLendRewardsFixture = (
  config: DStakeFixtureConfig,
  rewardTokenSymbol: string,
  rewardAmount: BigNumberish,
  emissionPerSecond?: BigNumberish,
  distributionDuration: number = 3600,
) =>
  deployments.createFixture(async (hreFixtureEnv: HardhatRuntimeEnvironment) => {
    // Execute DStake rewards setup, which includes its own deployments.fixture(allDeploymentTags)
    // Don't run all deployments to avoid interference from RedeemerWithFees
    return executeSetupDLendRewards(
      {
        deployments: hreFixtureEnv.deployments,
        ethers: hreFixtureEnv.ethers,
        getNamedAccounts: hreFixtureEnv.getNamedAccounts,
        globalHre: hreFixtureEnv,
      },
      config,
      rewardTokenSymbol,
      rewardAmount,
      emissionPerSecond,
      distributionDuration,
    );
  });

// Pre-bound SDUSD rewards fixture for tests
export const SDUSDRewardsFixture = setupDLendRewardsFixture(
  SDUSD_CONFIG,
  "sfrxUSD",
  ethers.parseUnits("100", 6), // total reward amount
  ethers.parseUnits("1", 6), // emission per second (1 token/sec in 6-decimals)
);

// Pre-bound SDS rewards fixture for table-driven tests
export const SDSRewardsFixture = setupDLendRewardsFixture(SDETH_CONFIG, "stETH", ethers.parseUnits("100", 18));
